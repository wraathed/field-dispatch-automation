// Seeds demo customers/jobs/follow-ups. Never touches rows whose job_id does not start with DEMO-.
//   npm run db:seed            adds demo rows (skips ones that already exist)
//   npm run db:seed -- --reset deletes DEMO-* rows first
require('dotenv').config({ quiet: true });
const { createPool, describeTarget } = require('../src/db');
const { renderJobPdf } = require('../src/pdf');

const CUSTOMERS = [
  { email: 'maria.lopez@example.com', name: 'Maria Lopez' },
  { email: 'james.carter@example.com', name: 'James Carter' },
  { email: 'priya.natarajan@example.com', name: 'Priya Natarajan' },
  { email: 'dwayne.hill@example.com', name: 'Dwayne Hill' },
  { email: 'susan.oconnell@example.com', name: 'Susan O\'Connell' },
  { email: 'kenji.watanabe@example.com', name: 'Kenji Watanabe' },
];
const TECHS = ['Mark Ellison', 'Tanya Ruiz', 'Owen Blake'];

// daysAgo drives created_at so "today" / "this week" queries have data at every horizon.
const JOBS = [
  { id: 'DEMO-1001', c: 0, t: 0, daysAgo: 0, price: 275, notes: 'replaced kitchen faucet cartridge. no more drip. checked supply lines ok.', followUp: null },
  { id: 'DEMO-1002', c: 1, t: 1, daysAgo: 0, price: 1450, notes: 'water heater 40gal swap. old unit leaking at base. new unit installed, tested, permit sticker on.', followUp: null },
  { id: 'DEMO-1003', c: 2, t: 2, daysAgo: 1, price: 180, notes: 'cleared main line clog w/ auger. roots suspected. recommend camera inspection.', followUp: 'draft' },
  { id: 'DEMO-1004', c: 3, t: 0, daysAgo: 2, price: 620, notes: 'ac not cooling. capacitor blown, replaced. cleaned condenser coil. 20 deg split now.', followUp: 'sent' },
  { id: 'DEMO-1005', c: 0, t: 1, daysAgo: 3, price: 95, notes: 'garbage disposal jammed, freed w/ wrench, reset. works.', followUp: 'sent' },
  { id: 'DEMO-1006', c: 4, t: 2, daysAgo: 4, price: 340, notes: 'toilet running. replaced fill valve + flapper. shutoff valve stiff, told cust.', followUp: null },
  { id: 'DEMO-1007', c: 5, t: 0, daysAgo: 5, price: 2200, notes: 'furnace ignitor + control board replaced. cycled 3x ok. filter changed.', followUp: 'sent' },
  { id: 'DEMO-1008', c: 1, t: 1, daysAgo: 6, price: 150, notes: 'annual plumbing inspection. minor corrosion on hose bib, no action.', followUp: null },
  { id: 'DEMO-1009', c: 2, t: 2, daysAgo: 9, price: 410, notes: 'sump pump failed. installed 1/3hp replacement, tested float.', followUp: 'sent' },
  { id: 'DEMO-1010', c: 3, t: 0, daysAgo: 12, price: 88, notes: 'outdoor spigot leak. replaced washer + packing nut.', followUp: null },
  { id: 'DEMO-1011', c: 4, t: 1, daysAgo: 15, price: 560, notes: 'shower valve rebuild, moen. new cartridge, trim reinstalled.', followUp: 'sent' },
  { id: 'DEMO-1012', c: 5, t: 2, daysAgo: 20, price: 1900, notes: 'repipe under slab bathroom. 2 days. all pressure tested.', followUp: 'sent' },
];

function firstName(customer) {
  return customer.name.split(' ')[0];
}

function summaryFor(job) {
  const customer = CUSTOMERS[job.c];
  const work = job.notes.replace(/\.\s*$/, '');
  return `Dear ${firstName(customer)},\n\nThank you for choosing us for your recent service visit. ${TECHS[job.t]} completed the following work: ${work}. Everything was tested before leaving and is working as expected.\n\nIf you have any questions about the work performed, please reply to this email or call our office.`;
}

async function main() {
  const pool = createPool();
  const reset = process.argv.includes('--reset');
  console.log(`Seeding demo data into ${describeTarget()} ...`);
  try {
    if (reset) {
      const { rowCount } = await pool.query(`DELETE FROM completed_jobs WHERE job_id LIKE 'DEMO-%'`);
      console.log(`Removed ${rowCount} existing DEMO-* jobs (follow-ups cascade).`);
    }
    let jobsInserted = 0;
    let followUpsInserted = 0;
    for (const job of JOBS) {
      const customer = CUSTOMERS[job.c];
      const summary = summaryFor(job);
      const pdf = await renderJobPdf({ jobId: job.id, customerEmail: customer.email, summary, price: job.price });
      const { rowCount } = await pool.query(
        `INSERT INTO completed_jobs
           (job_id, customer_email, tech_name, raw_notes, summary, price, status, pdf_data, photo_count,
            created_at, updated_at, summary_sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'notified', $7, $8,
                 now() - ($9 || ' days')::interval - interval '3 hours',
                 now() - ($9 || ' days')::interval - interval '3 hours',
                 now() - ($9 || ' days')::interval - interval '2 hours 55 minutes')
         ON CONFLICT (job_id) DO NOTHING`,
        [job.id, customer.email, TECHS[job.t], job.notes, summary, job.price, pdf, 2, String(job.daysAgo)]
      );
      if (!rowCount) continue;
      jobsInserted++;
      if (job.followUp) {
        const sent = job.followUp === 'sent';
        const reviewedAt = sent ? new Date(Date.now() - (job.daysAgo - 1) * 864e5) : null;
        await pool.query(
          `INSERT INTO follow_ups
             (job_id, customer_email, subject, body, status, created_by, created_at, reviewed_by, reviewed_at, sent_at)
           VALUES ($1, $2, $3, $4, $5, $6,
                   now() - ($7 || ' days')::interval + interval '1 day',
                   $8, $9, $10)`,
          [
            job.id,
            customer.email,
            `How is everything after your ${job.id} service?`,
            `Hi ${firstName(customer)},\n\nJust checking in after ${TECHS[job.t]}'s visit. Is everything still working as expected? If anything seems off, reply here and we'll get someone back out.\n\nThanks again for your business.`,
            sent ? 'sent' : 'draft',
            sent ? 'office@example.com' : 'mcp-agent',
            String(job.daysAgo),
            sent ? 'office@example.com' : null,
            reviewedAt,
            reviewedAt,
          ]
        );
        followUpsInserted++;
      }
    }
    console.log(`Inserted ${jobsInserted} jobs and ${followUpsInserted} follow-ups (${JOBS.length - jobsInserted} already present).`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error('Seed failed:', err.message); process.exit(1); });
