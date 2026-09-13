// Pushes the runtime environment from .env to a linked Vercel project (production + preview).
// Usage: node scripts/vercel-env.js [--env production|preview]   (default: both)
require('dotenv').config({ quiet: true });
const { spawnSync } = require('child_process');

const VARS = ['DATABASE_URL', 'MCP_DATABASE_URL', 'MCP_BEARER_TOKEN', 'PORTAL_KEY', 'OPENAI_API_KEY', 'MAKE_WEBHOOK_URL', 'MAKE_FOLLOWUP_WEBHOOK_URL', 'BUSINESS_TIMEZONE', 'APP_BASE_URL'];

const only = process.argv.includes('--env') ? process.argv[process.argv.indexOf('--env') + 1] : null;
const targets = only ? [only] : ['production', 'preview'];

// The web app accepts NEON_DB_URL as a fallback locally, but on Vercel we push it as DATABASE_URL.
const values = { ...process.env, DATABASE_URL: process.env.DATABASE_URL || process.env.NEON_DB_URL };

let failures = 0;
for (const name of VARS) {
  const value = values[name];
  if (!value) { console.log(`skip ${name} (unset)`); continue; }
  for (const target of targets) {
    const res = spawnSync('npx', ['vercel', 'env', 'add', name, target, '--force'], { input: value, encoding: 'utf8', shell: true });
    const ok = res.status === 0;
    if (!ok) failures++;
    console.log(`${ok ? 'set ' : 'FAIL'} ${name} (${target})${ok ? '' : ': ' + (res.stderr || res.stdout).trim().split('\n').pop()}`);
  }
}
process.exit(failures ? 1 : 0);
