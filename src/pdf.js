// Renders the customer-facing service summary to an in-memory PDF buffer.
// No filesystem writes, so it works on Vercel's read-only serverless filesystem.
const PDFDocument = require('pdfkit');

function renderJobPdf({ jobId, customerEmail, summary, price, techName }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, info: { Title: `Job ${jobId} Service Summary` } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).text('Official Service Summary', { align: 'center', underline: true });
    doc.moveDown();
    doc.fontSize(14).text(`Job ID: #${jobId}`);
    doc.text(`Customer Email: ${customerEmail}`);
    if (techName) doc.text(`Technician: ${techName}`);
    doc.text(`Total Billed: $${Number(price).toFixed(2)}`);
    doc.moveDown();
    doc.fontSize(12).text('Work Performed:', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).text(summary, { align: 'left', lineGap: 4 });
    doc.end();
  });
}

module.exports = { renderJobPdf };
