const { api, el, money, initAccessBox } = window.portal;

initAccessBox();

// Suggest a fresh job id each load so repeat demo submissions do not collide with the UNIQUE(job_id) constraint.
const jobIdInput = document.getElementById('jobId');
if (!jobIdInput.value) jobIdInput.value = String(1000 + Math.floor(Math.random() * 9000));

document.getElementById('jobForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const statusDiv = document.getElementById('status');
    const resultDiv = document.getElementById('result');
    const btn = document.getElementById('submitBtn');
    resultDiv.replaceChildren();
    statusDiv.className = '';
    statusDiv.textContent = 'Processing job... (summarizing notes, generating PDF, notifying customer)';
    btn.disabled = true;

    const formData = new FormData();
    formData.append('jobId', jobIdInput.value.trim());
    formData.append('techName', document.getElementById('techName').value);
    formData.append('customerEmail', document.getElementById('customerEmail').value);
    formData.append('rawNotes', document.getElementById('rawNotes').value);
    formData.append('jobPrice', document.getElementById('jobPrice').value);
    for (const file of document.getElementById('jobPhotos').files) formData.append('photos', file);

    try {
        const { job } = await api('/webhook/job-complete', { method: 'POST', body: formData });
        const emailed = job.status === 'notified' && job.summary_sent_at;
        statusDiv.className = job.status === 'notified' ? 'ok' : 'warn';
        statusDiv.textContent = emailed
            ? `Success: job ${job.job_id} recorded, PDF stored, and customer emailed.`
            : job.status === 'notified'
                ? `Job ${job.job_id} recorded and PDF stored. Email skipped (Make.com not configured).`
                : `Job ${job.job_id} recorded but the customer email failed: ${job.last_error}`;
        resultDiv.append(
            el('h3', { text: 'Customer summary' }),
            el('pre', { class: 'summary', text: job.summary }),
            el('p', { class: 'muted', text: `Status: ${job.status} - Billed: ${money(job.price)}` }),
            el('button', { type: 'button', class: 'secondary', onclick: () => openPdf(job.job_id) }, 'Open PDF'),
        );
        jobIdInput.value = '';
    } catch (err) {
        statusDiv.className = 'err';
        statusDiv.textContent = err.status === 401 ? 'Invalid portal key. Open "Portal access" and enter the key.'
            : err.status === 409 ? `Job ${jobIdInput.value} already exists. Use a different job id.`
            : err.status === 503 ? `Server is not configured: ${err.message}`
            : `Error: ${err.message}`;
    } finally {
        btn.disabled = false;
    }
});

async function openPdf(jobId) {
    const blob = await api(`/api/jobs/${encodeURIComponent(jobId)}/pdf`);
    window.open(URL.createObjectURL(blob), '_blank');
}
