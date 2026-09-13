// Applies db/schema.sql to the database in DATABASE_URL (or NEON_DB_URL). Idempotent.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { createPool, describeTarget } = require('../src/db');

async function main() {
  const pool = createPool();
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log(`Applying schema to ${describeTarget()} ...`);
  try {
    await pool.query(sql);
    const { rows } = await pool.query(
      `SELECT table_name, count(*)::int AS columns
         FROM information_schema.columns WHERE table_schema = 'public'
        GROUP BY table_name ORDER BY table_name`
    );
    console.table(rows);
    console.log('Schema is up to date.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error('Migration failed:', err.message); process.exit(1); });
