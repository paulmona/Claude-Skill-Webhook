# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Skills Runner — a Dockerized Express API that triggers Claude CLI skills via webhooks from Home Assistant. The primary use case: Strava finishes a workout → HA receives webhook → HA fires webhook to this container with a skill name → Claude CLI executes the skill (e.g., fetch Garmin data and log to Notion).

Note: `ARCHITECTURE.md` describes an earlier planned architecture that was abandoned. Only the HA bridge is active.

## Codebase

Single-file Express server (`server.js`) with:
- `POST /skill` — accepts `{skill}`, executes `claude -p /<skill-name>`, returns JSON. Skill names are validated (alphanumeric, hyphens, underscores only). Runs with `--permission-mode bypassPermissions` for headless MCP tool use.
- `POST /run` — accepts `{prompt, system?}`, executes a raw prompt via `claude -p`, returns JSON
- `GET /health` — checks Claude CLI auth status
- Bearer token auth via `API_TOKEN` env var (optional — skipped when unset)
- Closes child process stdin to prevent CLI hanging in non-TTY contexts

### Skills

Skills are Claude CLI slash commands defined as markdown files. Two sources:

1. **Built-in** — `.claude/commands/` in this repo (baked into Docker image)
2. **Remote** — pulled from a public GitHub repo on container startup via `SKILLS_REPO` env var. Remote skills are `.md` files in the repo root.

Built-in skills:
- **`get-garmin-data`** — Fetches latest Garmin workout via Garmin MCP, logs it to the Notion Training Log database. Handles upsert: updates existing "Planned" entries or creates new ones. Skips true duplicates. Populates running-specific metrics when applicable.
- **`test-notion`** — Creates a test entry in Notion Training Log to verify integration. Requires manual cleanup.

### Home Assistant Config

`homeassistant/` contains HA YAML snippets (`rest_commands.yaml`, `binary_sensors.yaml`, `secrets_example.yaml`) for integrating with the bridge.

## Commands

```bash
# Run locally
npm start                        # starts server.js on PORT (default 3131)

# Docker
docker compose up -d --build     # build and start container
docker exec -it claude-skills-runner claude setup-token  # auth
docker compose logs -f claude-api                        # view logs

# Trigger a skill
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"skill": "get-garmin-data"}' http://localhost:3131/skill
```

No tests, linter, or build step exist.

## Environment Variables

- `API_TOKEN` — bearer token for auth (optional, auth skipped when unset)
- `PORT` — server port (default 3131)
- `CLAUDE_TIMEOUT_MS` — CLI execution timeout in ms (default 120000)
- `SKILLS_REPO` — public GitHub repo to pull skills from on startup (e.g. `paulmona/claude-skills`). Skills are `.md` files in the repo root.
- `SKILLS_BRANCH` — branch to pull from (default: `main`)
