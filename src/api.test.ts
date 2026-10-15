import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Mock the BullMQ queue so integration tests need no Redis and never actually
// enqueue a deployment. We only assert that enqueue is attempted.
// vi.hoisted lets the mock factory (hoisted to top) reference addMock safely.
const { addMock } = vi.hoisted(() => ({
    addMock: vi.fn().mockResolvedValue({ id: "job-test" })
}));
vi.mock("./queue/deployment.queue.js", () => ({
    deploymentQueue: { add: addMock }
}));

// A JWT secret must exist for login/token verification during tests.
process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || "test-secret";

// These integration tests exercise webhook ROUTING in dev mode (unsigned
// requests). Signature verification itself is covered by webhook.test.ts, so
// clear any real secret leaking in from .env to keep this suite deterministic.
delete process.env.GITHUB_WEBHOOK_SECRET;

import request from "supertest";
import { app } from "./app.js";
import { prisma } from "./lib/prisma.js";

const stamp = Date.now();
const emailA = `alice+${stamp}@example.com`;
const emailB = `bob+${stamp}@example.com`;
const repoFullName = `testowner/testrepo-${stamp}`;
const repoUrl = `https://github.com/${repoFullName}`;

let tokenA = "";
let tokenB = "";
let projectAId = 0;

async function cleanup() {
    const users = await prisma.user.findMany({
        where: { email: { in: [emailA, emailB] } },
        select: { id: true }
    });
    const userIds = users.map((u) => u.id);
    if (userIds.length === 0) return;

    const projects = await prisma.project.findMany({
        where: { userId: { in: userIds } },
        select: { id: true }
    });
    const projectIds = projects.map((p) => p.id);

    if (projectIds.length > 0) {
        const deployments = await prisma.deployment.findMany({
            where: { projectId: { in: projectIds } },
            select: { id: true }
        });
        const deploymentIds = deployments.map((d) => d.id);
        if (deploymentIds.length > 0) {
            await prisma.deploymentLog.deleteMany({
                where: { deploymentId: { in: deploymentIds } }
            });
            await prisma.deployment.deleteMany({
                where: { projectId: { in: projectIds } }
            });
        }
        await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

beforeAll(async () => {
    await cleanup();
});
afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
});

describe("auth", () => {
    it("registers and logs in a user", async () => {
        const reg = await request(app).post("/auth/register").send({
            firstName: "Alice",
            lastName: "Doe",
            email: emailA,
            password: "password123"
        });
        expect(reg.status).toBe(201);
        expect(reg.body.passwordHash).toBeUndefined();

        const login = await request(app)
            .post("/auth/login")
            .send({ email: emailA, password: "password123" });
        expect(login.status).toBe(201);
        expect(login.body.token).toBeTruthy();
        tokenA = login.body.token;
    });

    it("rejects /auth/me without a token", async () => {
        const res = await request(app).get("/auth/me");
        expect(res.status).toBe(401);
    });

    it("returns the current user with a valid token", async () => {
        const res = await request(app)
            .get("/auth/me")
            .set("Authorization", `Bearer ${tokenA}`);
        expect(res.status).toBe(200);
        expect(res.body.email).toBe(emailA);
    });
});

describe("projects + ownership", () => {
    it("creates a project", async () => {
        const res = await request(app)
            .post("/projects")
            .set("Authorization", `Bearer ${tokenA}`)
            .send({ name: "My App", description: "demo", repositoryUrl: repoUrl });
        expect(res.status).toBe(201);
        projectAId = res.body.id;
        expect(projectAId).toBeGreaterThan(0);
    });

    it("lists the owner's projects (200, array)", async () => {
        const res = await request(app)
            .get("/projects")
            .set("Authorization", `Bearer ${tokenA}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.some((p: { id: number }) => p.id === projectAId)).toBe(true);
    });

    it("prevents another user from reading the project", async () => {
        await request(app).post("/auth/register").send({
            firstName: "Bob",
            lastName: "Roe",
            email: emailB,
            password: "password123"
        });
        const login = await request(app)
            .post("/auth/login")
            .send({ email: emailB, password: "password123" });
        tokenB = login.body.token;

        const res = await request(app)
            .get(`/projects/${projectAId}`)
            .set("Authorization", `Bearer ${tokenB}`);
        expect(res.status).toBe(404);
    });
});

describe("deployments", () => {
    it("creates a deployment and enqueues it", async () => {
        addMock.mockClear();
        const res = await request(app)
            .post(`/projects/${projectAId}/deployments`)
            .set("Authorization", `Bearer ${tokenA}`)
            .send({ branch: "main", commitHash: "a".repeat(40) });
        expect(res.status).toBe(201);
        expect(res.body.status).toBe("DEPLOYING");
        expect(addMock).toHaveBeenCalledTimes(1);
    });

    it("blocks a non-owner from creating a deployment", async () => {
        const res = await request(app)
            .post(`/projects/${projectAId}/deployments`)
            .set("Authorization", `Bearer ${tokenB}`)
            .send({ branch: "main", commitHash: "a".repeat(40) });
        expect(res.status).toBe(404);
    });
});

describe("github webhook", () => {
    it("ignores non-push events", async () => {
        const res = await request(app)
            .post("/webhooks/github")
            .set("x-github-event", "ping")
            .send({ zen: "hi" });
        expect(res.status).toBe(200);
    });

    it("creates a deployment for a known repository on push", async () => {
        addMock.mockClear();
        const res = await request(app)
            .post("/webhooks/github")
            .set("x-github-event", "push")
            .send({
                ref: "refs/heads/main",
                after: "b".repeat(40),
                repository: { full_name: repoFullName }
            });
        expect(res.status).toBe(201);
        expect(addMock).toHaveBeenCalledTimes(1);
    });

    it("returns 404 for an unknown repository", async () => {
        const res = await request(app)
            .post("/webhooks/github")
            .set("x-github-event", "push")
            .send({
                ref: "refs/heads/main",
                after: "c".repeat(40),
                repository: { full_name: "nobody/does-not-exist-xyz" }
            });
        expect(res.status).toBe(404);
    });
});
