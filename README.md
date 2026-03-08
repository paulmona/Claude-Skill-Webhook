# Claude CLI Home Assistant Bridge

A lightweight Dockerized Express API that wraps the Claude CLI (`claude -p`) for Home Assistant integration. Runs on Unraid (or any Docker host), accepts prompts via HTTP POST, and returns Claude's response as JSON.

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
docker exec -it claude-ha-bridge claude auth login
```

Follow the interactive OAuth flow. Auth persists in the Docker volume across restarts.

### 4. Verify

```bash
# Health check (should return {"status":"ok"})
curl -s -H "Authorization: Bearer your-secret-bearer-token" http://localhost:3131/health

# Test prompt
curl -s -X POST \
  -H "Authorization: Bearer your-secret-bearer-token" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Say hello in one word"}' \
  http://localhost:3131/run
```

## API

### `GET /health`

Returns Claude CLI auth status.

| Status | Code | Body |
|--------|------|------|
| Authenticated | 200 | `{"status": "ok"}` |
| Not authenticated | 401 | `{"status": "unauthenticated"}` |
| Bad/missing token | 403 | `{"error": "Forbidden"}` |

### `POST /run`

Execute a Claude prompt.

**Request body:**
```json
{
  "prompt": "Your prompt here",
  "system": "Optional system prompt"
}
```

**Responses:**

| Status | Code | Body |
|--------|------|------|
| Success | 200 | Claude CLI JSON output |
| Missing prompt | 400 | `{"error": "prompt is required"}` |
| Auth lapsed | 401 | `{"status": "unauthenticated"}` |
| Bad bearer token | 403 | `{"error": "Forbidden"}` |
| CLI error | 500 | `{"error": "...", "stderr": "..."}` |
| Timeout | 504 | `{"error": "Claude CLI timed out"}` |

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
  - /mnt/user/appdata/claude-ha-bridge:/root/.claude
```

## Troubleshooting

**Auth expired:** Run `docker exec -it claude-ha-bridge claude auth login` again.

**Container logs:** `docker compose logs -f claude-api`

**Timeout issues:** Increase `CLAUDE_TIMEOUT_MS` in your environment.
