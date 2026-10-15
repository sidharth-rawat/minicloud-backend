import { prisma } from "./lib/prisma.js";
import { app } from "./app.js";
// Importing the worker starts the BullMQ consumer in the same process. For a
// separate worker process, import "./worker/deployment.worker.js" from its own
// entrypoint instead.
import "./worker/deployment.worker.js";
import { PORT } from "./config/env.js";
import redis from "./config/redis.js";

async function startService() {
    await prisma
        .$connect()
        .then(() => console.log("Database connected"))
        .catch((error) => console.error("Database connection failed", error));

    await redis.ping();

    const server = app.listen(PORT, () => {
        console.log(`Server is running ${PORT}`);
    });
    return server;
}

const server = await startService();

async function shutDown(name: string) {
    console.log(`Shutting down server (${name})...`);

    await prisma.$disconnect();
    await redis.quit();
    server.close(() => {
        console.log("Server closed");
        process.exit(0);
    });
}

process.on("SIGTERM", () => shutDown("SIGTERM"));
process.on("SIGINT", () => shutDown("SIGINT"));
