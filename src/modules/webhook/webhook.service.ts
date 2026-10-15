import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../../lib/prisma.js";

/**
 * Verifies a GitHub webhook payload against the X-Hub-Signature-256 header.
 *
 * When GITHUB_WEBHOOK_SECRET is not configured this returns true (verification
 * disabled — intended for local development only). When it IS configured, the
 * request is rejected unless the HMAC-SHA256 of the RAW body matches, compared
 * with a constant-time equality check to avoid timing attacks.
 */
export function verifyGithubSignature(
    rawBody: Buffer | undefined,
    signatureHeader: string | undefined
): boolean {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;

    // No secret configured -> signature checking disabled.
    if (!secret) {
        return true;
    }

    if (!rawBody || !signatureHeader) {
        return false;
    }

    const expected =
        "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");

    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(signatureHeader);

    // timingSafeEqual throws if lengths differ, so guard first.
    if (expectedBuf.length !== providedBuf.length) {
        return false;
    }

    return timingSafeEqual(expectedBuf, providedBuf);
}

export interface GithubPushData {
    branch: string;
    commitHash: string;
    repository: string;
}

export function extractGithubPushData(payload: any): GithubPushData {
    const ref: string | undefined = payload?.ref;
    const after: string | undefined = payload?.after;
    const fullName: string | undefined = payload?.repository?.full_name;

    if (!ref || !after || !fullName) {
        throw new Error("Invalid GitHub push payload");
    }

    // ref looks like "refs/heads/main" -> we want the branch name "main".
    const branch = ref.replace("refs/heads/", "");

    return {
        branch,
        commitHash: after,
        repository: fullName
    };
}

// Finds the project whose repositoryUrl matches this GitHub repo.
// The payload gives full_name ("goku/my-project"); projects store the
// full URL ("https://github.com/goku/my-project"), so we build it here.
export async function findProjectByRepository(repository: string) {
    const repositoryUrl = `https://github.com/${repository}`;

    return prisma.project.findFirst({
        where: {
            repositoryUrl
        }
    });
}
