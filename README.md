# MiniCloud

A mini Heroku/Railway-style deployment platform. Connect a GitHub repository to
a project; a `git push` (via a GitHub webhook) triggers an asynchronous pipeline
that clones the exact commit, installs dependencies, runs tests, builds the app,
builds a Docker image, starts an isolated container, health-checks it, and marks
the deployment **SUCCESS** or **ERROR** — with full per-stage logs, retries,
timeouts, cleanup, rollback, and Prometheus metrics.

This repo (`minicloud-backend`) is the API + worker. The dashboard lives in
[`minicloud-frontend`](../minicloud-frontend).

---

## Architecture

```
GitHub
   |  push
   v
Webhook API  (POST /webhooks/github)  -- verifies X-Hub-Signature-256
   |
   v
PostgreSQL  ----> Deployment row (status = DEPLOYING)
   |
   v
Redis / BullMQ  (deployment queue: attempts=3, exponential backoff)
   |
   v
Deployment Worker  (async, isolated per deployment)
   |
   +--> Git         (clone --branch, checkout --detach <exact commit>)
   +--> npm/yarn/pnpm (lockfile detection -> deterministic install, test, build)
   +--> Docker      (build unique image, run unique container, ephemeral port)
   |
   v
Container  (127.0.0.1:<random>-> app :3000)
   |
   v
Health Check  (GET /health, retry + timeout)
   |
   v
Deployment Status  (SUCCESS | ERROR)  + finishedAt + logs + metrics
```

Two-repository layout, no microservices:

- **minicloud-backend** — Express + TypeScript + PostgreSQL + Prisma + Redis +
  BullMQ. The API and the BullMQ worker run in the same Node process (the worker
  is imported by `src/server.ts`). The worker shells out to the host's `git` and
  `docker` binaries.
- **minicloud-frontend** — Vite + React + TypeScript dashboard.

---

## Tech stack

| Concern            | Choice                                   |
|--------------------|------------------------------------------|
| API                | Express 5, TypeScript (ESM, NodeNext)    |
| DB / ORM           | PostgreSQL 16, Prisma 7 (pg adapter)     |
| Queue              | BullMQ 6 on Redis 7                       |
| Auth               | JWT (jsonwebtoken) + bcrypt              |
| Validation         | Zod                                       |
| Build & test       | tsc, Vitest, Supertest                    |
| Observability      | prom-client (`/metrics`)                  |
| Runtime deps       | host `git` + `docker` CLIs                |

---

## Repository structure

```
minicloud-backend/
├─ prisma/
│  ├─ schema.prisma            # User, Project, Deployment, DeploymentLog (+ indexes)
│  └─ migrations/
├─ examples/sample-app/        # tiny deployable app (health endpoint) for E2E
├─ src/
│  ├─ app.ts                   # Express app (no listener) — importable in tests
│  ├─ server.ts                # boots app + worker + listener + graceful shutdown
│  ├─ config/                  # env, redis
│  ├─ lib/                     # prisma client, safe execFile wrapper
│  ├─ middleware/              # JWT auth
│  ├─ observability/metrics.ts # Prometheus counters/gauges/histogram
│  ├─ modules/
│  │  ├─ auth/                 # register / login / me
│  │  ├─ project/              # project CRUD (ownership-enforced)
│  │  ├─ deployment/           # deployments, logs, retry, rollback
│  │  └─ webhook/              # GitHub push webhook + signature verify
│  ├─ queue/deployment.queue.ts
│  └─ worker/
│     ├─ deployment.worker.ts   # BullMQ consumer: status, cleanup, metrics
│     └─ deployment.pipeline.ts # clone→checkout→install→test→build→docker→health
└─ docker-compose.yml          # PostgreSQL + Redis for local dev
```

---

## API

Auth (`Authorization: Bearer <token>` unless noted):

| Method | Path                | Auth | Description                     |
|--------|---------------------|------|---------------------------------|
| POST   | `/auth/register`    | no   | Create user                     |
| POST   | `/auth/login`       | no   | Returns `{ ...user, token }`    |
| GET    | `/auth/me`          | yes  | Current user                    |

Projects (all ownership-enforced):

| Method | Path             | Description        |
|--------|------------------|--------------------|
| POST   | `/projects`      | Create project     |
| GET    | `/projects`      | List own projects  |
| GET    | `/projects/:id`  | Get one            |
| PATCH  | `/projects/:id`  | Update             |
| DELETE | `/projects/:id`  | Delete (cascade)   |

Deployments (nested under a project, ownership-enforced):

| Method | Path                                                       | Description                    |
|--------|------------------------------------------------------------|--------------------------------|
| POST   | `/projects/:projectId/deployments`                         | Create + enqueue deployment    |
| GET    | `/projects/:projectId/deployments`                         | List (newest first)            |
| GET    | `/projects/:projectId/deployments/:deploymentId`           | Get one                        |
| GET    | `/projects/:projectId/deployments/:deploymentId/logs`      | Stage logs                     |
| POST   | `/projects/:projectId/deployments/:deploymentId/retry`     | Re-run same deployment         |
| POST   | `/projects/:projectId/deployments/:deploymentId/rollback`  | New deployment at that commit  |

Other:

| Method | Path                | Description                              |
|--------|---------------------|------------------------------------------|
| POST   | `/webhooks/github`  | GitHub push webhook (async)              |
| GET    | `/health`           | Liveness + DB connectivity               |
| GET    | `/metrics`          | Prometheus metrics                       |

---

## Local setup (fresh machine)

Prerequisites: **Node 20+**, **Docker** (running), **git**.

```bash
# 1. Infrastructure (PostgreSQL + Redis)
cd minicloud-backend
docker compose up -d            # postgres on :5433, redis on :6379

# 2. Environment
cp .env.example .env            # defaults already match docker-compose.yml
#   edit JWT_SECRET_KEY (openssl rand -hex 32) and, for real webhooks,
#   GITHUB_WEBHOOK_SECRET

# 3. Dependencies + database schema
npm install
npx prisma migrate deploy       # apply migrations
npx prisma generate

# 4. Run the API + worker (same process)
npm run dev                     # http://localhost:4000

# 5. Frontend (separate terminal)
cd ../minicloud-frontend
cp .env.example .env            # VITE_API_URL=http://localhost:4000
npm install
npm run dev                     # http://localhost:5173
```

### Environment variables

See `.env.example`. Key ones: `DATABASE_URL`, `JWT_SECRET_KEY`, `REDIS_HOST/PORT/PASSWORD`,
`GITHUB_WEBHOOK_SECRET` (optional — when set, webhook signatures are enforced),
`DEPLOY_APP_PORT` (port the deployed app listens on inside its container; default 3000),
`DEPLOY_HEALTH_PATH` (default `/health`), `CORS_ORIGIN`.

Secrets (`JWT_SECRET_KEY`, `DATABASE_URL`, `REDIS_PASSWORD`, `GITHUB_WEBHOOK_SECRET`)
are never logged.

---

## Docker requirements

The **worker builds and runs Docker containers on the host**, so it needs access
to the host `docker` and `git` CLIs. For that reason the API/worker process runs
directly on the host (`npm run dev` / `npm run build && npm start`); only the
stateful infrastructure (PostgreSQL, Redis) is containerized via
`docker-compose.yml`. This avoids docker-in-docker complexity.

Deployed apps must ship a root `Dockerfile` and listen on `DEPLOY_APP_PORT`
(default 3000) with a `DEPLOY_HEALTH_PATH` (default `/health`) returning HTTP 200.

> In networks where Docker Hub is blocked, base images can be pulled from the
> AWS ECR public mirror, e.g. `public.ecr.aws/docker/library/node:20-alpine`
> (the `examples/sample-app` Dockerfile uses this).

---

## GitHub webhook setup

1. Create a project with `repositoryUrl = https://github.com/<owner>/<repo>`.
2. Expose the API publicly (e.g. `ngrok http 4000`).
3. In the GitHub repo: **Settings → Webhooks → Add webhook**
   - Payload URL: `https://<public-host>/webhooks/github`
   - Content type: `application/json`
   - Secret: the value of `GITHUB_WEBHOOK_SECRET`
   - Events: **Just the push event**
4. `git push` → the webhook creates a deployment for the pushed commit and
   enqueues it. The worker runs the pipeline asynchronously.

Only `https://github.com/<owner>/<repo>` URLs are accepted (SSRF / dangerous
transport protection).

---

## Deployment flow

1. Webhook (or `POST .../deployments`) creates a `Deployment` (status `DEPLOYING`)
   and enqueues `{ deploymentId }` on BullMQ.
2. Worker loads the authoritative record from the DB (never trusts job payload).
3. Isolated temp dir `/tmp/minicloud/deployment-<id>-XXXXXX`.
4. `git clone --branch <branch> -- <url> <dir>` (execFile, no shell).
5. `git checkout --detach <exact commit>`.
6. Detect package manager by lockfile → `npm ci` / `yarn install --frozen-lockfile`
   / `pnpm install --frozen-lockfile`.
7. Run `test` script if present (skip gracefully if absent).
8. Run `build` script if present (skip gracefully if absent).
9. `docker build -t minicloud-project-<pid>-deployment-<did>`.
10. `docker run` with a unique container name on an ephemeral `127.0.0.1` port.
11. Health check `GET /health` with retries + timeout.
12. SUCCESS (or ERROR at any failed stage) → status, `finishedAt`, logs, metrics.
13. `finally`: remove temp dir. On failure: remove this deployment's container/image.

Retries: BullMQ `attempts: 3`, exponential backoff. Deterministic image/container
names + `docker rm -f` before run make retries idempotent (no duplicate containers).

---

## Testing

```bash
npm test          # Vitest: unit (pipeline security, PM detection, webhook)
                  #         + integration (auth, ownership, deployments, webhook)
```

Integration tests run against the running PostgreSQL and mock the BullMQ queue
(no Redis needed); they create and clean up their own rows.

### End-to-end deployment proof

`examples/sample-app` is a tiny app (`GET /health -> {"status":"ok"}`, port 3000,
with a `Dockerfile`). Push it to a public GitHub repo, register it as a project,
then trigger a deployment (webhook or API) and watch it reach **SUCCESS** with a
live container passing the health check.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Database connection failed` | `docker compose up -d`; check `DATABASE_URL` host/port (5433). |
| `Redis error` | Ensure redis container is up and `REDIS_PASSWORD` matches compose. |
| Deployment ERROR: `Unsupported repository URL` | Only `https://github.com/<owner>/<repo>` is allowed. |
| Deployment ERROR: `No Dockerfile found` | The deployed repo needs a root `Dockerfile`. |
| Health check fails | App must listen on `DEPLOY_APP_PORT` and serve `DEPLOY_HEALTH_PATH` (HTTP 200). |
| `docker build` TLS timeout | Docker Hub blocked — use `public.ecr.aws/docker/library/...` base images. |
| Webhook 401 | `GITHUB_WEBHOOK_SECRET` set but signature mismatch; check the secret. |
```
