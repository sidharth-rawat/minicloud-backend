import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    assertSafeRepositoryUrl,
    assertValidCommit,
    detectPackageManager,
    imageNameFor,
    containerNameFor
} from "./deployment.pipeline.js";

describe("assertSafeRepositoryUrl", () => {
    it("accepts a plain public GitHub HTTPS URL", () => {
        expect(() =>
            assertSafeRepositoryUrl("https://github.com/owner/repo")
        ).not.toThrow();
    });

    it("rejects non-github hosts (SSRF surface)", () => {
        expect(() =>
            assertSafeRepositoryUrl("https://evil.example.com/owner/repo")
        ).toThrow();
    });

    it.each([
        "file:///etc/passwd",
        "git://github.com/owner/repo",
        "ssh://git@github.com/owner/repo",
        "ext::sh -c whoami",
        "https://user:pass@github.com/owner/repo"
    ])("rejects dangerous transport / embedded creds: %s", (url) => {
        expect(() => assertSafeRepositoryUrl(url)).toThrow();
    });
});

describe("assertValidCommit", () => {
    it("accepts a 40-char sha and a short sha", () => {
        expect(() =>
            assertValidCommit("a".repeat(40))
        ).not.toThrow();
        expect(() => assertValidCommit("abc1234")).not.toThrow();
    });

    it("rejects injection-y / malformed hashes", () => {
        expect(() => assertValidCommit("main; rm -rf /")).toThrow();
        expect(() => assertValidCommit("xyz")).toThrow();
    });
});

describe("detectPackageManager", () => {
    let dir: string;

    beforeAll(async () => {
        dir = await mkdtemp(path.join(tmpdir(), "pm-detect-"));
    });
    afterAll(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("detects pnpm > yarn > npm and falls back to npm install", async () => {
        // npm ci when only package-lock.json exists
        await writeFile(path.join(dir, "package-lock.json"), "{}");
        expect((await detectPackageManager(dir)).name).toBe("npm");
        expect((await detectPackageManager(dir)).install).toEqual(["ci"]);

        // yarn wins over npm
        await writeFile(path.join(dir, "yarn.lock"), "");
        expect((await detectPackageManager(dir)).name).toBe("yarn");

        // pnpm wins over all
        await writeFile(path.join(dir, "pnpm-lock.yaml"), "");
        expect((await detectPackageManager(dir)).name).toBe("pnpm");
    });

    it("falls back to npm install with no lockfile", async () => {
        const empty = await mkdtemp(path.join(tmpdir(), "pm-empty-"));
        const pm = await detectPackageManager(empty);
        expect(pm.name).toBe("npm");
        expect(pm.install).toEqual(["install"]);
        await rm(empty, { recursive: true, force: true });
    });
});

describe("resource naming", () => {
    it("is deterministic and unique per deployment", () => {
        expect(imageNameFor(1, 2)).toBe("minicloud-project-1-deployment-2");
        expect(containerNameFor(2)).toBe("minicloud-deployment-2");
        expect(imageNameFor(1, 2)).not.toBe(imageNameFor(1, 3));
    });
});
