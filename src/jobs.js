// Data access for completed_jobs. Shared by the Express API and the MCP server.
// Every function takes plain values and returns plain rows; no HTTP concepts here.
const db = require('./db');
const config = require('./config');

const JOB_COLUMNS = `
  job_id, customer_email, tech_name, raw_notes, summary, price::float8 AS price, status, photo_count,
  (pdf_data IS NOT NULL) AS has_pdf, summary_sent_at, last_error, created_at, updated_at`;

class DuplicateJobError extends Error {
  constructor(jobId, existing) {
    super(`Job ${jobId} already exists (status: ${existing?.status ?? 'unknown'})`);
    this.name = 'DuplicateJobError';
    this.status = 409;
    this.expose = true;
    this.existing = existing;
  }
}

class NotFoundError extends Error {
  constructor(what) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
    this.status = 404;
    this.expose = true;
  }
}

async function getJob(jobId) {
  const { rows } = await db.query(`SELECT ${JOB_COLUMNS} FROM completed_jobs WHERE job_id = $1`, [jobId]);
  return rows[0] || null;
}

async function getJobPdf(jobId) {
  const { rows } = await db.query('SELECT pdf_data FROM completed_jobs WHERE job_id = $1', [jobId]);
  return rows[0]?.pdf_data || null;
}

// Inserts the job in 'received' state. The UNIQUE(job_id) constraint makes this the idempotency lock:
// two submissions of the same job cannot both proceed to the paid LLM call.
async function createJob({ jobId, customerEmail, techName, rawNotes, price, photoCount = 0 }) {
  try {
    const { rows } = await db.query(
      `INSERT INTO completed_jobs (job_id, customer_email, tech_name, raw_notes, price, status, photo_count)
       VALUES ($1, $2, $3, $4, $5, 'received', $6)
       RETURNING ${JOB_COLUMNS}`,
      [jobId, customerEmail, techName, rawNotes, price, photoCount]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new DuplicateJobError(jobId, await getJob(jobId));
    throw err;
  }
}

const UPDATABLE = new Set(['status', 'summary', 'pdf_data', 'summary_sent_at', 'last_error']);

async function updateJob(jobId, fields) {
  const keys = Object.keys(fields).filter((k) => UPDATABLE.has(k));
  if (!keys.length) return getJob(jobId);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const { rows } = await db.query(
    `UPDATE completed_jobs SET ${sets.join(', ')}, updated_at = now() WHERE job_id = $1 RETURNING ${JOB_COLUMNS}`,
    [jobId, ...keys.map((k) => fields[k])]
  );
  if (!rows[0]) throw new NotFoundError(`Job ${jobId}`);
  return rows[0];
}

async function getCustomerHistory(customerEmail, { limit = 50 } = {}) {
  const { rows } = await db.query(
    `SELECT j.job_id, j.tech_name, j.summary, j.price::float8 AS price, j.status, j.created_at, j.summary_sent_at,
            (SELECT count(*)::int FROM follow_ups f WHERE f.job_id = j.job_id AND f.status = 'sent') AS follow_ups_sent,
            (SELECT count(*)::int FROM follow_ups f WHERE f.job_id = j.job_id AND f.status = 'draft') AS follow_ups_pending
       FROM completed_jobs j
      WHERE lower(j.customer_email) = lower($1)
      ORDER BY j.created_at DESC
      LIMIT $2`,
    [customerEmail, limit]
  );
  const totals = rows.reduce(
    (acc, r) => ({ jobs: acc.jobs + 1, spend: acc.spend + (r.price || 0) }),
    { jobs: 0, spend: 0 }
  );
  return { customer_email: customerEmail.toLowerCase(), total_jobs: totals.jobs, total_spend: Math.round(totals.spend * 100) / 100, jobs: rows };
}

// Jobs completed on a calendar date in the business timezone (default: today).
async function listJobsCompletedOn(date = null, { timezone = config.businessTimezone } = {}) {
  const { rows } = await db.query(
    `SELECT ${JOB_COLUMNS}
       FROM completed_jobs
      WHERE (created_at AT TIME ZONE $1)::date = COALESCE($2::date, (now() AT TIME ZONE $1)::date)
      ORDER BY created_at DESC`,
    [timezone, date]
  );
  return rows;
}

async function listRecentJobs({ limit = 25, status = null } = {}) {
  const { rows } = await db.query(
    `SELECT ${JOB_COLUMNS} FROM completed_jobs
      WHERE ($2::text IS NULL OR status = $2)
      ORDER BY created_at DESC LIMIT $1`,
    [limit, status]
  );
  return rows;
}

// Customers whose job completed within the last N days and who have no *sent* follow-up for that job.
async function listCustomersWithoutFollowUp({ days = 7 } = {}) {
  const { rows } = await db.query(
    `SELECT j.job_id, j.customer_email, j.tech_name, j.price::float8 AS price, j.created_at, j.summary_sent_at,
            (SELECT count(*)::int FROM follow_ups f WHERE f.job_id = j.job_id AND f.status = 'draft') AS pending_drafts,
            (SELECT count(*)::int FROM follow_ups f WHERE f.job_id = j.job_id AND f.status = 'rejected') AS rejected_drafts
       FROM completed_jobs j
      WHERE j.status = 'notified'
        AND j.created_at >= now() - ($1 || ' days')::interval
        AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.job_id = j.job_id AND f.status IN ('sent', 'approved'))
      ORDER BY j.created_at ASC`,
    [String(days)]
  );
  return rows;
}

module.exports = {
  DuplicateJobError,
  NotFoundError,
  getJob,
  getJobPdf,
  createJob,
  updateJob,
  getCustomerHistory,
  listJobsCompletedOn,
  listRecentJobs,
  listCustomersWithoutFollowUp,
};
