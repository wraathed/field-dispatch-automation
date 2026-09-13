// Shared-secret auth for every API route. Header: x-portal-key: <PORTAL_KEY>  (or Authorization: Bearer <PORTAL_KEY>)
const crypto = require('crypto');
const config = require('./config');

function presentedKey(req) {
  const header = req.get('x-portal-key');
  if (header) return header.trim();
  const auth = req.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m ? m[1].trim() : '';
}

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function requirePortalKey(req, res, next) {
  if (!config.portalKey) {
    return res.status(503).json({ error: 'Server is not configured: PORTAL_KEY is unset' });
  }
  const key = presentedKey(req);
  if (!key || !safeEqual(key, config.portalKey)) {
    return res.status(401).json({ error: 'Invalid or missing portal key' });
  }
  next();
}

module.exports = { requirePortalKey };
