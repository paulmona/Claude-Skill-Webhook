# Workout Autopilot — Architecture (v2)

> Replaces the N8N-based design from PRD-006. Single Python service, no workflow engine.

## Why Not N8N

N8N adds operational complexity (its own DB, worker processes, credential store, UI) for a workflow that is **linear and deterministic**. The entire pipeline is: trigger → fetch → transform → store → enrich → append. There are no conditional fan-outs, human-in-the-loop steps, or visual editing requirements that justify a workflow engine. A single Python service with clear module boundaries is simpler to develop, test, deploy, and debug.

---

## High-Level Flow

```
Home Assistant                Python Service                    External APIs
─────────────               ────────────────                   ─────────────
                             ┌──────────────┐
  geofence exit ──webhook──▶ │  FastAPI app  │
                             │  POST /hook   │
                             └──────┬───────┘
                                    │
                             ┌──────▼───────┐
                             │ garmin_client │──── Garmin Connect API
                             │ fetch recent  │
                             └──────┬───────┘
                                    │
                             ┌──────▼───────┐
                             │  mapper       │
                             │  transform    │
                             └──────┬───────┘
                                    │
                             ┌──────▼───────┐
                             │ notion_client │──── Notion API
                             │ upsert entry  │
                             └──────┬───────┘
                                    │
                             ┌──────▼───────┐
                             │  llm_router   │──── Anthropic / OpenAI / Google AI
                             │  coaching     │
                             └──────┬───────┘
                                    │
                             ┌──────▼───────┐
                             │ notion_client │──── Notion API
                             │ append coach  │
                             └──────────────┘

  Daily 00:00 UTC ──cron──▶  Same pipeline (fallback)
```

---

## Components

### 1. `app.py` — FastAPI Entrypoint

- **`POST /hook`** — receives the Home Assistant geofence webhook. Validates a shared secret (`WEBHOOK_SECRET`), then kicks off the pipeline asynchronously.
- **`GET /health`** — liveness probe for Docker / monitoring.
- Runs with `uvicorn` behind a single container.

### 2. `pipeline.py` — Orchestrator

Coordinates the sequential steps. Simplified pseudocode:

```python
async def run_pipeline():
    activity = await garmin_client.fetch_latest()
    if not activity or not recency_check(activity):
        return  # nothing new

    mapped = mapper.to_notion_schema(activity)
    entry_id = await notion_client.upsert(mapped)

    # AI coaching — failures here don't block the sync
    try:
        summary = await llm_router.post_workout_summary(mapped)
        recovery = await llm_router.recovery_recommendation(
            mapped, await notion_client.get_training_block()
        )
        await notion_client.append_coaching(entry_id, summary, recovery)
    except LLMError as e:
        await alerter.send(f"LLM coaching failed: {e}")
```

### 3. `garmin_client.py` — Garmin Connect Integration

- Uses the [`garminconnect`](https://github.com/cyberjunky/python-garminconnect) Python library (well-maintained, handles OAuth/session).
- Fetches recent activities with a **2-hour recency guard** (same as current design).
- Handles activities without distance (strength, yoga) gracefully — returns `None` for missing fields.

### 4. `notion_client.py` — Notion Integration

- Uses the official [`notion-client`](https://github.com/ramnes/notion-sdk-py) Python SDK.
- **Upsert logic**: queries by `(date, workout_type)` — updates if exists, creates if not.
- **Training block query**: walks Notion entries backward to last rest day (capped at 14 days) for recovery context.
- **Append coaching**: adds summary + recovery text to the entry's rich-text properties.

### 5. `llm_router.py` — LLM Provider Router

Routes each coaching task to its configured model. No framework needed — just a config map and a thin adapter per provider.

```python
# Config (from env / config.yaml)
LLM_CONFIG = {
    "post_workout_summary":      {"provider": "anthropic", "model": "claude-sonnet-4-20250514"},
    "recovery_recommendation":   {"provider": "anthropic", "model": "claude-sonnet-4-20250514"},
    "weekly_trend_analysis":     {"provider": "google",    "model": "gemini-2.0-flash"},
    "nutritional_guidance":      {"provider": "openai",    "model": "gpt-4o"},
}
```

Each provider adapter is a simple async function:

```python
async def call_anthropic(model: str, system: str, user: str) -> str: ...
async def call_openai(model: str, system: str, user: str) -> str: ...
async def call_google(model: str, system: str, user: str) -> str: ...
```

The router picks the right adapter based on `provider`, calls it, and returns the text. This replaces N8N's "configurable LLM_ENDPOINT per node" pattern with explicit, testable code.

### 6. `scheduler.py` — Cron Fallback

Uses [`APScheduler`](https://apscheduler.readthedocs.io/) (already async-compatible) to run the pipeline daily at midnight UTC. Also handles the weekly trend analysis schedule.

```python
scheduler = AsyncIOScheduler()
scheduler.add_job(run_pipeline, CronTrigger(hour=0, minute=0))           # daily fallback
scheduler.add_job(run_trend_analysis, CronTrigger(day_of_week="mon", hour=6))  # weekly trends
```

### 7. `alerter.py` — Error Notifications

- Sends error alerts via **Home Assistant webhook** (push notification to phone).
- Optional: email via SMTP.
- Wraps all alert destinations behind a single `send(message)` interface.

### 8. `mapper.py` — Garmin → Notion Field Mapping

Pure functions that transform Garmin API responses into Notion property dicts. Handles:
- Workout type string → Notion select option
- Duration/pace calculations
- Missing fields (strength, yoga → no distance/pace)

### 9. `prompts/` — LLM Prompt Templates

Jinja2 or simple f-string templates stored as separate files:
- `post_workout_summary.txt`
- `recovery_recommendation.txt`
- `weekly_trend_analysis.txt`
- `nutritional_guidance.txt`

Separating prompts from code makes them easy to iterate on without touching logic.

---

## Project Structure

```
workout-autopilot/
├── src/
│   ├── __init__.py
│   ├── app.py              # FastAPI entrypoint
│   ├── pipeline.py          # orchestration
│   ├── garmin_client.py     # Garmin Connect API
│   ├── notion_client.py     # Notion API
│   ├── llm_router.py        # LLM provider routing
│   ├── scheduler.py         # APScheduler cron jobs
│   ├── alerter.py           # error notifications
│   ├── mapper.py            # data transformation
│   ├── config.py            # env/config loading
│   └── prompts/
│       ├── post_workout_summary.txt
│       ├── recovery_recommendation.txt
│       ├── weekly_trend_analysis.txt
│       └── nutritional_guidance.txt
├── tests/
│   ├── test_pipeline.py
│   ├── test_garmin_client.py
│   ├── test_notion_client.py
│   ├── test_llm_router.py
│   ├── test_mapper.py
│   └── test_scheduler.py
├── docker-compose.yml
├── Dockerfile
├── pyproject.toml
├── .env.example
└── ARCHITECTURE.md          # this file
```

---

## Deployment

### Single Container

```yaml
# docker-compose.yml
services:
  autopilot:
    build: .
    env_file: .env
    ports:
      - "8000:8000"
    restart: unless-stopped
```

That's it. No Postgres for N8N, no N8N worker, no N8N UI. One container.

### Environment Variables

| Variable | Description | Example |
|---|---|---|
| `WEBHOOK_SECRET` | Shared secret for HA webhook auth | `supersecret` |
| `GARMIN_EMAIL` | Garmin Connect login | `user@email.com` |
| `GARMIN_PASSWORD` | Garmin Connect password | `***` |
| `NOTION_TOKEN` | Notion integration token | `ntn_...` |
| `NOTION_DATABASE_ID` | Target Notion database | `abc123...` |
| `ANTHROPIC_API_KEY` | Anthropic API key | `sk-ant-...` |
| `OPENAI_API_KEY` | OpenAI API key | `sk-...` |
| `GOOGLE_AI_API_KEY` | Google AI API key | `AI...` |
| `HA_WEBHOOK_URL` | Home Assistant alert webhook | `http://ha:8123/api/webhook/...` |
| `ALERT_EMAIL` | Optional email for alerts | `user@email.com` |

---

## What Changes vs. the Current Issues

The GitHub issues remain valid — they describe **what** to build, not **how** to orchestrate it. The mapping is:

| Issue | N8N approach | New approach |
|---|---|---|
| #8 Field mapping | N8N function node | `mapper.py` |
| #10 Duplicate detection | N8N logic node | `notion_client.upsert()` |
| #11 Daily cron | N8N cron trigger | `scheduler.py` (APScheduler) |
| #12 Error alerting | N8N error workflow | `alerter.py` |
| #14 Summary LLM node | N8N sub-workflow | `llm_router.post_workout_summary()` |
| #16 Recovery LLM node | N8N sub-workflow | `llm_router.recovery_recommendation()` |
| #17 Coaching → Notion | N8N Notion node | `notion_client.append_coaching()` |
| #19 Trend analysis | N8N cron + LLM node | `scheduler.py` + `llm_router` |
| #21 Nutrition LLM | N8N sub-workflow | `llm_router.nutritional_guidance()` |
| #25 Idempotent re-run | N8N workflow logic | `pipeline.py` + `notion_client.upsert()` |
| #27 Export workflow JSON | N8N export | Git repo **is** the workflow |
| #28 Architecture doc | CLAUDE.md | This file |

Issues #27 and #28 become trivial — the code **is** the workflow, and this document **is** the architecture doc.

---

## Testing Strategy

- **Unit tests**: Each module is independently testable. Mock external APIs (Garmin, Notion, LLM providers).
- **Integration tests**: Test the full pipeline with recorded API responses (VCR/cassette pattern).
- **TDD**: Existing test-first issues (#9, #13, #15, #18, #20, #24) map directly to `tests/` files.
- **No N8N test overhead**: No need to spin up N8N + Postgres just to run tests.

---

## Migration Path

1. **M0**: Set up the Python project, Docker, env vars (reuse existing credentials)
2. **M1**: Implement `garmin_client`, `mapper`, `notion_client` — direct ports of the N8N nodes
3. **M2**: Implement `llm_router` + coaching prompts
4. **M3**: Add trend analysis + nutritional guidance
5. **M4**: Hardening, idempotency, alerting, this doc
