const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const PORT = process.env.PORT || 3460;
const TASKS_FILE = path.join(__dirname, 'tasks.json');
const TODO_FILE = '/home/debian/projects/todo-list/tasks.json';
const DEFAULT_PROJECT = 'General';
const DEFAULT_PRIORITY = 'medium';
const VALID_PRIORITIES = new Set(['high', 'medium', 'low']);
const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;

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

function loadTasks() {
  try {
    const raw = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
    let changed = false;
    const normalized = raw.map(task => {
      const next = normalizeTask(task);
      if (next.project !== task.project || next.priority !== task.priority || next.column !== task.column) {
        changed = true;
      }
      return next;
    });
    if (changed) {
      saveTasks(normalized);
    }
    return normalized;
  } catch {
    return [];
  }
}

function saveTasks(tasks) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

async function runCLI(cmd, args) {
  const { stdout } = await execFileAsync(cmd, args, { timeout: 15000 });
  return stdout;
}

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

  if (url.pathname === '/api/tasks') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(loadTasks()));
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const tasks = loadTasks();
        const task = normalizeTask(JSON.parse(body));
        task.id = task.id || Date.now().toString(36);
        task.created = task.created || Date.now();
        tasks.push(task);
        saveTasks(tasks);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(task));
      });
      return;
    }
  }

  if (url.pathname.startsWith('/api/tasks/')) {
    const id = url.pathname.split('/')[3];
    let tasks = loadTasks();
    const idx = tasks.findIndex(t => t.id === id);

    if (req.method === 'PUT') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const update = JSON.parse(body);
        if (idx >= 0) {
          tasks[idx] = normalizeTask({ ...tasks[idx], ...update });
          saveTasks(tasks);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tasks[idx] || {}));
      });
      return;
    }

    if (req.method === 'DELETE') {
      if (idx >= 0) {
        tasks.splice(idx, 1);
        saveTasks(tasks);
      }
      res.writeHead(204);
      return res.end();
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
  console.log(`Cerebro server running on port ${PORT}`);
});
