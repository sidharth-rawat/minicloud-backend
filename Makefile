# MiniCloud backend — common tasks. Run `make` or `make help` to list them.

.DEFAULT_GOAL := help
.PHONY: help install dev build start test typecheck \
        infra-up infra-down db-migrate db-generate db-studio deploy clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

dev: ## Run API + worker with hot reload (http://localhost:4000)
	npm run dev

build: ## Prisma generate + compile TypeScript
	npm run build

start: ## Run the compiled server (dist/)
	npm start

test: ## Run the Vitest suite
	npm test

typecheck: ## Type-check without emitting
	npm run typecheck

infra-up: ## Start PostgreSQL + Redis (docker compose)
	docker compose up -d

infra-down: ## Stop PostgreSQL + Redis
	docker compose down

db-migrate: ## Apply database migrations
	npx prisma migrate deploy

db-generate: ## Regenerate the Prisma client
	npx prisma generate

db-studio: ## Open Prisma Studio
	npx prisma studio

deploy: ## Deploy to an Ubuntu server (pass IP=<public-ip>) — see DEPLOY.md
	@test -n "$(IP)" || (echo "Usage: make deploy IP=<public-ip>"; exit 1)
	./deploy/bootstrap.sh $(IP)

clean: ## Remove build output
	rm -rf dist
