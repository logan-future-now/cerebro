const http = require('http');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const PORT = process.env.PORT || 3460;
const PORTFOLIO_TRACKER_HOST = process.env.PORTFOLIO_TRACKER_HOST || 'localhost';
const DB_PATH = path.join(__dirname, 'tasks.db');
const TODO_FILE = '/home/debian/projects/todo-list/tasks.json';
const DEFAULT_PROJECT = 'General';
const DEFAULT_PRIORITY = 'medium';
const VALID_PRIORITIES = new Set(['high', 'medium', 'low']);
const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;

// Health check configuration
const HEALTH_RUNNER_ENABLED = process.env.HEALTH_RUNNER_ENABLED !== '0';
const HEALTH_DEFAULT_INTERVAL_MS = parseInt(process.env.HEALTH_DEFAULT_INTERVAL_MS) || 60000;
const HEALTH_DEFAULT_TIMEOUT_MS = parseInt(process.env.HEALTH_DEFAULT_TIMEOUT_MS) || 5000;
const HEALTH_RAW_RETENTION_DAYS = parseInt(process.env.HEALTH_RAW_RETENTION_DAYS) || 7;
const HEALTH_SUMMARY_RETENTION_DAYS = parseInt(process.env.HEALTH_SUMMARY_RETENTION_DAYS) || 90;

// Initialize database
const db = new sqlite3.Database(DB_PATH);

// Promisified database methods
function dbAll(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function dbGet(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbRun(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

// ============================================================================
// HEALTH CHECK SYSTEM
// ============================================================================

/**
 * Check the health of a single service
 * @param {Object} service - Service config from database
 * @returns {Object} Health check result
 */
async function checkServiceHealth(service) {
  const startTime = Date.now();
  const url = `${service.protocol}://${service.host}:${service.port}${service.health_path}`;
  
  const result = {
    service_id: service.id,
    name: service.name,
    status: 'unknown',
    response_time_ms: null,
    status_code: null,
    error_message: null,
    checked_at: startTime
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), service.timeout_ms);
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Cerebro-Health-Check/1.0' }
    });
    
    clearTimeout(timeoutId);
    
    const elapsed = Date.now() - startTime;
    result.response_time_ms = elapsed;
    result.status_code = response.status;
    
    // Try to parse response body
    let body = null;
    try {
      const text = await response.text();
      body = JSON.parse(text);
    } catch (e) {
      // Non-JSON response is okay for health checks
    }
    
    // Determine status based on response
    if (response.status >= 500) {
      result.status = 'unhealthy';
      result.error_message = `HTTP ${response.status}`;
    } else if (response.status >= 400) {
      result.status = 'unhealthy';
      result.error_message = `HTTP ${response.status}`;
    } else if (response.status === 200) {
      // Check if service reports its own status
      if (body && body.status === 'degraded') {
        result.status = 'degraded';
      } else if (elapsed > 2000) {
        result.status = 'degraded';
        result.error_message = 'Slow response (>2s)';
      } else if (elapsed > 500) {
        result.status = 'degraded';
        result.error_message = 'Slow response (>500ms)';
      } else {
        result.status = 'healthy';
      }
    } else {
      result.status = 'unhealthy';
      result.error_message = `Unexpected status ${response.status}`;
    }
  } catch (err) {
    result.response_time_ms = Date.now() - startTime;
    
    if (err.name === 'AbortError') {
      result.status = 'unhealthy';
      result.error_message = 'Timeout';
    } else if (err.code === 'ECONNREFUSED') {
      result.status = 'unreachable';
      result.error_message = 'Connection refused';
    } else if (err.code === 'ENOTFOUND') {
      result.status = 'unreachable';
      result.error_message = 'DNS error';
    } else if (err.code === 'ECONNRESET') {
      result.status = 'unreachable';
      result.error_message = 'Connection reset';
    } else {
      result.status = 'unreachable';
      result.error_message = err.message || 'Unknown error';
    }
  }
  
  // Store result in database
  try {
    await dbRun(
      `INSERT INTO health_checks (service_id, status, response_time_ms, status_code, error_message, checked_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [result.service_id, result.status, result.response_time_ms, result.status_code, result.error_message, result.checked_at]
    );
  } catch (err) {
    console.error('Failed to store health check result:', err);
  }
  
  return result;
}

/**
 * Run health checks for all enabled services
 */
async function runScheduledHealthChecks() {
  try {
    const services = await dbAll('SELECT * FROM services WHERE enabled = 1');
    console.log(`[Health] Checking ${services.length} services...`);
    
    for (const service of services) {
      try {
        const result = await checkServiceHealth(service);
        console.log(`[Health] ${service.name}: ${result.status} (${result.response_time_ms}ms)`);
      } catch (err) {
        console.error(`[Health] Error checking ${service.name}:`, err);
      }
    }
  } catch (err) {
    console.error('[Health] Failed to run health checks:', err);
  }
}

/**
 * Aggregate hourly health check summaries
 */
async function aggregateHourlySummaries() {
  try {
    const now = Date.now();
    const hourAgo = now - 3600000;
    const currentHour = Math.floor(now / 3600000) * 3600000;
    
    const services = await dbAll('SELECT id FROM services');
    
    for (const service of services) {
      const checks = await dbAll(
        `SELECT status, response_time_ms 
         FROM health_checks 
         WHERE service_id = ? AND checked_at >= ? AND checked_at < ?`,
        [service.id, currentHour - 3600000, currentHour]
      );
      
      if (checks.length === 0) continue;
      
      const summary = {
        service_id: service.id,
        hour_ts: currentHour - 3600000,
        total_checks: checks.length,
        healthy_count: checks.filter(c => c.status === 'healthy').length,
        degraded_count: checks.filter(c => c.status === 'degraded').length,
        unhealthy_count: checks.filter(c => c.status === 'unhealthy' || c.status === 'unreachable').length,
        avg_response_ms: checks.reduce((sum, c) => sum + (c.response_time_ms || 0), 0) / checks.length,
        max_response_ms: Math.max(...checks.map(c => c.response_time_ms || 0)),
        min_response_ms: Math.min(...checks.filter(c => c.response_time_ms).map(c => c.response_time_ms)),
        uptime_pct: (checks.filter(c => c.status === 'healthy' || c.status === 'degraded').length / checks.length) * 100
      };
      
      await dbRun(
        `INSERT OR REPLACE INTO health_summaries 
         (service_id, hour_ts, total_checks, healthy_count, degraded_count, unhealthy_count, 
          avg_response_ms, max_response_ms, min_response_ms, uptime_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [summary.service_id, summary.hour_ts, summary.total_checks, summary.healthy_count,
         summary.degraded_count, summary.unhealthy_count, summary.avg_response_ms,
         summary.max_response_ms, summary.min_response_ms, summary.uptime_pct]
      );
    }
    
    console.log('[Health] Hourly summaries aggregated');
  } catch (err) {
    console.error('[Health] Failed to aggregate summaries:', err);
  }
}

/**
 * Clean up old health check data
 */
async function cleanupOldHealthData() {
  try {
    const now = Date.now();
    const rawCutoff = now - (HEALTH_RAW_RETENTION_DAYS * 24 * 3600000);
    const summaryCutoff = now - (HEALTH_SUMMARY_RETENTION_DAYS * 24 * 3600000);
    
    const rawResult = await dbRun('DELETE FROM health_checks WHERE checked_at < ?', [rawCutoff]);
    const summaryResult = await dbRun('DELETE FROM health_summaries WHERE hour_ts < ?', [summaryCutoff]);
    
    console.log(`[Health] Cleanup: removed ${rawResult.changes} old checks, ${summaryResult.changes} old summaries`);
  } catch (err) {
    console.error('[Health] Cleanup failed:', err);
  }
}

function normalizeTask(task) {
  const normalized = { ...task };
  normalized.project = typeof normalized.project === 'string' && normalized.project.trim()
    ? normalized.project.trim()
    : DEFAULT_PROJECT;
  const priority = typeof normalized.priority === 'string' ? normalized.priority.toLowerCase().trim() : '';
  normalized.priority = VALID_PRIORITIES.has(priority) ? priority : DEFAULT_PRIORITY;
  normalized.column = normalized.column || 'Backlog';
  return normalized;
}

// Convert DB row to task format (column_name -> column, trashed int -> bool)
function rowToTask(row) {
  return {
    id: row.id,
    title: row.title,
    desc: row.desc,
    column: row.column_name,
    project: row.project,
    priority: row.priority,
    created: row.created,
    trashed: Boolean(row.trashed),
    trashedFrom: row.trashed_from
  };
}

// Convert task to DB format (column -> column_name, trashed bool -> int)
function taskToRow(task) {
  return {
    id: task.id,
    title: task.title,
    desc: task.desc || null,
    column_name: task.column || 'Backlog',
    project: task.project || DEFAULT_PROJECT,
    priority: task.priority || DEFAULT_PRIORITY,
    created: task.created || Date.now(),
    trashed: task.trashed ? 1 : 0,
    trashed_from: task.trashedFrom || null,
    updated: Date.now()
  };
}

async function loadTasks() {
  try {
    const rows = await dbAll('SELECT * FROM tasks ORDER BY created DESC');
    return rows.map(rowToTask);
  } catch (err) {
    console.error('Error loading tasks:', err);
    return [];
  }
}

async function getTaskById(id) {
  try {
    const row = await dbGet('SELECT * FROM tasks WHERE id = ?', [id]);
    return row ? rowToTask(row) : null;
  } catch (err) {
    console.error('Error getting task:', err);
    return null;
  }
}

async function createTask(task) {
  const normalized = normalizeTask(task);
  normalized.id = normalized.id || Date.now().toString(36);
  normalized.created = normalized.created || Date.now();
  
  const row = taskToRow(normalized);
  
  await dbRun(
    `INSERT INTO tasks (id, title, desc, column_name, project, priority, created, trashed, trashed_from, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.title, row.desc, row.column_name, row.project, row.priority, row.created, row.trashed, row.trashed_from, row.updated]
  );
  
  return normalized;
}

async function updateTask(id, updates) {
  const existing = await getTaskById(id);
  if (!existing) return null;
  
  const merged = normalizeTask({ ...existing, ...updates });
  const row = taskToRow(merged);
  
  await dbRun(
    `UPDATE tasks 
     SET title = ?, desc = ?, column_name = ?, project = ?, priority = ?, trashed = ?, trashed_from = ?, updated = ?
     WHERE id = ?`,
    [row.title, row.desc, row.column_name, row.project, row.priority, row.trashed, row.trashed_from, row.updated, id]
  );
  
  return merged;
}

async function deleteTask(id) {
  const result = await dbRun('DELETE FROM tasks WHERE id = ?', [id]);
  return result.changes > 0;
}

// Use full path to openclaw if available
const openclawPath = '/home/debian/.local/share/pnpm/openclaw';

async function listSessions() {
  const raw = await runCLI('openclaw', ['sessions', '--json']);
  return JSON.parse(raw);
}

async function listAgents() {
  const raw = await runCLI('openclaw', ['agents', 'list', '--json']);
  return JSON.parse(raw);
}

async function listCronJobs() {
  const raw = await runCLI('openclaw', ['cron', 'list', '--json']);
  return JSON.parse(raw);
}

function extractAgentId(sessionKey = '') {
  const parts = sessionKey.split(':');
  if (parts[0] !== 'agent') return '';
  return parts[1] || '';
}

function describeSessionKey(key = '') {
  const parts = key.split(':');
  if (parts.length < 3) return key;
  const context = parts.slice(2);
  switch (context[0]) {
    case 'slack':
      if (context[1] === 'channel' && context[2]) return `Slack channel ${context[2]}`;
      return 'Slack';
    case 'subagent':
      return 'Subagent task';
    case 'webui':
      return 'Web UI session';
    case 'cron':
      return 'Scheduled task';
    case 'main':
      return 'Main session';
    default:
      return context.join(' ');
  }
}

function aggregateAgents(agentConfigs, sessions) {
  const now = Date.now();
  const configs = Array.isArray(agentConfigs) ? agentConfigs : [];
  const agg = new Map();

  configs.forEach(cfg => {
    agg.set(cfg.id, {
      id: cfg.id,
      name: cfg.identityName || cfg.name || cfg.id,
      emoji: cfg.identityEmoji || null,
      model: cfg.model || '',
      status: 'off',
      currentWork: null,
      lastActive: null,
      sessionCount: 0,
      totalTokens: 0
    });
  });

  sessions.forEach(session => {
    const agentId = extractAgentId(session.key);
    if (!agentId) return;
    if (!agg.has(agentId)) {
      agg.set(agentId, {
        id: agentId,
        name: agentId,
        emoji: null,
        model: '',
        status: 'off',
        currentWork: null,
        lastActive: null,
        sessionCount: 0,
        totalTokens: 0
      });
    }
    const entry = agg.get(agentId);
    entry.sessionCount += 1;
    entry.totalTokens += session.totalTokens || 0;
    if (!entry.lastActive || session.updatedAt > entry.lastActive) {
      entry.lastActive = session.updatedAt;
      entry.currentWork = describeSessionKey(session.key);
    }
  });

  return Array.from(agg.values()).map(entry => {
    if (entry.lastActive && now - entry.lastActive < ACTIVE_THRESHOLD_MS) {
      entry.status = 'active';
    }
    return entry;
  }).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    if (!a.lastActive) return 1;
    if (!b.lastActive) return -1;
    return b.lastActive - a.lastActive;
  });
}

function readTodoTasks() {
  try {
    const raw = JSON.parse(fs.readFileSync(TODO_FILE, 'utf8'));
    return raw;
  } catch {
    return [];
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (url.pathname === '/health' && req.method === 'GET') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, service: 'cerebro', time: Date.now() }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  if (url.pathname === '/api/health/services' && req.method === 'GET') {
    try {
      const services = await dbAll('SELECT * FROM services WHERE enabled = 1');
      for (const service of services) {
        const latestCheck = await dbGet(
          'SELECT status, response_time_ms, checked_at FROM health_checks WHERE service_id = ? ORDER BY checked_at DESC LIMIT 1',
          [service.id]
        );
        service.status = latestCheck?.status || 'unknown';
        service.response_time_ms = latestCheck?.response_time_ms || null;
        service.checked_at = latestCheck?.checked_at || null;
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ services, timestamp: Date.now() }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  if (url.pathname.startsWith('/api/health/services/') && url.pathname.endsWith('/history') && req.method === 'GET') {
    try {
      const serviceId = url.pathname.split('/')[3];
      const hours = parseInt(url.searchParams.get('hours')) || 1;
      const since = Date.now() - (hours * 3600000);
      
      const checks = await dbAll(
        `SELECT status, response_time_ms, status_code, error_message, checked_at 
         FROM health_checks 
         WHERE service_id = ? AND checked_at >= ? 
         ORDER BY checked_at DESC`,
        [serviceId, since]
      );
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ service_id: serviceId, history: checks, hours: hours }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  if (url.pathname.startsWith('/api/health/services/') && url.pathname.endsWith('/check') && req.method === 'POST') {
    try {
      const serviceId = url.pathname.split('/')[3];
      const service = await dbGet('SELECT * FROM services WHERE id = ?', [serviceId]);
      if (!service) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Service not found' }));
      }
      
      const result = await checkServiceHealth(service);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  if (url.pathname === '/api/sessions' && req.method === 'GET') {
    try {
      const sessions = await listSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(sessions));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  if (url.pathname === '/api/agents' && req.method === 'GET') {
    try {
      const sessionData = await listSessions();
      const agentConfigs = await listAgents();
      const agents = aggregateAgents(agentConfigs, sessionData.sessions || []);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ agents }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  if (url.pathname === '/api/cron' && req.method === 'GET') {
    try {
      const cron = await listCronJobs();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(cron));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  if (url.pathname === '/api/todos' && req.method === 'GET') {
    const todos = readTodoTasks();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ tasks: todos }));
  }

  if (url.pathname === '/api/portfolio/accounts' && req.method === 'GET') {
    try {
      const options = {
        hostname: PORTFOLIO_TRACKER_HOST,
        port: 8000,
        path: '/accounts',
        method: 'GET'
      };
      const proxyReq = http.request(options, (proxyRes) => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(data);
        });
      });
      proxyReq.on('error', (err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
      proxyReq.end();
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/portfolio/positions' && req.method === 'GET') {
    try {
      const options = {
        hostname: PORTFOLIO_TRACKER_HOST,
        port: 8000,
        path: '/positions',
        method: 'GET'
      };
      const proxyReq = http.request(options, (proxyRes) => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(data);
        });
      });
      proxyReq.on('error', (err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
      proxyReq.end();
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // E-Trade auth/sync proxy - forward /api/portfolio/etrade/* to portfolio-tracker
  if (url.pathname.startsWith('/api/portfolio/etrade/')) {
    const subPath = url.pathname.replace('/api/portfolio/etrade', '/api/etrade');
    try {
      let body = '';
      if (req.method === 'POST') {
        await new Promise((resolve) => {
          req.on('data', chunk => body += chunk);
          req.on('end', resolve);
        });
      }
      const options = {
        hostname: PORTFOLIO_TRACKER_HOST,
        port: 8000,
        path: subPath,
        method: req.method,
        headers: { 'Content-Type': 'application/json' }
      };
      const proxyReq = http.request(options, (proxyRes) => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(data);
        });
      });
      proxyReq.on('error', (err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
      if (body) proxyReq.write(body);
      proxyReq.end();
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/tasks') {
    if (req.method === 'GET') {
      try {
        const tasks = await loadTasks();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(tasks));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const task = await createTask(JSON.parse(body));
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(task));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
  }

  if (url.pathname.startsWith('/api/tasks/')) {
    const id = url.pathname.split('/')[3];

    if (req.method === 'PUT') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const update = JSON.parse(body);
          const task = await updateTask(id, update);
          if (!task) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Task not found' }));
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(task));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    if (req.method === 'DELETE') {
      try {
        const deleted = await deleteTask(id);
        if (!deleted) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Task not found' }));
        }
        res.writeHead(204);
        return res.end();
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }
  }

  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.join(__dirname, filePath);
  const ext = path.extname(filePath);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Cerebro server running on port ${PORT} (SQLite backend)`);
});

// Start health check runner
if (HEALTH_RUNNER_ENABLED) {
  console.log(`[Health] Starting health check runner (interval: ${HEALTH_DEFAULT_INTERVAL_MS}ms)`);
  setTimeout(runScheduledHealthChecks, 5000); // Initial delay
  setInterval(runScheduledHealthChecks, HEALTH_DEFAULT_INTERVAL_MS);
  setInterval(aggregateHourlySummaries, 3600000); // Every hour
  setInterval(cleanupOldHealthData, 24 * 3600000); // Every 24 hours
}

process.on('SIGTERM', () => {
  console.log('Closing database connection...');
  db.close((err) => {
    if (err) console.error(err);
    process.exit(0);
  });
});