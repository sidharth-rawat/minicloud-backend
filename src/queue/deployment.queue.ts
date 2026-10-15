import { Queue } from "bullmq";
import redis from "../config/redis.js";

export const deploymentQueue = new Queue("deployment", {
    connection: redis,
    defaultJobOptions: {
        // BullMQ handles retries/backoff — the worker never retries itself.
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 5_000
        },
        removeOnComplete: 100,
        removeOnFail: 500
    }
});