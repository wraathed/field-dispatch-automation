const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateJobSubmission, validateFollowUpDraft, validateDate, ValidationError } = require('../src/validate');

const good = { jobId: 'JOB-1043', techName: 'Mark', customerEmail: 'Cust@Example.com ', rawNotes: 'fixed the sink trap', jobPrice: '250' };

test('accepts a well-formed submission and normalizes it', () => {
  const v = validateJobSubmission(good);
  assert.deepEqual(v, { jobId: 'JOB-1043', techName: 'Mark', customerEmail: 'cust@example.com', rawNotes: 'fixed the sink trap', price: 250 });
});

test('rejects path-traversal style job ids', () => {
  for (const jobId of ['../etc', 'a b', '', 'x'.repeat(65), '-lead', 'id/with/slash']) {
    assert.throws(() => validateJobSubmission({ ...good, jobId }), ValidationError, `jobId ${JSON.stringify(jobId)}`);
  }
});

test('rejects bad prices and emails, reporting every error at once', () => {
  try {
    validateJobSubmission({ ...good, jobPrice: '-5', customerEmail: 'nope' });
    assert.fail('should throw');
  } catch (err) {
    assert.ok(err instanceof ValidationError);
    assert.equal(err.status, 400);
    assert.equal(err.errors.length, 2);
  }
});

test('rounds price to cents', () => {
  assert.equal(validateJobSubmission({ ...good, jobPrice: '19.999' }).price, 20);
});

test('follow-up drafts need a subject and body', () => {
  assert.throws(() => validateFollowUpDraft({ jobId: 'J1', subject: 'hi', body: 'short' }), ValidationError);
  const d = validateFollowUpDraft({ jobId: 'J1', subject: 'Checking in', body: 'Is everything still working well?' });
  assert.equal(d.createdBy, 'portal');
});

test('date validation', () => {
  assert.equal(validateDate(''), null);
  assert.equal(validateDate('2026-09-12'), '2026-09-12');
  assert.throws(() => validateDate('12/09/2026'), ValidationError);
});
