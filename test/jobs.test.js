// Integration tests for the data layer. Skipped when DATABASE_URL / NEON_DB_URL is not set.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const config = require('../src/config');

const hasDb = Boolean(config.databaseUrl);
const db = hasDb ? require('../src/db') : null;
const jobs = hasDb ? require('../src/jobs') : null;
const followups = hasDb ? require('../src/followups') : null;

const jobId = `TEST-${crypto.randomBytes(4).toString('hex')}`;
const email = `test-${jobId.toLowerCase()}@example.com`;

after(async () => {
  if (!hasDb) return;
  await db.query('DELETE FROM completed_jobs WHERE job_id = $1', [jobId]);
  await db.closePool();
});

test('createJob is the idempotency lock: second insert raises DuplicateJobError', { skip: !hasDb && 'no database configured' }, async () => {
  const job = await jobs.createJob({ jobId, customerEmail: email, techName: 'Test Tech', rawNotes: 'test notes', price: 12.5 });
  assert.equal(job.status, 'received');
  await assert.rejects(
    () => jobs.createJob({ jobId, customerEmail: email, techName: 'Test Tech', rawNotes: 'again', price: 1 }),
    (err) => err instanceof jobs.DuplicateJobError && err.status === 409
  );
});

test('status advances and the job shows up in today\'s list and the customer history', { skip: !hasDb && 'no database configured' }, async () => {
  await jobs.updateJob(jobId, { summary: 'Test summary', status: 'summarized' });
  await jobs.updateJob(jobId, { pdf_data: Buffer.from('%PDF-1.4 test'), status: 'stored' });
  const notified = await jobs.updateJob(jobId, { status: 'notified', summary_sent_at: new Date() });
  assert.equal(notified.status, 'notified');
  assert.equal(notified.has_pdf, true);

  const today = await jobs.listJobsCompletedOn();
  assert.ok(today.some((j) => j.job_id === jobId), 'job listed for today');

  const history = await jobs.getCustomerHistory(email.toUpperCase());
  assert.equal(history.total_jobs, 1);
  assert.equal(history.total_spend, 12.5);
});

test('follow-up workflow: draft -> approve (send skipped without Make URL) and missing-follow-up query', { skip: !hasDb && 'no database configured' }, async () => {
  let missing = await jobs.listCustomersWithoutFollowUp({ days: 1 });
  assert.ok(missing.some((c) => c.job_id === jobId), 'job needs a follow-up before drafting');

  const draft = await followups.createDraft({ jobId, subject: 'Checking in', body: 'Is everything still working well after our visit?', createdBy: 'test' });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.customer_email, email);

  missing = await jobs.listCustomersWithoutFollowUp({ days: 1 });
  assert.equal(missing.find((c) => c.job_id === jobId).pending_drafts, 1);

  await assert.rejects(() => followups.approveDraft(999999999, 'test'), jobs.NotFoundError);

  const approved = await followups.approveDraft(draft.id, 'test-reviewer');
  assert.equal(approved.reviewed_by, 'test-reviewer');
  assert.ok(['approved', 'sent'].includes(approved.status));

  await assert.rejects(() => followups.rejectDraft(draft.id, 'test'), followups.InvalidTransitionError);

  missing = await jobs.listCustomersWithoutFollowUp({ days: 1 });
  assert.ok(!missing.some((c) => c.job_id === jobId), 'approved follow-up removes the customer from the list');
});
