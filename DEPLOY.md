# Deploying MiniCloud to an AWS EC2 instance (Ubuntu)

MiniCloud's worker builds and runs Docker containers on the host, so it needs a
machine where **you own the Docker daemon** — a plain VM like EC2, not a
managed PaaS (Vercel/Render/Railway can't give the worker a Docker socket).

This guide gets the full stack live on one Ubuntu EC2 box with **free HTTPS and
no domain**, using [`sslip.io`](https://sslip.io) (turns your IP into a real
hostname) + [Caddy](https://caddyserver.com) (automatic Let's Encrypt certs).

End result:

- Dashboard: `https://app.<IP>.sslip.io`
- API:       `https://api.<IP>.sslip.io`
- Real GitHub webhooks work (HTTPS endpoint).

> Replace `<IP>` everywhere with your EC2 **public IP**, dots intact
> (e.g. `13.233.1.50` → `api.13.233.1.50.sslip.io`).

---

## 0. EC2 security group

Open these inbound ports:

| Port | Why |
|------|-----|
| 22   | SSH (restrict to your IP) |
| 80   | HTTP — Caddy uses it to get/renew TLS certs |
| 443  | HTTPS — the actual traffic |

You do **not** need to expose 4000/5173/5433/6379 publicly — Caddy fronts
everything, and Postgres/Redis stay on localhost.

Recommended instance: **t3.small or larger** (2 GB+ RAM — Docker builds are
memory-hungry). t2.micro (1 GB) works for a light demo but can OOM on builds.

---

## 1. Install prerequisites (one time)

SSH in (`ssh ubuntu@<IP>`), then:

```bash
# System
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y git curl openssl

# Docker + compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu            # run docker without sudo
newgrp docker                             # apply group now (or re-login)

# Node 20 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Caddy (official apt repo)
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy

# Verify
docker --version && node --version && caddy version
```

> **Docker Hub blocked?** If `docker build` later fails with a TLS timeout,
> pull base images from the AWS ECR public mirror
> (`public.ecr.aws/docker/library/...`) — the sample app already does this.

---

## 2. Clone the two repos

```bash
mkdir -p ~/minicloud && cd ~/minicloud
git clone <your-backend-repo-url>  minicloud-backend
git clone <your-frontend-repo-url> minicloud-frontend
```

---

## 3. Run the bootstrap script

It writes `.env` (with freshly generated secrets), starts Postgres+Redis,
runs migrations, builds backend & frontend, and installs the Caddy + systemd
services:

```bash
cd ~/minicloud/minicloud-backend
chmod +x deploy/bootstrap.sh
./deploy/bootstrap.sh <IP>
```

When it finishes it prints your URLs **and** the generated
`GITHUB_WEBHOOK_SECRET` — copy that, you'll need it in step 5.

Verify:

```bash
curl https://api.<IP>.sslip.io/health      # {"status":"OK","database":"connected"}
```

Open `https://app.<IP>.sslip.io` in a browser — the dashboard loads over HTTPS.

> First HTTPS hit may take ~10 s while Caddy provisions the certificate.
> Watch it with `journalctl -u caddy -f`.

---

## 4. Create your account + project

Register from the dashboard, create a project with
`repositoryUrl = https://github.com/<owner>/<repo>` (must be a public GitHub repo
with a root `Dockerfile` that listens on port 3000 and serves `/health`).

---

## 5. Connect the real GitHub webhook

In the GitHub repo → **Settings → Webhooks → Add webhook**:

| Field | Value |
|-------|-------|
| Payload URL | `https://api.<IP>.sslip.io/webhooks/github` |
| Content type | `application/json` |
| Secret | the `GITHUB_WEBHOOK_SECRET` printed in step 3 |
| Events | **Just the push event** |

Now `git push` to that repo → GitHub calls the webhook → MiniCloud builds and
deploys the exact pushed commit, live. 🎉

---

## Operating it

```bash
# Backend logs (API + worker)
journalctl -u minicloud -f

# Restart after pulling new code
cd ~/minicloud/minicloud-backend && git pull && npm install && npm run build
sudo systemctl restart minicloud

# Rebuild + redeploy the frontend after changes
cd ~/minicloud/minicloud-frontend && git pull && npm install && npm run build
sudo cp -r dist/* /var/www/minicloud/

# Infra status
docker compose ps
```

---

## How people will see your project (for a resume)

1. **GitHub repos** — clean READMEs + the architecture diagram (highest signal).
2. **Live demo link** — `https://app.<IP>.sslip.io` with a seeded demo account.
3. **A 60-second screen recording** embedded in the README: login → push/retry →
   `DEPLOYING` → green `SUCCESS` → logs → live container. Most recruiters watch
   this before anything else — do it even if the live box is sometimes off.

> Keeping a public demo online costs money and can break. A polished README +
> demo video never goes down and is what most reviewers actually look at.
