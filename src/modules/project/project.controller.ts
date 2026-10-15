import type { Request, Response } from "express";
import {
    createProject,
    getProjects,
    getProjectById,
    updateProject,
    deleteProject
} from "./project.service.js";
import { ZodError } from "zod";
import { projectCreationValidation, projectUpdateValidation } from "./project.validation.js";


export const createProjectController = async (
    req: Request,
    res: Response
) => {
    try {
        const data = projectCreationValidation.parse(req.body);

        const userId = req.user!.user_id;
        const { name, description, repositoryUrl } = data;

        const result = await createProject(
            name,
            description,
            userId,
            repositoryUrl
        );

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


export const getProjectController = async (
    req: Request,
    res: Response
) => {
    try {
        const userId = req.user!.user_id;

        const result = await getProjects(userId);

        // An empty list is a valid result for a dashboard, not a 404.
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


export const getProjectIDController = async (
    req: Request,
    res: Response
) => {
    try {
        const userId = req.user!.user_id;
        const { id } = req.params;

        const projectId = Number(id);

        if (!Number.isInteger(projectId) || projectId <= 0) {
            return res.status(400).json({
                message: "Invalid project ID"
            });
        }

        const result = await getProjectById(
            userId,
            projectId
        );

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

export const deleteProjectController = async (
    req: Request,
    res: Response
) => {
    try {
        const userId = req.user!.user_id;
        const { id } = req.params;

        const projectId = Number(id);

        if (!Number.isInteger(projectId) || projectId <= 0) {
            return res.status(400).json({
                message: "Invalid project ID"
            });
        }

        const result = await deleteProject(userId, projectId);

        if (!result) {
            return res.status(404).json({
                message: "Project not found"
            });
        }

        return res.status(200).json({
            message: "Project deleted",
            project: result
        });

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

export const updateProjectController = async (
    req: Request,
    res: Response
) => {
    try {
        const userId = req.user!.user_id;
        const { id } = req.params;

        const projectId = Number(id);

        if (!Number.isInteger(projectId) || projectId <= 0) {
            return res.status(400).json({
                message: "Invalid project ID"
            });
        }

        const data = projectUpdateValidation.parse(req.body);

        if (Object.keys(data).length === 0) {
            return res.status(400).json({
                message: "At least one field is required"
            });
        }

        const result = await updateProject(
            userId,
            projectId,
            data
        );

        if (!result) {
            return res.status(404).json({
                message: "Project not found"
            });
        }

        return res.status(200).json(result);

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