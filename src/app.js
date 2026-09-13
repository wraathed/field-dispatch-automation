// Express application. Exported without listening so it runs both locally (server.js) and on Vercel (api/index.js).
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const config = require('./config');
const { requirePortalKey } = require('./auth');
const { validateJobSubmission, validateFollowUpDraft, validateJobId, validateEmail, validateDate, ValidationError } = require('./validate');
const jobs = require('./jobs');
const followups = require('./followups');
const pipeline = require('./pipeline');
const db = require('./db');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.use(cors({ origin: true, allowedHeaders: ['Content-Type', 'x-portal-key', 'Authorization'] }));
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxPhotoBytes, files: config.maxPhotos },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)) return cb(null, true);
    const err = new Error(`Unsupported photo type: ${file.mimetype}`);
    err.status = 415;
    err.expose = true;
    cb(err);
  },
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const reviewer = (req) => (req.get('x-reviewer') || 'portal').slice(0, 120);

// --- Public ---
app.get('/api/health', wrap(async (_req, res) => {
  let database = 'ok';
  try { await db.query('SELECT 1'); } catch (err) { database = `error: ${err.message}`; }
  res.json({ ok: database === 'ok', database, timezone: config.businessTimezone, version: require('../package.json').version });
}));

// --- Authenticated ---
const api = express.Router();
api.use(requirePortalKey);

// Job completion webhook (multipart: fields + photos[]).
api.post('/webhook/job-complete', upload.array('photos'), wrap(async (req, res) => {
  const input = validateJobSubmission(req.body);
  const job = await pipeline.processJob(input, req.files || []);
  res.status(201).json({ message: 'Job processed', job });
}));

api.post('/api/jobs/:jobId/retry-notify', wrap(async (req, res) => {
  const errors = [];
  const jobId = validateJobId(req.params.jobId, errors);
  if (errors.length) throw new ValidationError(errors);
  res.json({ job: await pipeline.retryNotify(jobId) });
}));

api.get('/api/jobs', wrap(async (req, res) => {
  if (req.query.date !== undefined) {
    return res.json({ jobs: await jobs.listJobsCompletedOn(validateDate(req.query.date)) });
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200);
  res.json({ jobs: await jobs.listRecentJobs({ limit, status: req.query.status || null }) });
}));

api.get('/api/jobs/:jobId', wrap(async (req, res) => {
  const job = await jobs.getJob(req.params.jobId);
  if (!job) throw new jobs.NotFoundError(`Job ${req.params.jobId}`);
  res.json({ job, follow_ups: await followups.listFollowUps({ jobId: job.job_id }) });
}));

api.get('/api/jobs/:jobId/pdf', wrap(async (req, res) => {
  const pdf = await jobs.getJobPdf(req.params.jobId);
  if (!pdf) throw new jobs.NotFoundError(`PDF for job ${req.params.jobId}`);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Job_${req.params.jobId}_Summary.pdf"`);
  res.send(pdf);
}));

api.get('/api/customers/:email/history', wrap(async (req, res) => {
  const errors = [];
  const email = validateEmail(req.params.email, errors, 'email');
  if (errors.length) throw new ValidationError(errors);
  res.json(await jobs.getCustomerHistory(email));
}));

api.get('/api/customers/without-follow-up', wrap(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 365);
  res.json({ days, customers: await jobs.listCustomersWithoutFollowUp({ days }) });
}));

api.get('/api/follow-ups', wrap(async (req, res) => {
  res.json({ follow_ups: await followups.listFollowUps({ status: req.query.status || null }) });
}));

api.post('/api/follow-ups', wrap(async (req, res) => {
  const draft = validateFollowUpDraft({ ...req.body, createdBy: req.body.createdBy || reviewer(req) });
  res.status(201).json({ follow_up: await followups.createDraft(draft) });
}));

api.post('/api/follow-ups/:id/approve', wrap(async (req, res) => {
  res.json({ follow_up: await followups.approveDraft(Number(req.params.id), reviewer(req)) });
}));

api.post('/api/follow-ups/:id/reject', wrap(async (req, res) => {
  res.json({ follow_up: await followups.rejectDraft(Number(req.params.id), reviewer(req)) });
}));

api.post('/api/follow-ups/:id/retry', wrap(async (req, res) => {
  res.json({ follow_up: await followups.retrySend(Number(req.params.id), reviewer(req)) });
}));

app.use(api);

// --- Errors ---
app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? `Each photo must be under ${Math.round(config.maxPhotoBytes / 1024 / 1024 * 10) / 10} MB`
      : err.code === 'LIMIT_FILE_COUNT' ? `At most ${config.maxPhotos} photos` : err.message;
    return res.status(413).json({ error: msg });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(`[error] ${req.method} ${req.path}:`, err);
  const body = { error: err.expose ? err.message : 'Internal server error' };
  if (err.errors) body.details = err.errors;
  if (err.existing) body.existing = err.existing;
  res.status(status).json(body);
});

module.exports = app;
