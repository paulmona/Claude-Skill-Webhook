# Claude Skills Runner

A lightweight Dockerized Express API that triggers Claude CLI skills via webhooks. Designed for Home Assistant integration — receive a webhook, execute a Claude CLI slash command, return the result as JSON.

## Prerequisites

- Docker & Docker Compose
- A Claude CLI subscription (the CLI authenticates via OAuth)

## Quick Start

### 1. Configure

Create a `.env` file (or set environment variables):

```env
API_TOKEN=your-secret-bearer-token
PORT=3131
CLAUDE_TIMEOUT_MS=120000
```

### 2. Build & Start

```bash
docker compose up -d --build
```

### 3. Authenticate Claude CLI (first run only)

```bash
docker exec -it claude-skills-endpoint claude auth login
```

Follow the interactive OAuth flow. Auth persists in the Docker volume across restarts.

### 4. Verify

```bash
# Health check (should return {"status":"ok"})
curl -s -H "Authorization: Bearer your-secret-bearer-token" http://localhost:3131/health

# Trigger a skill
curl -s -X POST \
  -H "Authorization: Bearer your-secret-bearer-token" \
  -H "Content-Type: application/json" \
  -d '{"skill": "get-garmin-data"}' \
  http://localhost:3131/skill
```

## API

### `GET /health`

Returns Claude CLI auth status.

| Status | Code | Body |
|--------|------|------|
| Authenticated | 200 | `{"status": "ok"}` |
| Not authenticated | 401 | `{"status": "unauthenticated"}` |
| Bad/missing token | 403 | `{"error": "Forbidden"}` |

### `POST /skill`

Execute a Claude CLI skill (slash command).

**Request body:**
```json
{
  "skill": "get-garmin-data"
}
```

Skill names must be alphanumeric, hyphens, or underscores. The server runs `claude -p /<skill-name>` and returns the result.

**Responses:**

| Status | Code | Body |
|--------|------|------|
| Success | 200 | Claude CLI JSON output |
| Missing/invalid skill | 400 | `{"error": "..."}` |
| Auth lapsed | 401 | `{"status": "unauthenticated"}` |
| Bad bearer token | 403 | `{"error": "Forbidden"}` |
| CLI error | 500 | `{"error": "...", "stderr": "..."}` |
| Timeout | 504 | `{"error": "Claude CLI timed out"}` |

### `POST /run`

Execute a raw Claude prompt.

**Request body:**
```json
{
  "prompt": "Your prompt here",
  "system": "Optional system prompt"
}
```

Same response codes as `/skill`.

## Skills

Skills are Claude CLI slash commands defined in `.claude/commands/`:

- **`get-garmin-data`** — Fetches latest workout from Garmin Connect and logs it to a Notion Training Log. Updates existing "Planned" entries or creates new ones. Includes running-specific metrics when applicable.

## Home Assistant Integration

Copy the example YAML files from `homeassistant/` into your HA config:

- **`rest_commands.yaml`** — `rest_command.claude_ask` service
- **`binary_sensors.yaml`** — binary sensor that monitors Claude CLI auth status
- **`secrets_example.yaml`** — add the bearer token to your `secrets.yaml`

Replace `<docker-host>` with your server's IP/hostname.

## Unraid Notes

For Unraid, you may want to use a bind mount instead of a named volume:

```yaml
volumes:
  - /mnt/user/appdata/claude-skills-endpoint:/root/.claude
```

## Troubleshooting

**Auth expired:** Run `docker exec -it claude-skills-endpoint claude auth login` again.

**Container logs:** `docker compose logs -f claude-api`

**Timeout issues:** Increase `CLAUDE_TIMEOUT_MS` in your environment.
