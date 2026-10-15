# MiniCloud — System Design

> How MiniCloud is designed: the problem, the architecture, the key decisions
> and their trade-offs, and how it would evolve for production scale.

MiniCloud is a mini Heroku/Railway-style platform: connect a GitHub repo to a
project, and every `git push` triggers an asynchronous pipeline that clones the
exact commit, installs, tests, builds, containerises, runs, and health-checks
the app — marking each deployment **SUCCESS** or **ERROR** with full logs.

---

## 1. Problem & goals

**Goal:** a user pushes code to GitHub and, with no manual steps, gets a running
containerised deployment with status and logs — reproducibly, safely, and
asynchronously.

**Functional requirements**

- Auth (register/login), projects (CRUD, per-user ownership).
- GitHub push webhook → deployment of the *exact* pushed commit.
- Full pipeline: clone → checkout → install → test → build → docker build →
  run → health check → SUCCESS/ERROR, with per-stage logs.
- Retry a failed deployment; roll back to a previous successful commit.
- Dashboard to browse projects, deployments, and logs.

**Non-functional requirements**

- **Security:** no command injection, no SSRF, no secret leakage, strict
  ownership isolation.
- **Reliability:** retries, timeouts, cleanup — a failure never leaves orphaned
  containers or temp dirs.
- **Isolation:** one deployment cannot interfere with another.
- **Observability:** structured logs + metrics.

**Explicit non-goals** (kept simple on purpose): no microservices, no
Kubernetes, no multi-region. Single-node by design.

---

## 2. High-level architecture

![MiniCloud architecture](./docs/architecture.png)

**Two repositories, no microservices:**

- `minicloud-backend` — Express API **and** the BullMQ worker in one Node
  process (the worker is imported by `server.ts`). The worker shells out to the
  host's `git` and `docker` binaries.
- `minicloud-frontend` — Vite + React + TypeScript dashboard.

---

## 3. Component responsibilities

| Component | Responsibility |
|-----------|----------------|
| **API** | Auth, validated CRUD, ownership checks, webhook intake, enqueue jobs, expose `/health` and `/metrics`. Returns fast; never deploys synchronously. |
| **PostgreSQL (Prisma)** | Source of truth: users, projects, deployments, logs. |
| **Redis + BullMQ** | Durable job queue with retries, backoff, and concurrency. Decouples the HTTP request from the slow pipeline. |
| **Worker** | Consumes jobs, runs the pipeline, writes status/logs/metrics, cleans up. |
| **Pipeline** | The actual clone→…→health-check steps, each with a timeout and a log line. |
| **Frontend** | Dashboard: projects, deployment history, live-polling logs, retry/rollback. |

---

## 4. Data model

```
User ──1:N──> Project ──1:N──> Deployment ──1:N──> DeploymentLog

User:          id, email (unique), passwordHash, name
Project:       id, name, repositoryUrl (unique), userId      [idx: userId]
Deployment:    id, projectId, branch, commitHash, status,
               startedAt, finishedAt, errorMessage           [idx: projectId]
DeploymentLog: id, deploymentId, level(INFO|WARNING|ERROR),
               message, createdAt                             [idx: deploymentId]

DeploymentStatus = IDLE | DEPLOYING | SUCCESS | ERROR
```

Indexes are placed only on the real query paths (list a user's projects, a
project's deployments, a deployment's logs) — not over-indexed.

---

## 5. The deployment pipeline (worker)

```
1.  Load the deployment from the DB by id   (never trust the job payload)
2.  Validate repository URL + commit hash    (security gate, fail fast)
3.  Create an isolated temp dir  /tmp/minicloud/deployment-<id>-XXXXXX
4.  git clone --branch <branch> -- <url>
5.  git checkout --detach <exact commit>     (reproducible, not "latest")
6.  Detect package manager by lockfile       (npm ci / yarn / pnpm)
7.  install → test (if present) → build (if present)
8.  docker build -t minicloud-project-<pid>-deployment-<did>
9.  docker run  (unique name, ephemeral 127.0.0.1 port, --memory/--cpus limits)
10. Health check  GET /health  (retry + timeout)
11. SUCCESS → status + finishedAt + "Deployment successful" + reap old containers
    ERROR   → status + finishedAt + errorMessage + ERROR log + cleanup, re-throw
12. finally → always remove the temp dir
```

Every stage writes a `DeploymentLog`, so the dashboard shows a live, ordered
trace exactly like a real CI system.

---

## 6. Key design decisions & trade-offs

**DB is the source of truth, not the job payload.**
The worker re-loads the deployment from Postgres by id. A tampered or stale job
can't make it deploy the wrong commit or someone else's repo.

**Asynchronous queue instead of deploying in the request.**
A deploy takes 10–60s. Doing it in the HTTP handler would block the request and
lose work on a crash. BullMQ gives durability, retries, and backpressure; the
webhook returns in milliseconds.

**`execFile` with argument arrays, never a shell.**
`git`/`docker` are invoked as `execFile("git", ["clone", "--", url, dir])`. No
string interpolation touches a shell, so command/argument injection is
structurally impossible. `--` guards stop user input being read as flags.

**Strict repository allowlist.**
Only `https://github.com/<owner>/<repo>` is accepted (regex-validated), and git
runs with `GIT_ALLOW_PROTOCOL=https`. This blocks SSRF and dangerous transports
(`file://`, `git://`, `ssh://`, `ext::`) and embedded credentials.

**Deterministic resource names → idempotent retries.**
Image/container names are derived from ids (`...deployment-<id>`), and the run
step does `docker rm -f` first. A BullMQ retry therefore reuses the same names
instead of spawning duplicate containers.

**Rollback creates a *new* deployment, never mutates history.**
Rolling back to deployment #10 creates deployment #12 with #10's commit, then
runs the normal pipeline. History stays immutable and auditable — the same way
real platforms model it.

**HMAC webhook verification, constant-time.**
`X-Hub-Signature-256` is verified with `crypto.timingSafeEqual`. When no secret
is configured the check is skipped (local dev), so the feature is safe *and*
convenient.

---

## 7. Reliability

- **Retries:** BullMQ `attempts: 3` with exponential backoff.
- **Timeouts:** every external command (clone, checkout, install, test, build,
  docker build/run, health check) has its own timeout — nothing hangs forever.
- **Cleanup:** `try/catch/finally` — the temp dir is always removed; on failure
  the deployment's own container/image are removed too.
- **Isolation:** unique temp dir + uniquely named container + ephemeral port per
  deployment; `--memory`/`--cpus` caps stop a noisy app starving the host.
- **Garbage collection:** on each success, a project's superseded containers and
  images are reaped (matched by a `minicloud.project=<id>` label), so successful
  deployments don't pile up and leak resources.

---

## 8. Security summary

| Threat | Mitigation |
|--------|-----------|
| Command / argument injection | `execFile` + argument arrays + `--`, no shell |
| SSRF / dangerous git transports | HTTPS-GitHub-only allowlist + `GIT_ALLOW_PROTOCOL=https` |
| Unauthorized project/deployment access | JWT + ownership check on every route |
| Forged webhooks | HMAC-SHA256 `X-Hub-Signature-256`, constant-time compare |
| Secret leakage | Secrets only in env; never logged; `.env` git-ignored |
| Resource exhaustion | Per-container memory/CPU limits + container GC + timeouts |
| Container collisions | Deterministic unique names + ephemeral ports |

---

## 9. Observability

- **Structured logs:** every pipeline stage → a `DeploymentLog` row (surfaced in
  the dashboard's terminal-style viewer).
- **Prometheus metrics** at `/metrics`: `deployment_total`,
  `deployment_success_total`, `deployment_failure_total`, `deployment_active`
  (gauge), `deployment_duration_seconds` (histogram).
- **Process logs** via `journalctl -u minicloud` (systemd) in production.

---

## 10. Deployment topology

Because the worker drives the host Docker daemon, MiniCloud runs on a plain VM
(EC2), not a managed PaaS. One Ubuntu box runs: the Node process (API + worker)
as a systemd service, PostgreSQL + Redis as Docker containers, and Caddy as an
auto-HTTPS reverse proxy (Let's Encrypt via `sslip.io`, no domain required).
See [`DEPLOY.md`](./DEPLOY.md).

---

## 11. Known bottlenecks & production hardening

Deliberately single-node for a demo. To scale:

| Area | Today | Production path |
|------|-------|-----------------|
| Throughput | worker concurrency (default 3) in one process | separate the worker into its own service; scale worker replicas horizontally |
| Fault isolation | API + worker share a process | split them so a worker crash can't take down the API |
| State | Dockerised Postgres/Redis on the box | managed **RDS** + **ElastiCache** (backups, HA, failover) |
| Images | local docker images | push to **ECR**; pull on run nodes |
| Ingress / TLS | single Caddy instance | **ALB** + **ACM**, multiple app instances, **Route 53** domain |
| Build caching | fresh `npm ci` each time | shared dependency / Docker layer cache |
| Logs | rows in Postgres | ship to **CloudWatch** / object storage with retention |
| Secrets | `.env` file | Secrets Manager / SSM Parameter Store |

The architecture already isolates the slow, risky work behind a durable queue,
so most of this is swapping single-node components for managed/replicated ones —
not a redesign.
