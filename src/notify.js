// Outbound integrations (Make.com webhooks). Every function here is a network side effect.
const axios = require('axios');
const FormData = require('form-data');
const config = require('./config');

const HTTP_TIMEOUT = 20_000;

// Sends the summary PDF + photos to the Make.com scenario that emails the customer.
// Returns false (and does nothing) when MAKE_WEBHOOK_URL is not configured.
async function sendSummaryEmail({ jobId, techName, customerEmail, price, pdfBuffer, photos = [] }) {
  if (!config.makeWebhookUrl) return false;
  const form = new FormData();
  form.append('jobId', jobId);
  form.append('techName', techName);
  form.append('customerEmail', customerEmail);
  form.append('jobPrice', String(price));
  form.append('pdfDocument', pdfBuffer, { filename: `Job_${jobId}_Summary.pdf`, contentType: 'application/pdf' });
  photos.forEach((photo, i) => {
    form.append(`photo_${i}`, photo.buffer, { filename: photo.originalname || `photo_${i}`, contentType: photo.mimetype });
  });
  await axios.post(config.makeWebhookUrl, form, {
    headers: form.getHeaders(),
    timeout: HTTP_TIMEOUT,
    maxBodyLength: Infinity,
  });
  return true;
}

// Sends an approved follow-up email via a second Make.com scenario (plain JSON).
async function sendFollowUpEmail({ followUpId, jobId, to, subject, body }) {
  if (!config.makeFollowUpWebhookUrl) return false;
  await axios.post(
    config.makeFollowUpWebhookUrl,
    { followUpId, jobId, to, subject, body },
    { timeout: HTTP_TIMEOUT }
  );
  return true;
}

module.exports = { sendSummaryEmail, sendFollowUpEmail };
