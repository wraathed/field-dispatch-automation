// Drives the remote /mcp endpoint end to end with the SDK's HTTP client. Skipped without MCP config.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config({ quiet: true });
process.env.MAKE_WEBHOOK_URL = '';
process.env.MAKE_FOLLOWUP_WEBHOOK_URL = '';
const config = require('../src/config');

const enabled = Boolean(config.mcpDatabaseUrl && config.mcpBearerToken);
const skip = !enabled && 'MCP_DATABASE_URL / MCP_BEARER_TOKEN not configured';

let server;
let base;

before(async () => {
  if (!enabled) return;
  const app = require('../src/app');
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (enabled) await require('../src/db').closePool();
});

async function connect(headers) {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } });
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

test('rejects a missing or wrong bearer token', { skip }, async () => {
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
  assert.equal(res.status, 401);
  const bad = await fetch(`${base}/mcp`, { method: 'POST', headers: { authorization: 'Bearer nope', 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
  assert.equal(bad.status, 401);
});

test('lists the six tools and answers a read tool over HTTP', { skip }, async () => {
  const client = await connect({ authorization: `Bearer ${config.mcpBearerToken}` });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'draft_follow_up', 'get_customer_history', 'get_job', 'list_completed_jobs', 'list_customers_without_follow_up', 'list_follow_ups',
  ]);
  const res = await client.callTool({ name: 'list_customers_without_follow_up', arguments: { days: 30 } });
  assert.equal(res.isError, undefined);
  const parsed = JSON.parse(res.content[0].text);
  assert.ok(Array.isArray(parsed.customers));
  await client.close();
});

test('accepts the token as a path segment and runs under the mcp database role', { skip }, async () => {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${config.mcpBearerToken}`)));
  const res = await client.callTool({ name: 'get_job', arguments: { job_id: 'DEMO-1001' } });
  assert.match(res.content[0].text, /DEMO-1001|No job with id/);
  await client.close();

  const db = require('../src/db');
  const { rows } = await db.runWithProfile('mcp', () => db.query('SELECT current_user AS u'));
  assert.equal(rows[0].u, 'mcp_agent');
  const { rows: appRows } = await db.query('SELECT current_user AS u');
  assert.notEqual(appRows[0].u, 'mcp_agent', 'app profile must stay on the full-access role');
});
