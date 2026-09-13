// Pure input validation. No I/O, so it is trivially unit-testable and shared by the API and the MCP server.

const JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

class ValidationError extends Error {
  constructor(errors) {
    super(`Validation failed: ${errors.join('; ')}`);
    this.name = 'ValidationError';
    this.status = 400;
    this.expose = true;
    this.errors = errors;
  }
}

function str(v) {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

function validateJobId(raw, errors) {
  const jobId = str(raw);
  if (!JOB_ID_RE.test(jobId)) errors.push('jobId must be 1-64 letters, digits, _ or - (no spaces or slashes)');
  return jobId;
}

function validateEmail(raw, errors, field = 'customerEmail') {
  const email = str(raw).toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) errors.push(`${field} must be a valid email address`);
  return email;
}

function validateJobSubmission(body = {}) {
  const errors = [];
  const jobId = validateJobId(body.jobId, errors);
  const customerEmail = validateEmail(body.customerEmail, errors);

  const techName = str(body.techName);
  if (techName.length < 1 || techName.length > 120) errors.push('techName is required (1-120 characters)');

  const rawNotes = str(body.rawNotes);
  if (rawNotes.length < 5 || rawNotes.length > 5000) errors.push('rawNotes must be 5-5000 characters');

  const priceNum = Number(str(body.jobPrice));
  if (!Number.isFinite(priceNum) || priceNum <= 0 || priceNum > 1_000_000) {
    errors.push('jobPrice must be a number between 0 and 1,000,000');
  }
  const price = Math.round(priceNum * 100) / 100;

  if (errors.length) throw new ValidationError(errors);
  return { jobId, customerEmail, techName, rawNotes, price };
}

function validateFollowUpDraft(body = {}) {
  const errors = [];
  const jobId = validateJobId(body.jobId, errors);
  const subject = str(body.subject);
  if (subject.length < 3 || subject.length > 200) errors.push('subject must be 3-200 characters');
  const text = str(body.body);
  if (text.length < 10 || text.length > 5000) errors.push('body must be 10-5000 characters');
  const createdBy = str(body.createdBy) || 'portal';
  if (createdBy.length > 120) errors.push('createdBy must be at most 120 characters');
  if (errors.length) throw new ValidationError(errors);
  return { jobId, subject, body: text, createdBy };
}

function validateDate(raw) {
  if (raw == null || raw === '') return null;
  const s = str(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new ValidationError(['date must be YYYY-MM-DD']);
  }
  return s;
}

module.exports = { ValidationError, validateJobSubmission, validateFollowUpDraft, validateJobId, validateEmail, validateDate };
