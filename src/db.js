// Single place that knows how to reach Postgres.
// Profiles: 'app' (full access; web app, migrations, seed) and 'mcp' (least-privilege role for the agent).
const { Pool } = require('pg');
const config = require('./config');

function resolveConnectionString(profile = process.env.DB_PROFILE || 'app') {
  const url = profile === 'mcp' ? config.mcpDatabaseUrl : config.databaseUrl;
  if (!url) {
    const name = profile === 'mcp' ? 'MCP_DATABASE_URL (run: npm run db:role -- --write-env)' : 'DATABASE_URL';
    throw new Error(`Missing ${name} in environment`);
  }
  return url;
}

function describeTarget(profile) {
  try {
    const u = new URL(resolveConnectionString(profile));
    return `${u.username}@${u.hostname}${u.pathname}`;
  } catch {
    return '(unconfigured database)';
  }
}

function createPool(connectionString = resolveConnectionString()) {
  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: true },
    max: config.isVercel ? 2 : 10,
    idleTimeoutMillis: 10_000,
  });
}

let shared;
function getPool() {
  if (!shared) shared = createPool();
  return shared;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function closePool() {
  if (shared) {
    await shared.end();
    shared = undefined;
  }
}

module.exports = { createPool, getPool, query, withTransaction, closePool, resolveConnectionString, describeTarget };
