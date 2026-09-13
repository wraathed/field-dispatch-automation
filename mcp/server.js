#!/usr/bin/env node
// MCP server exposing the job system to agents (Claude Desktop, Claude Code, OpenClaw, ...).
// Transport: stdio. Database: the least-privilege MCP_DATABASE_URL role (SELECT everywhere, INSERT on follow_ups).
// Read tools answer questions; the single write tool only creates a *draft* that a human approves in the portal.
process.env.DB_PROFILE = 'mcp';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const config = require('../src/config');
const jobs = require('../src/jobs');
const followups = require('../src/followups');
const { validateFollowUpDraft, validateDate, ValidationError } = require('../src/validate');

// stdout is the protocol channel; all logging must go to stderr.
const log = (...args) => console.error('[mcp]', ...args);

const server = new McpServer({ name: 'field-dispatch', version: require('../package.json').version });

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (err) => ({ isError: true, content: [{ type: 'text', text: err.expose || err instanceof ValidationError ? err.message : `Tool failed: ${err.message}` }] });
const run = (fn) => async (args) => {
  try { return text(await fn(args)); } catch (err) { log(err.message); return fail(err); }
};

server.registerTool(
  'get_job',
  {
    title: 'Look up a job',
    description: 'Fetch one completed job by its job id, including the customer-facing summary, pipeline status, and any follow-ups.',
    inputSchema: { job_id: z.string().min(1).max(64).describe('Job id, e.g. DEMO-1003') },
    annotations: { readOnlyHint: true },
  },
  run(async ({ job_id }) => {
    const job = await jobs.getJob(job_id.trim());
    if (!job) return `No job with id ${job_id}`;
    return { job, follow_ups: await followups.listFollowUps({ jobId: job.job_id }), pdf_url: job.has_pdf ? `${config.appBaseUrl}/api/jobs/${job.job_id}/pdf` : null };
  })
);

server.registerTool(
  'get_customer_history',
  {
    title: 'Customer history',
    description: 'All completed jobs for a customer email, newest first, with total spend and follow-up counts per job.',
    inputSchema: { customer_email: z.string().email().describe('Customer email address') },
    annotations: { readOnlyHint: true },
  },
  run(({ customer_email }) => jobs.getCustomerHistory(customer_email))
);

server.registerTool(
  'list_completed_jobs',
  {
    title: 'Jobs completed on a date',
    description: `Jobs completed on a calendar date in the business timezone (${config.businessTimezone}). Omit date for today.`,
    inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD; defaults to today') },
    annotations: { readOnlyHint: true },
  },
  run(async ({ date }) => {
    const rows = await jobs.listJobsCompletedOn(validateDate(date));
    return { date: date || 'today', timezone: config.businessTimezone, count: rows.length, jobs: rows };
  })
);

server.registerTool(
  'list_customers_without_follow_up',
  {
    title: 'Customers missing a follow-up',
    description: 'Customers whose job completed in the last N days (default 7) and who have not been sent a follow-up email for that job. Includes how many drafts are already waiting for approval so you do not draft twice.',
    inputSchema: { days: z.number().int().min(1).max(365).optional().describe('Look-back window in days (default 7)') },
    annotations: { readOnlyHint: true },
  },
  run(async ({ days }) => {
    const rows = await jobs.listCustomersWithoutFollowUp({ days: days || 7 });
    return { days: days || 7, count: rows.length, customers: rows };
  })
);

server.registerTool(
  'list_follow_ups',
  {
    title: 'List follow-ups',
    description: 'Follow-up emails by status: draft (awaiting human approval), approved, sent, rejected, failed.',
    inputSchema: { status: z.enum(['draft', 'approved', 'sent', 'rejected', 'failed']).optional() },
    annotations: { readOnlyHint: true },
  },
  run(async ({ status }) => ({ follow_ups: await followups.listFollowUps({ status: status || null }) }))
);

server.registerTool(
  'draft_follow_up',
  {
    title: 'Draft a follow-up email',
    description: 'Create a follow-up email DRAFT for a job. Nothing is sent: a person reviews the draft in the portal and approves or rejects it. Check list_customers_without_follow_up first to avoid drafting for a job that already has one pending.',
    inputSchema: {
      job_id: z.string().min(1).max(64),
      subject: z.string().min(3).max(200),
      body: z.string().min(10).max(5000).describe('Plain-text email body addressed to the customer'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  run(async ({ job_id, subject, body }) => {
    const draft = validateFollowUpDraft({ jobId: job_id, subject, body, createdBy: 'mcp-agent' });
    const fu = await followups.createDraft(draft);
    return {
      message: `Draft #${fu.id} created for job ${fu.job_id}. It will not be sent until a person approves it.`,
      review_url: `${config.appBaseUrl}/review.html`,
      follow_up: fu,
    };
  })
);

async function main() {
  if (!config.mcpDatabaseUrl) {
    log('MCP_DATABASE_URL is not set. Run: npm run db:role -- --write-env');
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`ready (db user: ${new URL(config.mcpDatabaseUrl).username}, tz: ${config.businessTimezone})`);
}

main().catch((err) => { log('fatal:', err); process.exit(1); });
