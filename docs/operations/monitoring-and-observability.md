# Monitoring & Observability

**Status:** Living document · 2026-07-29

## Purpose

Define how we see what the system is doing in each environment.

## Current decision

- **Error monitoring:** Sentry across web, FastAPI, and workers (server DSN kept server-side).
- **Structured logging:** JSON logs with consistent fields (timestamp, level, service, request/trace id, message). Backend uses `structlog`. **No PII or secrets in logs**; no verbose stack traces to clients.
- **Health checks:** every service exposes a health endpoint (`/health` in FastAPI; a Route Handler in Next.js) covering liveness and, where relevant, readiness (dependency reachability).
- **Correlation:** propagate a request/trace id from the web app into FastAPI calls and worker jobs.
- **Job visibility:** workers log start/finish/failure with the triggering id; failures are retryable and surfaced.

## Rationale

A small team needs failures to be loud and traceable across the web→AI→worker hops without standing up heavy infrastructure.

## Scope

Logging, error tracking, health, and tracing conventions.

## What is deferred

Metrics/dashboards (Prometheus-style), SLOs and alerting thresholds, and distributed tracing backends — added when traffic justifies them (`../architecture/scaling-strategy.md`).

## Consequences

A new service ships with structured logging + a health endpoint + Sentry wired before it is considered production-ready.

## Related files

`deployment-overview.md` · `../architecture/realtime-and-background-jobs.md` · `backend/AGENTS.md`
