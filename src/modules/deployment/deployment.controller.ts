import type { Request, Response } from "express";
import {
    createDeployment,
    getDeployments,
    getDeploymentById,
    getDeploymentLogs,
    retryDeployment,
    rollbackDeployment
} from "./deployment.service.js";
import { ZodError } from "zod";
import { deploymentCreationValidation } from "./deployment.validation.js";
import { deploymentQueue } from "../../queue/deployment.queue.js";
function parseId(value: string | string[] | undefined) {
    if (typeof value !== "string") {
        return null;
    }

    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
        return null;
    }

    return id;
}

export const createDeploymentController = async (
    req: Request,
    res: Response
) => {
    try {
        const userId = req.user!.user_id;

        const projectId = parseId(req.params.projectId);

        if (projectId === null) {
            return res.status(400).json({
                message: "Invalid project ID"
            });
        }

        const data = deploymentCreationValidation.parse(req.body);

        const result = await createDeployment(
            userId,
            projectId,
            data
        );
        
        if (!result) {
            return res.status(404).json({
                message: "Project not found"
            });
        }
        await deploymentQueue.add("deploy-project", {
                projectId,
                userId,
                deploymentId:result.id
        });
        
        return res.status(201).json(result);

    } catch (error) {

        if (error instanceof ZodError) {
            return res.status(400).json({
                message: "Validation failed",
                errors: error.issues
            });
        }

        if (error instanceof Error) {
            return res.status(400).json({
                message: error.message
            });
        }

        return res.status(500).json({
            message: "Something went wrong"
        });
    }
};

export const getDeploymentsController = async (
    req: Request,
    res: Response
) => {
    try {
        const userId = req.user!.user_id;

        const projectId = parseId(req.params.projectId);

        if (projectId === null) {
            return res.status(400).json({
                message: "Invalid project ID"
            });
        }

        const result = await getDeployments(userId, projectId);

        if (!result) {
            return res.status(404).json({
                message: "Project not found"
            });
        }

        return res.status(200).json(result);

    } catch (error) {

        if (error instanceof Error) {
            return res.status(400).json({
                message: error.message
            });
        }

        return res.status(500).json({
            message: "Something went wrong"
        });
    }
};

export const getDeploymentByIdController = async (
    req: Request,
    res: Response
) => {
    try {
        const userId = req.user!.user_id;

        const projectId = parseId(req.params.projectId);
        const deploymentId = parseId(req.params.deploymentId);

        if (projectId === null || deploymentId === null) {
            return res.status(400).json({
                message: "Invalid project or deployment ID"
            });
        }

        const result = await getDeploymentById(
            userId,
            projectId,
            deploymentId
        );

        if (!result) {
            return res.status(404).json({
                message: "Deployment not found"
            });
        }

        return res.status(200).json(result);

    } catch (error) {

        if (error instanceof Error) {
            return res.status(400).json({
                message: error.message
            });
        }

        return res.status(500).json({
            message: "Something went wrong"
        });
    }
};

export const retryDeploymentController = async (
    req: Request,
    res: Response
) => {
    try {
        const userId = req.user!.user_id;
        const projectId = parseId(req.params.projectId);
        const deploymentId = parseId(req.params.deploymentId);

        if (projectId === null || deploymentId === null) {
            return res.status(400).json({
                message: "Invalid project or deployment ID"
            });
        }

        const result = await retryDeployment(userId, projectId, deploymentId);

        if (!result) {
            return res.status(404).json({ message: "Deployment not found" });
        }

        await deploymentQueue.add("deploy-project", {
            projectId,
            userId,
            deploymentId: result.id
        });

        return res.status(201).json(result);
    } catch (error) {
        if (error instanceof Error) {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: "Something went wrong" });
    }
};

export const rollbackDeploymentController = async (
    req: Request,
    res: Response
) => {
    try {
        const userId = req.user!.user_id;
        const projectId = parseId(req.params.projectId);
        const deploymentId = parseId(req.params.deploymentId);

        if (projectId === null || deploymentId === null) {
            return res.status(400).json({
                message: "Invalid project or deployment ID"
            });
        }

        const result = await rollbackDeployment(userId, projectId, deploymentId);

        if (!result.ok) {
            if (result.error === "not_found") {
                return res.status(404).json({ message: "Deployment not found" });
            }
            return res.status(400).json({
                message: "Can only roll back to a successful deployment"
            });
        }

        await deploymentQueue.add("deploy-project", {
            projectId,
            userId,
            deploymentId: result.deployment.id
        });

        return res.status(201).json(result.deployment);
    } catch (error) {
        if (error instanceof Error) {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: "Something went wrong" });
    }
};

export const getDeploymentLogsController = async (
    req: Request,
    res: Response
) => {
    try {
        const userId = req.user!.user_id;

        const projectId = parseId(req.params.projectId);
        const deploymentId = parseId(req.params.deploymentId);

        if (projectId === null || deploymentId === null) {
            return res.status(400).json({
                message: "Invalid project or deployment ID"
            });
        }

        const result = await getDeploymentLogs(
            userId,
            projectId,
            deploymentId
        );

        if (!result) {
            return res.status(404).json({
                message: "Deployment not found"
            });
        }

        return res.status(200).json(result.logs);

    } catch (error) {

        if (error instanceof Error) {
            return res.status(400).json({
                message: error.message
            });
        }

        return res.status(500).json({
            message: "Something went wrong"
        });
    }
};
