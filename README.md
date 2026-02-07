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
  - Reads tasks from `/home/debian/projects/todo-list/tasks.json` and groups by category.

- **Job Search / Investment**
  - Placeholder panels for future expansion.

## Running

```bash
cd /home/debian/projects/cerebro
node server.js
```

Then visit: `http://localhost:3460`

## Notes for Other Agents

- **Server-side APIs** live in `server.js`. Update these if you need additional OpenClaw data.
- **UI and styling** are all in `index.html`. Tabs and sub-tabs are handled via small JS helpers.
- **Kanban tasks** are stored in `tasks.json`; structure matches the legacy kanban project.
- The dashboard expects `openclaw` to be available in PATH for sessions/agents/cron listing.
