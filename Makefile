SHELL := /bin/bash
ROOT_DIR := $(shell pwd)
API_DIR := $(ROOT_DIR)/api

.PHONY: setup dev test test-unit lint format-check typecheck build seed reset-db smoke-test security reasons-lint prod-up prod-down prod-logs

## setup: Install dependencies, generate Prisma client, push schema, seed database
setup:
	pnpm install
	@if [ ! -f .env ]; then cp .env.example .env; echo "Created .env from .env.example"; fi
	@cp .env $(API_DIR)/.env
	cd $(API_DIR) && pnpm exec prisma generate
	cd $(API_DIR) && pnpm exec prisma db push
	$(MAKE) seed
	@echo "Setup complete. Run 'make dev' to start."

## dev: Start frontend and backend in development mode
dev:
	pnpm run dev

## test: Run all tests (unit + integration)
test:
	pnpm run test

## test-unit: Run unit tests only (no database required)
test-unit:
	cd $(API_DIR) && pnpm run test:unit

## lint: Run ESLint on all packages
lint:
	pnpm run lint

## format-check: Check Prettier formatting on all packages
format-check:
	pnpm run format-check

## typecheck: Type-check all packages without emitting (used by /sensor-and-fix)
typecheck:
	pnpm run typecheck

## build: Build frontend and backend
build:
	pnpm run build

## seed: Seed the SQLite database with sample data
seed:
	cd $(API_DIR) && pnpm exec prisma db seed

## reset-db: Reset and re-seed the SQLite database
reset-db:
	cd $(API_DIR) && pnpm exec prisma db push --force-reset
	$(MAKE) seed

## smoke-test: Run smoke tests against a running application
smoke-test:
	@bash scripts/smoke-test.sh

## security: Run local security checks (Gitleaks + Trivy)
security:
	@bash scripts/security.sh

## reasons-lint: Validate REASONS structure in spdd/prompt/ files
reasons-lint:
	@bash scripts/reasons-lint.sh

## prod-up: Start production-like environment with Docker Compose
prod-up:
	docker compose -f docker-compose.prod.yml up -d --build
	@echo "Production environment started. Run 'make smoke-test' to verify."

## prod-down: Stop production-like environment
prod-down:
	docker compose -f docker-compose.prod.yml down

## prod-logs: Show production environment logs
prod-logs:
	docker compose -f docker-compose.prod.yml logs

help:
	@grep -E '^## ' Makefile | sed 's/^## /  /'
