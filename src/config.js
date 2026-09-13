require('dotenv').config({ quiet: true });

const env = process.env;

const config = {
  port: Number(env.PORT) || 3000,
  portalKey: env.PORTAL_KEY || '',
  databaseUrl: env.DATABASE_URL || env.NEON_DB_URL || '',
  mcpDatabaseUrl: env.MCP_DATABASE_URL || '',
  businessTimezone: env.BUSINESS_TIMEZONE || 'America/New_York',
  openaiApiKey: env.OPENAI_API_KEY || '',
  openaiModel: env.OPENAI_MODEL || 'gpt-4o-mini',
  makeWebhookUrl: env.MAKE_WEBHOOK_URL || '',
  makeFollowUpWebhookUrl: env.MAKE_FOLLOWUP_WEBHOOK_URL || '',
  appBaseUrl: (env.APP_BASE_URL || `http://localhost:${Number(env.PORT) || 3000}`).replace(/\/$/, ''),
  isVercel: Boolean(env.VERCEL),
  // Vercel's request body cap is 4.5 MB; keep uploads comfortably under it.
  maxPhotoBytes: 1.5 * 1024 * 1024,
  maxPhotos: 3,
};

module.exports = config;
