# Workout Autopilot — Architecture (v2)

> Replaces the N8N-based design from PRD-006. TypeScript core service + standalone Python Garmin sidecar.

## Why Not N8N

N8N adds operational complexity (its own DB, worker processes, credential store, UI) for a workflow that is **linear and deterministic**. The entire pipeline is: trigger → fetch → transform → store → enrich → append. There are no conditional fan-outs, human-in-the-loop steps, or visual editing requirements that justify a workflow engine.

---

## Design Principles

1. **TypeScript-first** — the core service, all business logic, LLM routing, Notion integration, scheduling, and API are TypeScript.
2. **Python only where forced** — Garmin Connect has no official API; the best community library (`python-garminconnect`) is Python-only. This runs as an isolated sidecar that exposes a simple REST API to the core service.
3. **Two containers, one concern each** — the core service never imports Python; the Garmin sidecar never touches Notion or LLMs.

---

## High-Level Flow

```
Home Assistant              Core Service (TypeScript)          External APIs
─────────────              ─────────────────────────          ─────────────

                            ┌──────────────┐
  geofence exit ──webhook─▶ │   Hono app   │
                            │  POST /hook   │
                            └──────┬───────┘
                                   │
                            ┌──────▼───────┐    HTTP     ┌─────────────────┐
                            │ garminClient  │───────────▶ │  Garmin Sidecar  │
                            │ fetch recent  │◀───────────│  (Python/Flask)  │
                            └──────┬───────┘             └────────┬────────┘
                                   │                              │
                                   │                     Garmin Connect API
                            ┌──────▼───────┐
                            │   mapper      │
                            │   transform   │
                            └──────┬───────┘
                                   │
                            ┌──────▼───────┐
                            │ notionClient  │──── Notion API
                            │ upsert entry  │
                            └──────┬───────┘
                                   │
                            ┌──────▼───────┐
                            │  llmRouter    │──── Anthropic / OpenAI / Google AI
                            │  coaching     │
                            └──────┬───────┘
                                   │
                            ┌──────▼───────┐
                            │ notionClient  │──── Notion API
                            │ append coach  │
                            └──────────────┘

  Daily 00:00 UTC ──cron──▶  Same pipeline (fallback)
```

---

## Components

### Core Service (TypeScript)

#### 1. `app.ts` — Hono Entrypoint

- **`POST /hook`** — receives the Home Assistant geofence webhook. Validates a shared secret (`WEBHOOK_SECRET`), then kicks off the pipeline.
- **`GET /health`** — liveness probe.
- Lightweight framework ([Hono](https://hono.dev/)) — runs on Node or Bun, minimal dependencies.

#### 2. `pipeline.ts` — Orchestrator

Coordinates the sequential steps:

```typescript
async function runPipeline(): Promise<void> {
  const activity = await garminClient.fetchLatest();
  if (!activity || !recencyCheck(activity)) return;

  const mapped = mapper.toNotionSchema(activity);
  const entryId = await notionClient.upsert(mapped);

  // AI coaching — failures don't block the sync
  try {
    const summary = await llmRouter.postWorkoutSummary(mapped);
    const recovery = await llmRouter.recoveryRecommendation(
      mapped,
      await notionClient.getTrainingBlock()
    );
    await notionClient.appendCoaching(entryId, summary, recovery);
  } catch (err) {
    await alerter.send(`LLM coaching failed: ${err}`);
  }
}
```

#### 3. `garminClient.ts` — Garmin Sidecar Client

A thin HTTP client that calls the Python Garmin sidecar. No Garmin logic lives here — just `fetch()` calls:

```typescript
async function fetchLatest(): Promise<GarminActivity | null> {
  const res = await fetch(`${GARMIN_SIDECAR_URL}/activities/latest`);
  if (!res.ok) return null;
  return res.json();
}
```

#### 4. `notionClient.ts` — Notion Integration

- Uses the official [`@notionhq/client`](https://github.com/makenotion/notion-sdk-js) SDK.
- **Upsert logic**: queries by `(date, workout_type)` — updates if exists, creates if not.
- **Training block query**: walks entries backward to last rest day (capped at 14 days).
- **Append coaching**: adds summary + recovery text to rich-text properties.

#### 5. `llmRouter.ts` — LLM Provider Router

Config-driven routing — each coaching task maps to a provider/model pair:

```typescript
const llmConfig = {
  postWorkoutSummary:    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  recoveryRecommendation:{ provider: "anthropic", model: "claude-sonnet-4-20250514" },
  weeklyTrendAnalysis:   { provider: "google",    model: "gemini-2.0-flash" },
  nutritionalGuidance:   { provider: "openai",    model: "gpt-4o" },
} as const;
```

Each provider adapter:

```typescript
async function callAnthropic(model: string, system: string, user: string): Promise<string> { ... }
async function callOpenAI(model: string, system: string, user: string): Promise<string> { ... }
async function callGoogle(model: string, system: string, user: string): Promise<string> { ... }
```

Uses the official SDKs: `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`.

#### 6. `scheduler.ts` — Cron Fallback

Uses [`node-cron`](https://github.com/node-cron/node-cron) for scheduling:

```typescript
import cron from "node-cron";

cron.schedule("0 0 * * *", runPipeline);                    // daily fallback
cron.schedule("0 6 * * 1", runTrendAnalysis);               // weekly trends (Mon 6am)
```

#### 7. `alerter.ts` — Error Notifications

- Sends alerts via **Home Assistant webhook** (push notification to phone).
- Optional: email via SMTP.
- Single `send(message)` interface.

#### 8. `mapper.ts` — Garmin → Notion Field Mapping

Pure functions transforming Garmin activity data into Notion property objects. Handles:
- Workout type string → Notion select option
- Duration/pace calculations
- Missing fields (strength, yoga → no distance/pace)

#### 9. `prompts/` — LLM Prompt Templates

Template literal strings or `.txt` files:
- `postWorkoutSummary.txt`
- `recoveryRecommendation.txt`
- `weeklyTrendAnalysis.txt`
- `nutritionalGuidance.txt`

---

### Garmin Sidecar (Python)

A minimal Flask/FastAPI app that wraps `python-garminconnect`. Its only job is to authenticate with Garmin Connect and expose activity data over HTTP to the core service.

#### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/activities/latest` | Returns the most recent activity (with 2-hour recency guard) |
| `GET` | `/activities?date=YYYY-MM-DD` | Returns all activities for a given date (for cron fallback) |
| `GET` | `/health` | Liveness probe |

#### Why a sidecar, not a Lambda/serverless function?

Garmin Connect uses session-based auth (not a proper API key). The sidecar maintains a persistent session, re-authenticating when tokens expire. This is simpler as a long-running process than as a stateless function.

#### Implementation

```python
from garminconnect import Garmin
from flask import Flask, jsonify

app = Flask(__name__)
garmin = Garmin(GARMIN_EMAIL, GARMIN_PASSWORD)
garmin.login()

@app.route("/activities/latest")
def latest_activity():
    activities = garmin.get_activities(0, 1)  # most recent
    if not activities:
        return jsonify(None), 204
    return jsonify(activities[0])
```

---

## Project Structure

```
workout-autopilot/
├── src/                        # TypeScript core service
│   ├── app.ts                  # Hono entrypoint
│   ├── pipeline.ts             # orchestration
│   ├── garminClient.ts         # HTTP client → Garmin sidecar
│   ├── notionClient.ts         # Notion SDK
│   ├── llmRouter.ts            # LLM provider routing
│   ├── scheduler.ts            # node-cron jobs
│   ├── alerter.ts              # error notifications
│   ├── mapper.ts               # data transformation
│   ├── config.ts               # env/config loading
│   └── prompts/
│       ├── postWorkoutSummary.txt
│       ├── recoveryRecommendation.txt
│       ├── weeklyTrendAnalysis.txt
│       └── nutritionalGuidance.txt
├── garmin-sidecar/             # Python Garmin service
│   ├── main.py                 # Flask app
│   ├── requirements.txt
│   └── Dockerfile
├── tests/
│   ├── pipeline.test.ts
│   ├── garminClient.test.ts
│   ├── notionClient.test.ts
│   ├── llmRouter.test.ts
│   ├── mapper.test.ts
│   └── scheduler.test.ts
├── docker-compose.yml
├── Dockerfile                  # Core service
├── package.json
├── tsconfig.json
├── .env.example
└── ARCHITECTURE.md             # this file
```

---

## Deployment

### Two Containers

```yaml
# docker-compose.yml
services:
  core:
    build: .
    env_file: .env
    ports:
      - "8000:8000"
    depends_on:
      - garmin
    restart: unless-stopped

  garmin:
    build: ./garmin-sidecar
    env_file: .env
    expose:
      - "5000"
    restart: unless-stopped
```

Still simple — no databases, no workflow engine. The Garmin sidecar is internal-only (no published ports).

### Environment Variables

| Variable | Description | Used by |
|---|---|---|
| `WEBHOOK_SECRET` | Shared secret for HA webhook auth | core |
| `GARMIN_EMAIL` | Garmin Connect login | garmin |
| `GARMIN_PASSWORD` | Garmin Connect password | garmin |
| `GARMIN_SIDECAR_URL` | Internal URL of Garmin sidecar | core |
| `NOTION_TOKEN` | Notion integration token | core |
| `NOTION_DATABASE_ID` | Target Notion database | core |
| `ANTHROPIC_API_KEY` | Anthropic API key | core |
| `OPENAI_API_KEY` | OpenAI API key | core |
| `GOOGLE_AI_API_KEY` | Google AI API key | core |
| `HA_WEBHOOK_URL` | Home Assistant alert webhook | core |
| `ALERT_EMAIL` | Optional email for alerts | core |

---

## What Changes vs. the Current Issues

The GitHub issues remain valid — they describe **what** to build, not **how** to orchestrate it:

| Issue | N8N approach | New approach |
|---|---|---|
| #8 Field mapping | N8N function node | `mapper.ts` |
| #10 Duplicate detection | N8N logic node | `notionClient.upsert()` |
| #11 Daily cron | N8N cron trigger | `scheduler.ts` (node-cron) |
| #12 Error alerting | N8N error workflow | `alerter.ts` |
| #14 Summary LLM node | N8N sub-workflow | `llmRouter.postWorkoutSummary()` |
| #16 Recovery LLM node | N8N sub-workflow | `llmRouter.recoveryRecommendation()` |
| #17 Coaching → Notion | N8N Notion node | `notionClient.appendCoaching()` |
| #19 Trend analysis | N8N cron + LLM node | `scheduler.ts` + `llmRouter` |
| #21 Nutrition LLM | N8N sub-workflow | `llmRouter.nutritionalGuidance()` |
| #25 Idempotent re-run | N8N workflow logic | `pipeline.ts` + `notionClient.upsert()` |
| #27 Export workflow JSON | N8N export | Git repo **is** the workflow |
| #28 Architecture doc | CLAUDE.md | This file |

---

## Testing Strategy

- **Unit tests**: Vitest for TypeScript modules. Mock external APIs (Notion, LLM providers) and the Garmin sidecar.
- **Garmin sidecar tests**: pytest for the thin Flask layer.
- **Integration tests**: Test the full pipeline with recorded API responses (MSW for HTTP mocking).
- **TDD**: Existing test-first issues (#9, #13, #15, #18, #20, #24) map directly to `tests/` files.

---

## Migration Path

1. **M0**: Set up TypeScript project (Hono, Vitest, tsconfig), Python sidecar, Docker, env vars
2. **M1**: Implement `garmin-sidecar`, `garminClient.ts`, `mapper.ts`, `notionClient.ts`
3. **M2**: Implement `llmRouter.ts` + coaching prompts
4. **M3**: Add trend analysis + nutritional guidance
5. **M4**: Hardening, idempotency, alerting, this doc
