import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../lib/exec.js";
import { createDeploymentLog } from "../modules/deployment/deployment.service.js";

// --- Tunable constants (kept simple; overridable via env) ------------------

const TIMEOUTS = {
    clone: 120_000,
    checkout: 60_000,
    install: 300_000,
    test: 300_000,
    build: 300_000,
    dockerBuild: 600_000,
    dockerRun: 60_000
};

// Resource limits applied to every deployed container so one noisy app cannot
// exhaust the host's CPU/RAM (container isolation). Overridable via env.
const CONTAINER_MEMORY = process.env.DEPLOY_CONTAINER_MEMORY || "512m";
const CONTAINER_CPUS = process.env.DEPLOY_CONTAINER_CPUS || "1";

// Port the deployed app is expected to listen on INSIDE its container.
const APP_PORT = Number(process.env.DEPLOY_APP_PORT) || 3000;
const HEALTH_PATH = process.env.DEPLOY_HEALTH_PATH || "/health";
const HEALTH_ATTEMPTS = 10;
const HEALTH_INTERVAL_MS = 2_000;
const HEALTH_REQUEST_TIMEOUT_MS = 3_000;

// Git hardening: never prompt for credentials, and only allow the https
// protocol so a crafted repo cannot use file://, ext::, ssh:// etc.
const GIT_ENV: NodeJS.ProcessEnv = {
    GIT_TERMINAL_PROMPT: "0",
    GIT_ALLOW_PROTOCOL: "https"
};

export interface PipelineInput {
    deploymentId: number;
    projectId: number;
    branch: string;
    commitHash: string;
    repositoryUrl: string;
    workDir: string;
}

export interface PipelineResult {
    imageName: string;
    containerName: string;
    hostPort: string;
}

// --- Security helpers ------------------------------------------------------

/**
 * Only allow plain public GitHub HTTPS URLs. This blocks SSRF and dangerous
 * git transports (file://, ssh://, git://, ext::) and rejects embedded
 * credentials, since MiniCloud only deploys public GitHub repos.
 */
export function assertSafeRepositoryUrl(url: string): void {
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(url)) {
        throw new Error(
            "Unsupported repository URL. Only https://github.com/<owner>/<repo> is allowed."
        );
    }
}

export function assertValidCommit(hash: string): void {
    if (!/^[0-9a-f]{7,40}$/i.test(hash)) {
        throw new Error("Invalid commit hash format.");
    }
}

// Deterministic resource names -> a retry reuses the same names instead of
// creating duplicates (see markDeploymentDeploying + rm -f in worker).
export function imageNameFor(projectId: number, deploymentId: number): string {
    return `minicloud-project-${projectId}-deployment-${deploymentId}`;
}

export function containerNameFor(deploymentId: number): string {
    return `minicloud-deployment-${deploymentId}`;
}

// --- Small filesystem helpers ---------------------------------------------

async function fileExists(p: string): Promise<boolean> {
    try {
        await access(p);
        return true;
    } catch {
        return false;
    }
}

async function readPackageJson(workDir: string): Promise<any | null> {
    try {
        const raw = await readFile(path.join(workDir, "package.json"), "utf8");
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

interface PackageManager {
    name: "npm" | "yarn" | "pnpm";
    install: string[];
}

export async function detectPackageManager(workDir: string): Promise<PackageManager> {
    if (await fileExists(path.join(workDir, "pnpm-lock.yaml"))) {
        return { name: "pnpm", install: ["install", "--frozen-lockfile"] };
    }
    if (await fileExists(path.join(workDir, "yarn.lock"))) {
        return { name: "yarn", install: ["install", "--frozen-lockfile"] };
    }
    if (await fileExists(path.join(workDir, "package-lock.json"))) {
        return { name: "npm", install: ["ci"] };
    }
    // No lockfile: deterministic install is impossible, fall back to install.
    return { name: "npm", install: ["install"] };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Pipeline --------------------------------------------------------------

/**
 * Runs the full source -> container pipeline for one deployment.
 * Every stage throws on failure; the caller (worker) turns that into an
 * ERROR status + log and performs cleanup. On success the container is left
 * running and its image kept.
 */
export async function runDeploymentPipeline(
    input: PipelineInput
): Promise<PipelineResult> {
    const { deploymentId, projectId, branch, commitHash, repositoryUrl, workDir } = input;

    // Defensive re-validation inside the pipeline itself.
    assertSafeRepositoryUrl(repositoryUrl);
    assertValidCommit(commitHash);

    // 1. Clone (into the isolated work dir; `--` prevents option injection).
    await createDeploymentLog(deploymentId, "INFO", "Cloning repository");
    await runCommand(
        "git",
        ["clone", "--branch", branch, "--", repositoryUrl, workDir],
        { timeout: TIMEOUTS.clone, env: GIT_ENV }
    );
    await createDeploymentLog(deploymentId, "INFO", "Repository cloned successfully");

    // 2. Checkout the EXACT commit that triggered this deployment.
    await createDeploymentLog(deploymentId, "INFO", "Checking out commit");
    await runCommand("git", ["-C", workDir, "checkout", "--detach", commitHash], {
        timeout: TIMEOUTS.checkout,
        env: GIT_ENV
    });
    await createDeploymentLog(deploymentId, "INFO", "Commit checked out successfully");

    // 3. Install dependencies with the detected package manager.
    const pm = await detectPackageManager(workDir);
    await createDeploymentLog(
        deploymentId,
        "INFO",
        `Installing dependencies (${pm.name})`
    );
    await runCommand(pm.name, pm.install, {
        cwd: workDir,
        timeout: TIMEOUTS.install
    });
    await createDeploymentLog(deploymentId, "INFO", "Dependencies installed successfully");

    // 4. Tests (skip cleanly if there is no test script).
    const pkg = await readPackageJson(workDir);
    if (pkg?.scripts?.test) {
        await createDeploymentLog(deploymentId, "INFO", "Running tests");
        await runCommand(pm.name, ["run", "test"], {
            cwd: workDir,
            timeout: TIMEOUTS.test
        });
        await createDeploymentLog(deploymentId, "INFO", "Tests passed");
    } else {
        await createDeploymentLog(
            deploymentId,
            "WARNING",
            "No test script found, skipping tests"
        );
    }

    // 5. Build (skip cleanly if there is no build script).
    if (pkg?.scripts?.build) {
        await createDeploymentLog(deploymentId, "INFO", "Building application");
        await runCommand(pm.name, ["run", "build"], {
            cwd: workDir,
            timeout: TIMEOUTS.build
        });
        await createDeploymentLog(deploymentId, "INFO", "Application built successfully");
    } else {
        await createDeploymentLog(
            deploymentId,
            "WARNING",
            "No build script found, skipping build"
        );
    }

    // 6. Docker image (requires a Dockerfile; fail clearly if absent).
    if (!(await fileExists(path.join(workDir, "Dockerfile")))) {
        throw new Error("No Dockerfile found in repository root");
    }

    const imageName = imageNameFor(projectId, deploymentId);
    const containerName = containerNameFor(deploymentId);

    await createDeploymentLog(deploymentId, "INFO", "Building Docker image");
    await runCommand("docker", ["build", "-t", imageName, workDir], {
        timeout: TIMEOUTS.dockerBuild
    });
    await createDeploymentLog(deploymentId, "INFO", "Docker image built successfully");

    // 7. Run container. Remove any leftover container with the same name
    //    first (idempotent across retries), publish to an ephemeral host port
    //    to avoid collisions.
    await createDeploymentLog(deploymentId, "INFO", "Starting deployment container");
    await removeContainer(containerName);
    await runCommand(
        "docker",
        [
            "run",
            "-d",
            "--name",
            containerName,
            // Resource isolation: cap memory and CPU so a single deployment
            // cannot starve the host or its neighbours.
            "--memory",
            CONTAINER_MEMORY,
            "--cpus",
            CONTAINER_CPUS,
            // Label every container with its project so superseded deployments
            // can be reaped (garbage collected) later.
            "--label",
            `minicloud.project=${projectId}`,
            "-p",
            `127.0.0.1:0:${APP_PORT}`,
            imageName
        ],
        { timeout: TIMEOUTS.dockerRun }
    );

    const hostPort = await resolveHostPort(containerName);
    await createDeploymentLog(
        deploymentId,
        "INFO",
        `Deployment container started on host port ${hostPort}`
    );

    // 8. Health check with retry + timeout.
    await createDeploymentLog(deploymentId, "INFO", "Waiting for application health check");
    await waitForHealthy(hostPort);
    await createDeploymentLog(deploymentId, "INFO", "Application is healthy");

    return { imageName, containerName, hostPort };
}

// --- Docker helpers --------------------------------------------------------

async function removeContainer(containerName: string): Promise<void> {
    // Best-effort: ignore "no such container".
    try {
        await runCommand("docker", ["rm", "-f", containerName], { timeout: 30_000 });
    } catch {
        /* nothing to remove */
    }
}

async function resolveHostPort(containerName: string): Promise<string> {
    const { stdout } = await runCommand(
        "docker",
        ["port", containerName, `${APP_PORT}/tcp`],
        { timeout: 15_000 }
    );
    // stdout looks like "127.0.0.1:54321"
    const match = stdout.trim().split("\n")[0]?.split(":").pop()?.trim();
    if (!match) {
        throw new Error("Could not determine published host port for container");
    }
    return match;
}

async function waitForHealthy(hostPort: string): Promise<void> {
    const url = `http://127.0.0.1:${hostPort}${HEALTH_PATH}`;

    for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++) {
        try {
            const res = await fetch(url, {
                signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS)
            });
            if (res.ok) {
                return;
            }
        } catch {
            /* not up yet */
        }
        await sleep(HEALTH_INTERVAL_MS);
    }

    throw new Error(
        `Health check failed: ${url} did not become healthy after ${HEALTH_ATTEMPTS} attempts`
    );
}

/**
 * Removes this deployment's container and image. Used on failure so a broken
 * attempt does not leave resources behind. Deterministic names guarantee we
 * only touch THIS deployment's resources.
 */
export async function cleanupDockerResources(
    projectId: number,
    deploymentId: number
): Promise<void> {
    const containerName = containerNameFor(deploymentId);
    const imageName = imageNameFor(projectId, deploymentId);

    await removeContainer(containerName);
    try {
        await runCommand("docker", ["rmi", "-f", imageName], { timeout: 60_000 });
    } catch {
        /* image may not exist yet */
    }
}

/**
 * Garbage-collects a project's older deployment containers/images, keeping only
 * the one just deployed (`keepDeploymentId`). Without this, every successful
 * deployment would leave its container running forever, leaking host RAM/disk.
 * Containers are matched by the `minicloud.project=<id>` label set at run time,
 * so we never touch another project's resources. Best-effort: failures here
 * must not fail an otherwise-successful deployment.
 */
export async function reapSupersededDeployments(
    projectId: number,
    keepDeploymentId: number
): Promise<void> {
    let stdout = "";
    try {
        ({ stdout } = await runCommand(
            "docker",
            [
                "ps",
                "-a",
                "--filter",
                `label=minicloud.project=${projectId}`,
                "--format",
                "{{.Names}}"
            ],
            { timeout: 30_000 }
        ));
    } catch {
        return; // cannot list -> nothing we can safely do
    }

    const keep = containerNameFor(keepDeploymentId);
    const names = stdout
        .split("\n")
        .map((n) => n.trim())
        .filter((n) => n.length > 0 && n !== keep);

    for (const name of names) {
        const did = Number(name.replace("minicloud-deployment-", ""));
        await removeContainer(name);
        if (Number.isInteger(did)) {
            try {
                await runCommand(
                    "docker",
                    ["rmi", "-f", imageNameFor(projectId, did)],
                    { timeout: 60_000 }
                );
            } catch {
                /* image may already be gone */
            }
        }
    }
}
