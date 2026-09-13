// Single place that knows how to reach Postgres.
// Profiles: 'app' (full access; web app, migrations, seed) and 'mcp' (least-privilege role for the agent).
// The active profile is the DB_PROFILE env var by default, or whatever runWithProfile() sets for the
// current async context, so one process can serve the portal as 'app' and the /mcp route as 'mcp'.
const { AsyncLocalStorage } = require('async_hooks');
const { Pool } = require('pg');
const config = require('./config');

const profileContext = new AsyncLocalStorage();

function currentProfile() {
  return profileContext.getStore() || process.env.DB_PROFILE || 'app';
}

function resolveConnectionString(profile = currentProfile()) {
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

const pools = new Map();
function getPool(profile = currentProfile()) {
  if (!pools.has(profile)) pools.set(profile, createPool(resolveConnectionString(profile)));
  return pools.get(profile);
}

// Runs fn with every db call inside it bound to the given profile.
function runWithProfile(profile, fn) {
  return profileContext.run(profile, fn);
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
  const open = [...pools.values()];
  pools.clear();
  await Promise.all(open.map((p) => p.end()));
}

module.exports = {
  createPool,
  getPool,
  query,
  withTransaction,
  closePool,
  runWithProfile,
  currentProfile,
  resolveConnectionString,
  describeTarget,
};
