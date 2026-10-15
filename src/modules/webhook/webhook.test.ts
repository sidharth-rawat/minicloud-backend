import { describe, it, expect, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { extractGithubPushData, verifyGithubSignature } from "./webhook.service.js";

describe("extractGithubPushData", () => {
    it("extracts branch, commit and repo from a push payload", () => {
        const data = extractGithubPushData({
            ref: "refs/heads/main",
            after: "abc123",
            repository: { full_name: "owner/repo" }
        });
        expect(data).toEqual({
            branch: "main",
            commitHash: "abc123",
            repository: "owner/repo"
        });
    });

    it("throws on an invalid payload", () => {
        expect(() => extractGithubPushData({})).toThrow();
        expect(() => extractGithubPushData({ ref: "refs/heads/main" })).toThrow();
    });
});

describe("verifyGithubSignature", () => {
    const OLD = process.env.GITHUB_WEBHOOK_SECRET;
    afterEach(() => {
        if (OLD === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
        else process.env.GITHUB_WEBHOOK_SECRET = OLD;
    });

    it("passes through when no secret is configured (dev mode)", () => {
        delete process.env.GITHUB_WEBHOOK_SECRET;
        expect(verifyGithubSignature(Buffer.from("{}"), undefined)).toBe(true);
    });

    it("accepts a correct signature and rejects a wrong one", () => {
        process.env.GITHUB_WEBHOOK_SECRET = "s3cr3t";
        const body = Buffer.from(JSON.stringify({ ref: "refs/heads/main" }));
        const good =
            "sha256=" +
            createHmac("sha256", "s3cr3t").update(body).digest("hex");

        expect(verifyGithubSignature(body, good)).toBe(true);
        expect(verifyGithubSignature(body, "sha256=deadbeef")).toBe(false);
        expect(verifyGithubSignature(body, undefined)).toBe(false);
    });
});
