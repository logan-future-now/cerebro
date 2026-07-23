# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a personal task management system backed by a SQLite database (`tasks.db`). There is no build system, server, or application code — the repository is a structured data store operated directly by Claude or other tooling.

## Working with Tasks

All task data lives in `tasks.db` in the `tasks` table. The schema is defined in `SCHEMA.md`.

**Query tasks with Python:**
```python
import sqlite3
conn = sqlite3.connect("tasks.db")
conn.row_factory = sqlite3.Row
cur = conn.cursor()
cur.execute("SELECT * FROM tasks WHERE status != 'done' ORDER BY created")
```

**Required fields:** `id`, `title`, `category`, `status`, `created` (Unix ms timestamp)  
**Optional fields:** `dueDate` (ISO `YYYY-MM-DD` or `null`), `notes` (string or `null`)

### Status values
`todo` → `in-progress` → `blocked` | `done`

### Categories
`personal life`, `self mastery`, `investing research`, `trading`, `employment search`, `parenting`, `shopping`, `family`, `openclaw`, `personal projects`

> **Note:** Two tasks (`interview-prep`, `apply-for-jobs`) use category `career`, which is not in the schema. Treat `career` as equivalent to `employment search` for new tasks, or ask before formalizing it as a new category.

## Rules

- **Infer category** from task title/notes when not specified.
- **Ask before adding a new category** not in the list above.
- **Update status** as work progresses — don't leave tasks stale.
- Use kebab-case for `id` values derived from the task title.
