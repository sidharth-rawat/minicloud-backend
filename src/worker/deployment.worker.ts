import { Worker } from "bullmq";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import redis from "../config/redis.js";
import {
    deploymentSuccessStatus,
    deploymentErrorStatus,
    markDeploymentDeploying,
    getDeploymentRecord,
    createDeploymentLog
} from "../modules/deployment/deployment.service.js";
import {
    runDeploymentPipeline,
    assertSafeRepositoryUrl,
    cleanupDockerResources,
    reapSupersededDeployments
} from "./deployment.pipeline.js";
import {
    deploymentTotal,
    deploymentSuccessTotal,
    deploymentFailureTotal,
    deploymentActive,
    deploymentDurationSeconds
} from "../observability/metrics.js";

export const deploymentWorker = new Worker(
    "deployment",
    async (job) => {
        const { deploymentId } = job.data as { deploymentId: number };

        // --- Task 1: source of truth is the DB, not the job payload ---------
        const deployment = await getDeploymentRecord(deploymentId);
        // If the row itself is missing we cannot write logs against it (FK),
        // so this is the only failure that bypasses the ERROR-log path.
        if (!deployment) {
            throw new Error(`Deployment ${deploymentId} not found`);
        }

        const projectId = deployment.projectId;
        let workDir: string | undefined;

        deploymentTotal.inc();
        deploymentActive.inc();
        const startedAt = Date.now();

        // Single, clear failure path for everything below (Task 18).
        try {
            if (!deployment.project) {
                throw new Error(`Project ${projectId} not found`);
            }

            const repositoryUrl = deployment.project.repositoryUrl;
            if (!repositoryUrl) {
                throw new Error("Project repositoryUrl is missing; cannot deploy");
            }
            // Fail fast on unsafe/unsupported repository URLs.
            assertSafeRepositoryUrl(repositoryUrl);

            // Reset state so retries start clean.
            await markDeploymentDeploying(deploymentId);
            await createDeploymentLog(deploymentId, "INFO", "Deployment started");

            // --- Task 2: unique, isolated work directory --------------------
            const baseDir = path.join(tmpdir(), "minicloud");
            await mkdir(baseDir, { recursive: true });
            workDir = await mkdtemp(
                path.join(baseDir, `deployment-${deploymentId}-`)
            );

            await runDeploymentPipeline({
                deploymentId,
                projectId,
                branch: deployment.branch,
                commitHash: deployment.commitHash,
                repositoryUrl,
                workDir
            });

            await deploymentSuccessStatus(deploymentId);
            await createDeploymentLog(deploymentId, "INFO", "Deployment successful");

            // Keep only this (latest) container per project; reap older ones so
            // successful deployments do not pile up and leak host resources.
            await reapSupersededDeployments(projectId, deploymentId);

            deploymentSuccessTotal.inc();
            deploymentDurationSeconds.observe(
                { status: "success" },
                (Date.now() - startedAt) / 1000
            );
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "Deployment failed";

            deploymentFailureTotal.inc();
            deploymentDurationSeconds.observe(
                { status: "error" },
                (Date.now() - startedAt) / 1000
            );

            await deploymentErrorStatus(deploymentId, message);
            await createDeploymentLog(
                deploymentId,
                "ERROR",
                `Deployment failed: ${message}`
            );

            // Remove partial container/image so a failed attempt leaves nothing
            // running. Deterministic names ensure we only touch THIS deployment.
            await cleanupDockerResources(projectId, deploymentId);

            // Re-throw so BullMQ records the failure and can retry.
            throw error;
        } finally {
            deploymentActive.dec();
            // --- Task 13: always clean the work directory (if created) ------
            if (workDir) {
                await rm(workDir, { recursive: true, force: true });
            }
        }
    },
    {
        connection: redis,
        // Process several deployments in parallel instead of one-at-a-time.
        // Each deployment is isolated (own temp dir + uniquely named container),
        // so this is safe. Tune via WORKER_CONCURRENCY.
        concurrency: Number(process.env.WORKER_CONCURRENCY) || 3
    }
);

deploymentWorker.on("completed", (job) => {
    console.log(`Deployment job ${job.id} completed`);
});

deploymentWorker.on("failed", (job, error) => {
    console.error(`Deployment job ${job?.id} failed:`, error.message);
});
