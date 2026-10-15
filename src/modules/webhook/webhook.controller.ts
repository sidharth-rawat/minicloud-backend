import type { Request, Response } from "express"
import { extractGithubPushData, findProjectByRepository, verifyGithubSignature } from "./webhook.service.js";
import { createDeployment } from "../deployment/deployment.service.js";
import { deploymentQueue } from "../../queue/deployment.queue.js";

export const githubWebook = async (req: Request, res: Response) => {
    try {
        // Verify the payload signature before trusting anything in the body.
        const signature = req.headers['x-hub-signature-256'];
        if (!verifyGithubSignature(
            req.rawBody,
            typeof signature === "string" ? signature : undefined
        )) {
            return res.status(401).json({ message: "Invalid webhook signature" });
        }

        const event = req.headers['x-github-event'];

        // Only push events trigger a deployment. Acknowledge others
        // (e.g. GitHub's "ping" on webhook creation) without processing.
        if (event !== 'push') {
            return res.status(200).json({
                message: `Ignored event: ${event}`
            });
        }

        const { branch, commitHash, repository } = extractGithubPushData(req.body);

        const project = await findProjectByRepository(repository);

        if (!project) {
            return res.status(404).json({
                message: "No project found for this repository"
            });
        }

        // Reuse createDeployment with the project's owner so the existing
        // ownership check passes for this server-to-server webhook call.
        const deployment = await createDeployment(
            project.userId,
            project.id,
            { branch, commitHash }
        );

        if (!deployment) {
            return res.status(404).json({
                message: "Project not found"
            });
        }

        await deploymentQueue.add("deploy-project", {
            projectId: project.id,
            userId: project.userId,
            deploymentId: deployment.id
        });

        return res.status(201).json({
            message: "Deployment created successfully",
            deployment
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
}
