import { prisma } from "../../lib/prisma.js";
import type { ProjectUpdate } from "./project.validation.js";

export async function createProject(
    name: string,
    description: string,
    userId: number,
    repositoryUrl?: string
) {
    const result = await prisma.project.create({
        data: {
            name,
            description,
            userId,
            ...(repositoryUrl !== undefined && { repositoryUrl })
        }
    });

    return result;
}

export async function getProjectRepositoryUrl(projectId: number) {
    const project = await prisma.project.findUnique({
        where: {
            id: projectId
        }
    });

    if (!project) {
        throw new Error(`Project ${projectId} not found`);
    }

    return project.repositoryUrl;
}

export async function getProjects(userId: number) {
    const result = await prisma.project.findMany({
        where: {
            userId
        }
    });

    return result;
}

export async function getProjectById(
    userId: number,
    projectId: number
) {
    const result = await prisma.project.findFirst({
        where: {
            id: projectId,
            userId
        }
    });

    return result;
}
export async function updateProject(
    userId: number,
    projectId: number,
    data: ProjectUpdate
) {
    const project = await prisma.project.findFirst({
        where: {
            id: projectId,
            userId
        }
    });

    if (!project) {
        return null;
    }

    const updateData = {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && {
            description: data.description
        }),
        ...(data.repositoryUrl !== undefined && {
            repositoryUrl: data.repositoryUrl
        })
    };

    const result = await prisma.project.update({
        where: {
            id: projectId
        },
        data: updateData
    });

    return result;
}

export async function deleteProject(
    userId: number,
    projectId: number
) {
    const project = await prisma.project.findFirst({
        where: {
            id: projectId,
            userId
        }
    });

    if (!project) {
        return null;
    }

    // Cascade delete: logs -> deployments -> project, atomically.
    await prisma.$transaction(async (tx) => {
        const deployments = await tx.deployment.findMany({
            where: { projectId },
            select: { id: true }
        });

        const deploymentIds = deployments.map((d) => d.id);

        if (deploymentIds.length > 0) {
            await tx.deploymentLog.deleteMany({
                where: { deploymentId: { in: deploymentIds } }
            });

            await tx.deployment.deleteMany({
                where: { projectId }
            });
        }

        await tx.project.delete({
            where: { id: projectId }
        });
    });

    return project;
}