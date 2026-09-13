#!/usr/bin/env node
// Local MCP server over stdio, for Claude Code / Claude Desktop on this machine.
// Uses the least-privilege MCP_DATABASE_URL role (SELECT everywhere, INSERT on follow_ups).
// The same tools are served remotely at /mcp by the web app (src/mcp-http.js).
process.env.DB_PROFILE = 'mcp';

const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const config = require('../src/config');
const { createMcpServer } = require('../src/mcp-tools');

// stdout is the protocol channel; all logging must go to stderr.
const log = (...args) => console.error('[mcp]', ...args);

async function main() {
  if (!config.mcpDatabaseUrl) {
    log('MCP_DATABASE_URL is not set. Run: npm run db:role -- --write-env');
    process.exit(1);
  }
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
  log(`ready (db user: ${new URL(config.mcpDatabaseUrl).username}, tz: ${config.businessTimezone})`);
}

main().catch((err) => { log('fatal:', err); process.exit(1); });
