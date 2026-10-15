import express from "express";
import cors from "cors";
import { prisma } from "./lib/prisma.js";
import route from "./modules/auth/auth.routes.js";
import prokectRoute from "./modules/project/project.routes.js";
import webhook from "./modules/webhook/webhook.routes.js";
import { registry } from "./observability/metrics.js";

// Builds the Express application WITHOUT starting the HTTP listener or the
// deployment worker. Keeping this separate makes the app importable in tests.
export function createApp() {
    const app = express();

    // CORS for the frontend dashboard. Comma-separated CORS_ORIGIN, default Vite.
    const corsOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);
    app.use(cors({ origin: corsOrigins }));

    // Capture the raw body so the GitHub webhook can verify its HMAC signature
    // over the exact bytes GitHub sent (JSON.stringify is not byte-identical).
    app.use(
        express.json({
            verify: (req, _res, buf) => {
                (req as express.Request).rawBody = Buffer.from(buf);
            }
        })
    );

    app.use("/auth", route);
    app.use("/projects", prokectRoute);
    app.use("/webhooks", webhook);

    // Prometheus metrics endpoint for basic observability.
    app.get("/metrics", async (_req, res) => {
        res.set("Content-Type", registry.contentType);
        res.end(await registry.metrics());
    });

    app.get("/health", async (_req, res) => {
        try {
            await prisma.$queryRaw`SELECT 1`;
            return res.status(200).json({ status: "OK", database: "connected" });
        } catch {
            return res
                .status(503)
                .json({ status: "ERROR", database: "disconnected" });
        }
    });

    return app;
}

export const app = createApp();
