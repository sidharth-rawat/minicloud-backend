import client from "prom-client";

// A single global registry. Default Node/process metrics are collected too so
// /metrics is useful for basic production-style observability out of the box.
export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const deploymentTotal = new client.Counter({
    name: "deployment_total",
    help: "Total number of deployment jobs processed by the worker",
    registers: [registry]
});

export const deploymentSuccessTotal = new client.Counter({
    name: "deployment_success_total",
    help: "Total number of deployments that finished successfully",
    registers: [registry]
});

export const deploymentFailureTotal = new client.Counter({
    name: "deployment_failure_total",
    help: "Total number of deployments that failed",
    registers: [registry]
});

export const deploymentActive = new client.Gauge({
    name: "deployment_active",
    help: "Number of deployments currently being processed",
    registers: [registry]
});

export const deploymentDurationSeconds = new client.Histogram({
    name: "deployment_duration_seconds",
    help: "Deployment pipeline duration in seconds",
    // Deployments can range from a few seconds to several minutes.
    buckets: [5, 10, 30, 60, 120, 300, 600],
    labelNames: ["status"] as const,
    registers: [registry]
});
