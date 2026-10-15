import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.test.ts", "test/**/*.test.ts"],
        // Integration tests share one Postgres DB; run files sequentially to
        // keep created rows isolated and cleanup deterministic.
        fileParallelism: false,
        hookTimeout: 30_000,
        testTimeout: 30_000
    }
});
