# CLAUDE.md — WorkshopHub

## Project Context

WorkshopHub is an internal training registration system. Employees browse and register for internal training sessions.

- Monorepo managed with pnpm workspaces (`pnpm-workspace.yaml`): `api/`, `app/`
- `api/`: Express + TypeScript backend, Prisma ORM with SQLite (`DATABASE_URL=file:../database/workshophub.sqlite` in dev). Schema and seed script live in `api/prisma/`. Endpoints: `GET /health`, `GET /api/training-sessions`, `GET /api/training-sessions/:id`
- `app/`: React 18 + TypeScript + Vite 5 frontend
- Ports: frontend 5173 and API 3001 in dev; 8080 for prod (frontend + API in one container)
- Testing: Jest + Supertest (`api/`). Linting: ESLint + Prettier. Git hooks: Husky (pre-push: test + lint). CI: GitHub Actions (`pr-check`, `security`, `build-and-prod`)
- The `Makefile` is the stable command interface: `make setup`, `make dev`, `make test`, `make lint`, `make format-check`, `make typecheck`, `make build`, `make seed`, `make reset-db`, `make smoke-test`

## Team Norms

1. No `any`: never use TypeScript `any` (including `as any`). Use explicit types, `unknown` with narrowing, or generics.
2. No direct Prisma in routes: Express route handlers must not import or call Prisma directly. Put all DB access in a service/repository layer and keep routes thin (validation, auth, HTTP mapping only).
3. All code must pass `make test` and `make lint`: run both before opening a PR or pushing. Fix failures; do not disable rules or skip tests to get green.

## MCP Permissions

<!-- PLACEHOLDER: define allowed MCP servers/tools and scopes here. -->

- TODO: list permitted MCP servers and tools.
- TODO: list denied scopes (e.g. prod writes, secret access).

## AGENT_BOUNDARY

<!-- PLACEHOLDER: define what the agent may/may not change autonomously. -->

- TODO: allowed paths/actions.
- TODO: actions requiring human approval (e.g. schema resets, prod deploys, secret handling).
