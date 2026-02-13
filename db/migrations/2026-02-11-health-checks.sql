-- Health checks schema migration (monolithic inside Cerebro)
-- Date: 2026-02-11
-- NOTE: Cerebro currently uses ad-hoc CREATE TABLE IF NOT EXISTS rather than a migration runner.
-- Apply manually via sqlite3 or incorporate into server startup.

-- Service registry
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL DEFAULT 'localhost',
  port INTEGER NOT NULL,
  health_path TEXT NOT NULL DEFAULT '/health',
  protocol TEXT NOT NULL DEFAULT 'http',
  timeout_ms INTEGER NOT NULL DEFAULT 5000,
  check_interval_ms INTEGER NOT NULL DEFAULT 60000,
  restart_command TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Raw time-series results
CREATE TABLE IF NOT EXISTS health_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id TEXT NOT NULL REFERENCES services(id),
  status TEXT NOT NULL, -- healthy|degraded|unhealthy|unreachable
  response_time_ms INTEGER,
  status_code INTEGER,
  error_message TEXT,
  checked_at INTEGER NOT NULL -- Unix ms timestamp
);
CREATE INDEX IF NOT EXISTS idx_hc_svc_time ON health_checks(service_id, checked_at DESC);

-- Hourly aggregates
CREATE TABLE IF NOT EXISTS health_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id TEXT NOT NULL,
  hour_ts INTEGER NOT NULL, -- Unix ms timestamp, truncated to the hour
  total_checks INTEGER NOT NULL,
  healthy_count INTEGER NOT NULL,
  degraded_count INTEGER NOT NULL,
  unhealthy_count INTEGER NOT NULL,
  avg_response_ms REAL,
  max_response_ms INTEGER,
  min_response_ms INTEGER,
  uptime_pct REAL,
  UNIQUE(service_id, hour_ts)
);
CREATE INDEX IF NOT EXISTS idx_hs_svc_time ON health_summaries(service_id, hour_ts DESC);

-- Seed defaults (safe to re-run)
INSERT OR IGNORE INTO services (id, name, host, port, health_path, protocol, timeout_ms, check_interval_ms, enabled)
VALUES
  ('portfolio-tracker', 'Portfolio Tracker', 'localhost', 8000, '/health', 'http', 5000, 60000, 1),
  ('news-scraper', 'News Scraper', 'localhost', 8001, '/health', 'http', 5000, 60000, 1),
  ('cerebro', 'Cerebro', 'localhost', 3460, '/health', 'http', 2000, 60000, 1),
  ('logan-sidecar', 'Logan Sidecar', 'localhost', 18790, '/health', 'http', 2000, 60000, 1),
  ('openclaw-gateway', 'OpenClaw Gateway', 'localhost', 18788, '/health', 'http', 2000, 60000, 1);
