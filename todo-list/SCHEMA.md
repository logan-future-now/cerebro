# Todo List Schema

## Task Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique identifier |
| `title` | string | yes | Task name |
| `category` | string | yes | Category (see below) |
| `status` | string | yes | Current status |
| `dueDate` | string | no | ISO date (YYYY-MM-DD) or null |
| `notes` | string | no | Additional notes |
| `created` | number | yes | Unix timestamp (ms) |

## Status Values

- `todo` - Not started
- `in-progress` - Currently working
- `blocked` - Waiting on something
- `done` - Completed

## Categories

| Category | Description |
|----------|-------------|
| `personal life` | General personal matters |
| `self mastery` | Gym, yoga, diet, self-care |
| `investing research` | Investment research |
| `trading` | Active trading tasks |
| `employment search` | Job hunting |
| `parenting` | Kid-related |
| `shopping` | Purchases |
| `family` | Family matters |
| `openclaw` | OpenClaw project work |
| `personal projects` | Other personal projects |

## Rules

1. **Category inference**: If no category specified, infer from task name/description
2. **New categories**: Ask before adding categories outside this list
3. **Status tracking**: Update status as work progresses
