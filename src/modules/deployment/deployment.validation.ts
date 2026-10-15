import { z } from "zod";

export const deploymentCreationValidation = z.object({
    branch: z.string().min(1, "Branch is required"),
    commitHash: z.string().min(1, "Commit hash is required")
});

export type DeploymentCreate = z.infer<typeof deploymentCreationValidation>;
