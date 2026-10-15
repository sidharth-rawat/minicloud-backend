import { z } from "zod";

export const projectCreationValidation =z.object({
    name:z.string(),
    description:z.string(),
    repositoryUrl: z.url().optional()
})

export const projectUpdateValidation = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    repositoryUrl: z.url().optional()
});

export type ProjectUpdate = z.infer<typeof projectUpdateValidation>;