# `agents/` — reference material, not the rulebook

This folder holds **reusable AI-agent role definitions** (personas like `architect`, `code-reviewer`, `security-auditor`) and a few generic command playbooks under `commands/`. They were used as **source material** when establishing Aladdin's repository architecture.

## What this folder is

- A library of agent personas an operator may attach to a task.
- Historical/source input that seeded the project's conventions.

## What this folder is **not**

- It is **not** the source of truth for current coding, security, data, or architecture rules.
- **Active instructions now live in the `AGENTS.md` hierarchy and in `docs/decisions/` (ADRs).** See the reading order in the root `AGENTS.md`.
- Agents must **not** depend on `agents/` as the only or authoritative source of current rules. Where a file here conflicts with the root/scoped `AGENTS.md` or an ADR, the `AGENTS.md`/ADR wins.

The mapping from these files to their authoritative destinations is recorded in [`docs/decisions/agent-instruction-migration.md`](../docs/decisions/agent-instruction-migration.md).

## Hygiene rules

This folder must **not** contain:

- Logs, chat transcripts, or conversation dumps
- Private prompts or scratchpads
- Secrets, credentials, or environment values
- Customer data or generated artifacts

Keep it to durable, shareable agent-persona definitions and playbooks only.
