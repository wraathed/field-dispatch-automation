// Local development entrypoint. Vercel uses api/index.js instead.
const app = require('./src/app');
const config = require('./src/config');

app.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}`);
  if (!config.portalKey) console.warn('PORTAL_KEY is not set: every API call will return 503 until it is.');
});
