# SQLite Migration - 2026-02-11

## What Changed

- **Storage backend**: JSON file → SQLite database
- **Database file**: `tasks.db` (44KB)
- **Schema**: See `schema.sql`

## Migration Summary

✅ Fixed JSON parsing errors (unescaped control characters)
✅ Migrated all 33 tasks to SQLite
✅ Replaced server.js with SQLite version
✅ Service restarted and verified

## Files

- `tasks.db` - SQLite database (primary storage)
- `schema.sql` - Database schema definition
- `migrate-to-sqlite.js` - Migration script (reusable)
- `server.js` - SQLite backend server
- `server.js.json-backup` - Original JSON-based server (backup)
- `tasks.json.pre-sqlite.1770837464225` - Original data (backup)
- `tasks.json` - Still exists but no longer used by server

## Benefits

- **Performance**: Direct queries vs. full file read/write
- **Integrity**: ACID transactions, no partial writes
- **Indexing**: Fast lookups by column, project, priority
- **Concurrency**: Multiple readers, proper locking
- **Reliability**: No more JSON parsing errors from unescaped chars

## Rollback

If needed, restore the old server:
```bash
cd /home/debian/projects/cerebro
cp server.js.json-backup server.js
kill $(pgrep -f 'node.*cerebro/server.js')
node server.js >> cerebro.log 2>&1 &
```

## Testing

```bash
# Check task count
curl -s http://localhost:3460/api/tasks | jq 'length'

# List tasks by column
curl -s http://localhost:3460/api/tasks | jq '[.[] | {id, title, column}]'

# Create a test task
curl -X POST http://localhost:3460/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Test SQLite","desc":"Verify DB write","column":"Backlog"}'
```
