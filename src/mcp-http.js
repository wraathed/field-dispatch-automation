// Remote MCP endpoint (Streamable HTTP, stateless) so any MCP client can connect by URL.
//   Auth: Authorization: Bearer <MCP_BEARER_TOKEN>, or the token as a path segment (/mcp/<token>)
//         for connectors that have no place to enter a header.
//   Data: every request runs under the 'mcp' database profile (least-privilege role), regardless of
//         which pool the rest of the web app uses.
// Stateless mode: a fresh McpServer + transport per request, JSON responses (no long-lived SSE),
// which is what a serverless host like Vercel can actually serve.
const crypto = require('crypto');
const express = require('express');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const config = require('./config');
const db = require('./db');
const { createMcpServer } = require('./mcp-tools');

const router = express.Router();

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function presentedToken(req) {
  const auth = req.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  return (req.params.token || '').trim();
}

function authenticate(req, res, next) {
  if (!config.mcpBearerToken || !config.mcpDatabaseUrl) {
    const missing = [!config.mcpBearerToken && 'MCP_BEARER_TOKEN', !config.mcpDatabaseUrl && 'MCP_DATABASE_URL'].filter(Boolean);
    return res.status(503).json({ error: `MCP endpoint is not configured: ${missing.join(', ')} unset` });
  }
  const token = presentedToken(req);
  if (!token || !safeEqual(token, config.mcpBearerToken)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="field-dispatch-mcp"');
    return res.status(401).json({ error: 'Invalid or missing MCP bearer token' });
  }
  next();
}

async function handle(req, res) {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
  try {
    await db.runWithProfile('mcp', async () => {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });
  } catch (err) {
    console.error('[mcp-http]', err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
}

router.all(['/mcp', '/mcp/:token'], authenticate, handle);

module.exports = router;
