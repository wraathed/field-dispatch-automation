// Creates (or rotates) the least-privilege Postgres role used by the MCP server:
//   SELECT on every table in public, INSERT on follow_ups only.
// Prints the resulting connection string; pass --write-env to store it as MCP_DATABASE_URL in .env.
require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createPool, describeTarget, resolveConnectionString } = require('../src/db');

const ROLE = 'mcp_agent';

async function main() {
  const adminUrl = resolveConnectionString('app');
  const pool = createPool(adminUrl);
  const password = crypto.randomBytes(24).toString('base64url');
  console.log(`Provisioning role "${ROLE}" on ${describeTarget()} ...`);
  try {
    const { rows: existing } = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROLE]);
    // Role names / passwords cannot be bound as parameters; the values here are program-generated, not user input.
    if (existing.length) {
      await pool.query(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${password}'`);
      console.log('Role existed; password rotated.');
    } else {
      await pool.query(`CREATE ROLE ${ROLE} WITH LOGIN PASSWORD '${password}'`);
      console.log('Role created.');
    }
    const { rows: [{ db }] } = await pool.query('SELECT current_database() AS db');
    await pool.query(`REVOKE ALL ON SCHEMA public FROM ${ROLE}`);
    await pool.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ROLE}`);
    await pool.query(`GRANT CONNECT ON DATABASE "${db}" TO ${ROLE}`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ROLE}`);
    await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${ROLE}`);
    await pool.query(`GRANT INSERT ON follow_ups TO ${ROLE}`);
    await pool.query(`GRANT USAGE ON SEQUENCE follow_ups_id_seq TO ${ROLE}`);
    console.log('Grants applied: SELECT on all tables, INSERT on follow_ups.');

    const url = new URL(adminUrl);
    url.username = ROLE;
    url.password = password;
    const mcpUrl = url.toString();
    console.log('\nMCP_DATABASE_URL=' + mcpUrl);

    if (process.argv.includes('--write-env')) {
      const envPath = path.join(__dirname, '..', '.env');
      let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      if (/^MCP_DATABASE_URL=.*$/m.test(env)) {
        env = env.replace(/^MCP_DATABASE_URL=.*$/m, () => `MCP_DATABASE_URL=${mcpUrl}`);
      } else {
        env = env.replace(/\s*$/, '\n') + `MCP_DATABASE_URL=${mcpUrl}\n`;
      }
      fs.writeFileSync(envPath, env);
      console.log('Written to .env');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error('Role provisioning failed:', err.message); process.exit(1); });
