import { prisma } from "../../lib/prisma.js";
import type { DeploymentCreate } from "./deployment.validation.js";

async function findOwnedProject(userId: number, projectId: number) {
    return prisma.project.findFirst({
        where: {
            id: projectId,
            userId
        }
    });
}

export async function createDeployment(
    userId: number,
    projectId: number,
    data: DeploymentCreate
) {
    const project = await findOwnedProject(userId, projectId);

    if (!project) {
        return null;
    }

    const deployment = await prisma.deployment.create({
        data: {
            projectId,
            branch: data.branch,
            commitHash: data.commitHash,
            status: "DEPLOYING"
        }
    });

    return deployment;
}
// Fetch everything the worker needs from the DB (source of truth) in one go:
// the deployment fields plus the owning project (for repositoryUrl).
export async function getDeploymentRecord(deploymentId: number) {
    return prisma.deployment.findUnique({
        where: {
            id: deploymentId
        },
        include: {
            project: true
        }
    });
}

// Reset a deployment to DEPLOYING at the start of a (re)attempt. Clears any
// error state from a previous failed attempt so retries stay consistent.
export async function markDeploymentDeploying(deploymentId: number) {
    return prisma.deployment.update({
        where: {
            id: deploymentId
        },
        data: {
            status: "DEPLOYING",
            errorMessage: null,
            finishedAt: null
        }
    });
}

export async function deploymentSuccessStatus(deploymentId: number) {
    return prisma.deployment.update({
        where: {
            id: deploymentId
        },
        data: {
            status: "SUCCESS",
            errorMessage: null,
            finishedAt: new Date()
        }
    });
}

export async function deploymentErrorStatus(
    deploymentId: number,
    errorMessage: string
) {
    return prisma.deployment.update({
        where: {
            id: deploymentId
        },
        data: {
            status: "ERROR",
            errorMessage,
            finishedAt: new Date()
        }
    });
}
export async function getDeployments(
    userId: number,
    projectId: number
) {
    const project = await findOwnedProject(userId, projectId);

    if (!project) {
        return null;
    }

    const deployments = await prisma.deployment.findMany({
        where: {
            projectId
        },
        orderBy: {
            createdAt: "desc"
        }
    });

    return deployments;
}

export async function getDeploymentById(
    userId: number,
    projectId: number,
    deploymentId: number
) {
    const project = await findOwnedProject(userId, projectId);

    if (!project) {
        return null;
    }

    const deployment = await prisma.deployment.findFirst({
        where: {
            id: deploymentId,
            projectId
        }
    });

    return deployment;
}

// Re-run an existing deployment. Returns the same deployment row (reset to
// DEPLOYING by the worker on pickup) so the caller can re-queue it. The worker
// reuses deterministic image/container names, so re-running is idempotent and
// does not spawn duplicate containers.
export async function retryDeployment(
    userId: number,
    projectId: number,
    deploymentId: number
) {
    const deployment = await getDeploymentById(userId, projectId, deploymentId);

    if (!deployment) {
        return null;
    }

    return prisma.deployment.update({
        where: { id: deploymentId },
        data: {
            status: "DEPLOYING",
            errorMessage: null,
            finishedAt: null
        }
    });
}

// Roll back to a previous deployment by creating a NEW deployment that points
// at the same commit. Historical records are never mutated. Only a SUCCESS
// deployment is a valid rollback target.
export async function rollbackDeployment(
    userId: number,
    projectId: number,
    deploymentId: number
) {
    const target = await getDeploymentById(userId, projectId, deploymentId);

    if (!target) {
        return { ok: false as const, error: "not_found" as const };
    }

    if (target.status !== "SUCCESS") {
        return { ok: false as const, error: "not_successful" as const };
    }

    const deployment = await prisma.deployment.create({
        data: {
            projectId,
            branch: target.branch,
            commitHash: target.commitHash,
            status: "DEPLOYING"
        }
    });

    return { ok: true as const, deployment };
}

export async function getDeploymentLogs(
    userId: number,
    projectId: number,
    deploymentId: number
) {
    const deployment = await getDeploymentById(
        userId,
        projectId,
        deploymentId
    );

    if (!deployment) {
        return null;
    }

    const logs = await prisma.deploymentLog.findMany({
        where: {
            deploymentId
        },
        orderBy: {
            createdAt: "asc"
        }
    });

    return { logs };
}

type LogStatus = "INFO" | "WARNING" | "ERROR";

// Reusable log writer used by the worker to record each deployment step.
export async function createDeploymentLog(
    deploymentId: number,
    status: LogStatus,
    message: string
) {
    return prisma.deploymentLog.create({
        data: {
            deploymentId,
            status,
            message
        }
    });
}
