// Job-completion pipeline with durable status per stage:
//   received -> summarized -> stored -> notified | notify_failed
// The row is inserted first so a duplicate job id fails *before* the paid LLM call, and a retry of a
// failed notification can be done without redoing earlier stages.
const jobs = require('./jobs');
const { summarizeNotes } = require('./summarize');
const { renderJobPdf } = require('./pdf');
const { sendSummaryEmail } = require('./notify');

const log = (jobId, msg) => console.log(`[job ${jobId}] ${msg}`);

async function processJob(input, photos = []) {
  const { jobId, customerEmail, techName, rawNotes, price } = input;

  // Stage 0: claim the job id.
  await jobs.createJob({ jobId, customerEmail, techName, rawNotes, price, photoCount: photos.length });
  log(jobId, `received from ${techName} (${photos.length} photos)`);

  try {
    // Stage 1: summarize.
    const summary = await summarizeNotes(rawNotes);
    await jobs.updateJob(jobId, { summary, status: 'summarized' });
    log(jobId, 'summarized');

    // Stage 2: render and store the PDF.
    const pdfBuffer = await renderJobPdf({ jobId, customerEmail, summary, price, techName });
    await jobs.updateJob(jobId, { pdf_data: pdfBuffer, status: 'stored' });
    log(jobId, `pdf stored (${pdfBuffer.length} bytes)`);

    // Stage 3: notify the customer via Make.com.
    const job = await notify(jobId, { techName, customerEmail, price, pdfBuffer, photos });
    return job;
  } catch (err) {
    // Stages 1-2 failing leaves the row in 'failed' with the reason recorded; the job id can be resubmitted
    // only after an operator deletes the row, which is deliberate: silent retries were the old bug.
    const current = await jobs.getJob(jobId);
    if (current && current.status !== 'notify_failed') {
      await jobs.updateJob(jobId, { status: 'failed', last_error: String(err.message).slice(0, 1000) });
    }
    throw err;
  }
}

async function notify(jobId, { techName, customerEmail, price, pdfBuffer, photos }) {
  try {
    const delivered = await sendSummaryEmail({ jobId, techName, customerEmail, price, pdfBuffer, photos });
    const job = await jobs.updateJob(jobId, {
      status: 'notified',
      summary_sent_at: delivered ? new Date() : null,
      last_error: delivered ? null : 'MAKE_WEBHOOK_URL not configured; email skipped',
    });
    log(jobId, delivered
      ? `posted to Make.com (HTTP ${delivered.status}, reply: ${JSON.stringify(delivered.reply)}). If the scenario did not run, check that it is switched ON in Make.`
      : 'Make.com not configured; marked notified without email');
    return job;
  } catch (err) {
    const job = await jobs.updateJob(jobId, { status: 'notify_failed', last_error: String(err.message).slice(0, 1000) });
    log(jobId, `notification failed: ${err.message}`);
    return job;
  }
}

// Re-sends the summary email for a job whose notification failed. Photos are not retained, so only the PDF goes.
async function retryNotify(jobId) {
  const job = await jobs.getJob(jobId);
  if (!job) throw new jobs.NotFoundError(`Job ${jobId}`);
  if (job.status !== 'notify_failed') {
    const err = new Error(`Job ${jobId} is '${job.status}', not 'notify_failed'`);
    err.status = 409;
    err.expose = true;
    throw err;
  }
  const pdfBuffer = await jobs.getJobPdf(jobId);
  return notify(jobId, { techName: job.tech_name, customerEmail: job.customer_email, price: job.price, pdfBuffer, photos: [] });
}

module.exports = { processJob, retryNotify };
