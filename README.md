# Cerebro Dashboard

A unified, dark-themed control dashboard that brings together OpenClaw control panels, a kanban task board, and todo list views.

## Project Structure

```
/cerebro
  ├─ index.html        # Single-page dashboard UI (tabs, styling, client logic)
  ├─ server.js         # Minimal Node HTTP server + API proxies
  ├─ tasks.json        # Kanban task store (ported from /projects/kanban)
  └─ README.md         # This file
```

## Key Features

- **Control** tab
  - **Sessions**: Uses `openclaw sessions --json` (gateway sessions_list) to show session usage.
  - **Agents**: Aggregates sessions into agent status cards.
  - **Cron Jobs**: Uses `openclaw cron list --json` and shows payload prompt in a modal.

- **Task Board**
  - Ported from `/home/debian/projects/kanban` with full CRUD, drag/drop, trash, and priorities.
  - Columns auto-size to viewport.

- **Todo List**
  - Reads tasks from `./todo-list/tasks.db` (SQLite) and groups by category.

- **Job Search / Investment**
  - Placeholder panels for future expansion.

## Prerequisites

- **Node.js** (no external npm dependencies; uses only built-in modules)
- **OpenClaw CLI** available in `PATH` if you want the Control tab to work (`openclaw sessions|agents|cron`)

## Configuration

Environment variables:

- `PORT` (optional): HTTP port to listen on (default: `3460`)

Local file paths:

- Kanban tasks are stored in `./tasks.json`
- Todo tasks are read from `./todo-list/tasks.db`

## Running (Local)

```bash
cd /home/debian/projects/cerebro
node server.js
```

Then visit: `http://localhost:3460`

## Production Service (systemd)

Cerebro is deployed as a **systemd** service (simpler than Docker for a single Node process, and it preserves access to the host-installed `openclaw` CLI).

Service unit: `/etc/systemd/system/cerebro.service`

Common commands:

```bash
# start/stop/restart
sudo systemctl start cerebro
sudo systemctl stop cerebro
sudo systemctl restart cerebro

# enable at boot
sudo systemctl enable cerebro

# status + logs
sudo systemctl status cerebro
journalctl -u cerebro -f
```

The service is configured to:
- Start automatically on reboot (`systemctl enable`)
- Restart automatically on failure (`Restart=on-failure`)
- Run as user `debian`
- Expose port `3460` (set via `PORT=3460`)
- Include `openclaw` in `PATH` (via an explicit `Environment=PATH=...` in the unit)

## Notes for Other Agents

- **Server-side APIs** live in `server.js`. Update these if you need additional OpenClaw data.
- **UI and styling** are all in `index.html`. Tabs and sub-tabs are handled via small JS helpers.
- **Kanban tasks** are stored in `tasks.json`; structure matches the legacy kanban project.
- The dashboard expects `openclaw` to be available in PATH for sessions/agents/cron listing.
