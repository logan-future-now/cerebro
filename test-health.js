#!/usr/bin/env node
/**
 * Health Check System Tests
 * 
 * Run with: node test-health.js
 */

const http = require('http');
const assert = require('assert');

const BASE_URL = 'http://localhost:3460';

async function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (err) {
    console.error(`❌ ${name}`);
    console.error(`   ${err.message}`);
    process.exitCode = 1;
  }
}

async function runTests() {
  console.log('\n🧪 Running Health Check System Tests\n');

  // Test 1: Cerebro's own health endpoint
  await test('GET /health returns ok status', async () => {
    const res = await request('/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(res.data.service, 'cerebro');
    assert.ok(res.data.time);
  });

  // Test 2: Get all services
  await test('GET /api/health/services returns service list', async () => {
    const res = await request('/api/health/services');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.services));
    assert.ok(res.data.services.length > 0);
    assert.ok(res.data.timestamp);
  });

  // Test 3: Service data structure
  await test('Service data includes all required fields', async () => {
    const res = await request('/api/health/services');
    const service = res.data.services[0];
    assert.ok(service.service_id);
    assert.ok(service.name);
    assert.ok(service.host);
    assert.ok(typeof service.port === 'number');
    assert.ok(['healthy', 'degraded', 'unhealthy', 'unreachable', 'unknown'].includes(service.status));
  });

  // Test 4: Get service history
  await test('GET /api/health/services/:id/history returns history', async () => {
    const res = await request('/api/health/services/cerebro/history?hours=1');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.service_id, 'cerebro');
    assert.ok(Array.isArray(res.data.history));
  });

  // Test 5: Manual health check
  await test('POST /api/health/services/:id/check triggers check', async () => {
    const res = await request('/api/health/services/cerebro/check', { method: 'POST' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.service_id, 'cerebro');
    assert.ok(res.data.status);
    assert.ok(typeof res.data.response_time_ms === 'number');
    assert.ok(res.data.checked_at);
  });

  // Test 6: Cerebro should report as healthy
  await test('Cerebro service reports as healthy', async () => {
    const res = await request('/api/health/services');
    const cerebro = res.data.services.find(s => s.service_id === 'cerebro');
    assert.ok(cerebro);
    assert.strictEqual(cerebro.status, 'healthy');
    assert.ok(cerebro.response_time_ms < 1000); // Should be fast
  });

  // Test 7: Logan Sidecar health
  await test('Logan Sidecar service is monitored', async () => {
    const res = await request('/api/health/services');
    const sidecar = res.data.services.find(s => s.service_id === 'logan-sidecar');
    assert.ok(sidecar);
    assert.strictEqual(sidecar.name, 'Logan Sidecar');
    assert.strictEqual(sidecar.port, 18790);
  });

  // Test 8: History contains valid data
  await test('Service history contains valid check data', async () => {
    // Trigger a check first
    await request('/api/health/services/cerebro/check', { method: 'POST' });
    
    // Get history
    const res = await request('/api/health/services/cerebro/history?hours=1');
    assert.ok(res.data.history.length > 0);
    
    const check = res.data.history[0];
    assert.ok(check.status);
    assert.ok(typeof check.checked_at === 'number');
  });

  // Test 9: Invalid service returns 404
  await test('POST check for non-existent service returns 404', async () => {
    const res = await request('/api/health/services/nonexistent/check', { method: 'POST' });
    assert.strictEqual(res.status, 404);
  });

  console.log('\n✨ All tests completed\n');
}

// Run tests
runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
