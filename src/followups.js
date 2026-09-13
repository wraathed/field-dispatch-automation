// Data access + workflow for follow_ups. Agents create drafts; humans approve/reject; approval triggers the send.
const db = require('./db');
const { NotFoundError } = require('./jobs');
const { sendFollowUpEmail } = require('./notify');

const COLUMNS = `id, job_id, customer_email, subject, body, status, created_by, created_at, reviewed_by, reviewed_at, sent_at, last_error`;

class InvalidTransitionError extends Error {
  constructor(id, from, to) {
    super(`Follow-up ${id} is '${from}' and cannot become '${to}'`);
    this.name = 'InvalidTransitionError';
    this.status = 409;
    this.expose = true;
  }
}

async function getFollowUp(id) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM follow_ups WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function listFollowUps({ status = null, jobId = null, limit = 50 } = {}) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM follow_ups
      WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR job_id = $2)
      ORDER BY created_at DESC LIMIT $3`,
    [status, jobId, limit]
  );
  return rows;
}

// Creates a draft. Only needs SELECT on completed_jobs + INSERT on follow_ups, so the MCP role can call it.
async function createDraft({ jobId, subject, body, createdBy }) {
  const { rows: jobs } = await db.query('SELECT customer_email FROM completed_jobs WHERE job_id = $1', [jobId]);
  if (!jobs[0]) throw new NotFoundError(`Job ${jobId}`);
  const { rows } = await db.query(
    `INSERT INTO follow_ups (job_id, customer_email, subject, body, status, created_by)
     VALUES ($1, $2, $3, $4, 'draft', $5) RETURNING ${COLUMNS}`,
    [jobId, jobs[0].customer_email, subject, body, createdBy]
  );
  return rows[0];
}

async function rejectDraft(id, reviewedBy) {
  const current = await getFollowUp(id);
  if (!current) throw new NotFoundError(`Follow-up ${id}`);
  if (current.status !== 'draft') throw new InvalidTransitionError(id, current.status, 'rejected');
  const { rows } = await db.query(
    `UPDATE follow_ups SET status = 'rejected', reviewed_by = $2, reviewed_at = now()
      WHERE id = $1 AND status = 'draft' RETURNING ${COLUMNS}`,
    [id, reviewedBy]
  );
  if (!rows[0]) throw new InvalidTransitionError(id, 'changed concurrently', 'rejected');
  return rows[0];
}

// Human approval is the only path to a send. The status flips to 'approved' first (a durable record of the
// decision), then the email goes out, then 'sent' or 'failed'.
async function approveDraft(id, reviewedBy) {
  const current = await getFollowUp(id);
  if (!current) throw new NotFoundError(`Follow-up ${id}`);
  if (current.status !== 'draft') throw new InvalidTransitionError(id, current.status, 'approved');

  const { rows: approved } = await db.query(
    `UPDATE follow_ups SET status = 'approved', reviewed_by = $2, reviewed_at = now()
      WHERE id = $1 AND status = 'draft' RETURNING ${COLUMNS}`,
    [id, reviewedBy]
  );
  if (!approved[0]) throw new InvalidTransitionError(id, 'changed concurrently', 'approved');
  const fu = approved[0];

  try {
    const delivered = await sendFollowUpEmail({ followUpId: fu.id, jobId: fu.job_id, to: fu.customer_email, subject: fu.subject, body: fu.body });
    if (!delivered) return { ...fu, delivery: 'skipped: MAKE_FOLLOWUP_WEBHOOK_URL not configured' };
    const { rows } = await db.query(
      `UPDATE follow_ups SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = $1 RETURNING ${COLUMNS}`,
      [id]
    );
    return { ...rows[0], delivery: 'sent' };
  } catch (err) {
    const { rows } = await db.query(
      `UPDATE follow_ups SET status = 'failed', last_error = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, String(err.message).slice(0, 1000)]
    );
    return { ...rows[0], delivery: 'failed' };
  }
}

// Lets a human retry a failed send without re-approving.
async function retrySend(id, reviewedBy) {
  const current = await getFollowUp(id);
  if (!current) throw new NotFoundError(`Follow-up ${id}`);
  if (current.status !== 'failed' && current.status !== 'approved') {
    throw new InvalidTransitionError(id, current.status, 'sent');
  }
  await db.query(`UPDATE follow_ups SET status = 'draft', reviewed_by = NULL, reviewed_at = NULL WHERE id = $1`, [id]);
  return approveDraft(id, reviewedBy);
}

module.exports = { InvalidTransitionError, getFollowUp, listFollowUps, createDraft, approveDraft, rejectDraft, retrySend };
