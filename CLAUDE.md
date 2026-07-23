# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Cerebro is a unified operations dashboard running on port 3460. It provides:
- **Control tab**: OpenClaw sessions, AI agents, and cron jobs (via `openclaw` CLI)
- **Task Board**: Kanban tasks stored in SQLite (`tasks.db`)
- **Todo**: Reads from `todo-list/tasks.db` (SQLite, managed separately)
- **Health Monitor**: Polls configured services, stores results in SQLite, renders with Chart.js
- **Investments**: Proxies to a portfolio-tracker service at `localhost:8000`

## Running the Server

```bash
node server-sqlite.js        # development
sudo systemctl restart cerebro  # production (systemd)
journalctl -u cerebro -f        # follow production logs
```

The server auto-initializes the SQLite schema and seeds default services on startup.

## Key Files

- **`server-sqlite.js`** — The active server (~833 lines). Single file, no Express. Handles all routing, SQLite CRUD, health check runner, OpenClaw CLI calls, and portfolio proxy.
- **`index.html`** — Single-page UI (~78KB). Pure vanilla JS, no framework. All tabs, drag-drop, modals, and Chart.js health graphs live here.
- **`tasks.db`** — SQLite database. Tables: `tasks`, `services`, `health_checks`, `health_summaries`.
- **`schema.sql`** — Authoritative schema definition.
- **`.env`** — Local config overrides (currently just `HOST=127.0.0.1`).

`server.js` is an older alternate server — `server-sqlite.js` is the one systemd runs.

## Architecture

The server is a minimal Node.js HTTP server (no framework). Request routing is manual string matching on `req.url`. All DB access uses promisified `sqlite3` callbacks. OpenClaw data comes from `child_process.execFile('openclaw', ...)`. Health checks run on a background interval (default 60s), writing raw results and computing hourly summaries.

The UI is pure client-side JS in `index.html`. Tab switching is show/hide. API calls are `fetch()` against the same origin.

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3460` | HTTP listen port |
| `HOST` | `127.0.0.1` | Bind address |
| `PORTFOLIO_TRACKER_HOST` | `localhost` | Portfolio API hostname |
| `HEALTH_RUNNER_ENABLED` | `1` | Set `0` to disable background health checks |
| `HEALTH_DEFAULT_INTERVAL_MS` | `60000` | Health check poll interval |
| `HEALTH_DEFAULT_TIMEOUT_MS` | `5000` | Per-service check timeout |
| `HEALTH_RAW_RETENTION_DAYS` | `7` | Days to keep raw `health_checks` rows |
| `HEALTH_SUMMARY_RETENTION_DAYS` | `90` | Days to keep `health_summaries` rows |

## Database Schema

**`tasks`**: Kanban cards. `column_name` is the board column; `trashed` (0/1) soft-deletes; `trashed_from` remembers the original column.

**`services`**: Health check targets. Seeded with: `portfolio-tracker`, `news-scraper`, `cerebro`, `logan-sidecar`, `openclaw-gateway`.

**`health_checks`**: Raw per-check results. Status values: `healthy`, `degraded`, `unhealthy`, `unreachable`.

**`health_summaries`**: Hourly aggregates keyed on `(service_id, hour_ts)`.

## API Routes

```
GET  /health                                    # liveness probe
GET  /api/tasks                                 # list tasks
POST /api/tasks                                 # create task {title, desc, column, project, priority}
PUT  /api/tasks/:id                             # update task
DEL  /api/tasks/:id                             # delete task
GET  /api/sessions                              # openclaw sessions
GET  /api/agents                                # openclaw agents (merged with configs)
GET  /api/cron                                  # openclaw cron list
GET  /api/todos                                 # read todo-list/tasks.db
GET  /api/health/services                       # all services + latest status
POST /api/health/services/:id/check             # trigger immediate check
GET  /api/health/services/:id/history?hours=24  # historical checks
GET  /api/portfolio/*                           # proxy to localhost:8000
```

## Deployment

Systemd service: `/etc/systemd/system/cerebro.service`
- Runs as user `debian`, working dir `/home/debian/projects/cerebro`
- `ExecStart=/usr/bin/node server-sqlite.js`
- PATH includes `/home/debian/.local/share/pnpm` so `openclaw` CLI is available
- Hardened: `NoNewPrivileges=true`, `ProtectSystem=full`, `PrivateTmp=true`
- No Docker — host-only deployment.
