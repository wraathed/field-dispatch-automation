const { api, el, fmtDate, money, initAccessBox } = window.portal;

initAccessBox();

const statusEl = document.getElementById('status');
const setStatus = (msg, cls = '') => { statusEl.className = cls; statusEl.textContent = msg; };

async function load() {
    setStatus('Loading...');
    try {
        const [drafts, missing, jobs, history] = await Promise.all([
            api('/api/follow-ups?status=draft'),
            api('/api/customers/without-follow-up?days=7'),
            api('/api/jobs?limit=25'),
            api('/api/follow-ups'),
        ]);
        renderDrafts(drafts.follow_ups);
        renderMissing(missing.customers);
        renderJobs(jobs.jobs);
        renderHistory(history.follow_ups.filter((f) => f.status !== 'draft'));
        setStatus(`Updated ${new Date().toLocaleTimeString()}`, 'muted');
    } catch (err) {
        setStatus(err.status === 401 ? 'Invalid portal key. Open "Portal access" and enter the key.' : `Error: ${err.message}`, 'err');
    }
}

function renderDrafts(list) {
    document.getElementById('draftCount').textContent = list.length;
    const root = document.getElementById('drafts');
    root.replaceChildren(...(list.length ? list.map(draftCard) : [el('p', { class: 'muted', text: 'No drafts waiting.' })]));
}

function draftCard(fu) {
    const card = el('article', { class: 'card' });
    card.append(
        el('div', { class: 'card-head' }, [
            el('strong', { text: fu.subject }),
            el('span', { class: 'muted', text: `to ${fu.customer_email} - job ${fu.job_id} - drafted by ${fu.created_by} ${fmtDate(fu.created_at)}` }),
        ]),
        el('pre', { class: 'summary', text: fu.body }),
        el('div', { class: 'actions' }, [
            el('button', { type: 'button', onclick: () => act(`/api/follow-ups/${fu.id}/approve`, card, 'Approving...') }, 'Approve & send'),
            el('button', { type: 'button', class: 'danger', onclick: () => act(`/api/follow-ups/${fu.id}/reject`, card, 'Rejecting...') }, 'Reject'),
        ]),
    );
    return card;
}

async function act(path, card, label) {
    card.querySelectorAll('button').forEach((b) => (b.disabled = true));
    setStatus(label);
    try {
        const { follow_up } = await api(path, { method: 'POST' });
        setStatus(follow_up.delivery ? `Follow-up #${follow_up.id}: ${follow_up.delivery}` : `Follow-up #${follow_up.id} ${follow_up.status}`, 'ok');
        await load();
    } catch (err) {
        setStatus(`Error: ${err.message}`, 'err');
        card.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
}

function renderMissing(list) {
    document.getElementById('missingCount').textContent = list.length;
    const root = document.getElementById('missing');
    root.replaceChildren(...(list.length ? list.map((c) => el('div', { class: 'row' }, [
        el('span', { text: `${c.customer_email}` }),
        el('span', { class: 'muted', text: `job ${c.job_id} - ${c.tech_name || ''} - ${money(c.price)} - ${fmtDate(c.created_at)}` }),
        el('span', { class: c.pending_drafts ? 'pill' : 'pill warn', text: c.pending_drafts ? `${c.pending_drafts} draft pending` : 'no draft yet' }),
    ])) : [el('p', { class: 'muted', text: 'Everyone from the last 7 days has been followed up with.' })]));
}

function renderJobs(list) {
    const tbody = document.querySelector('#jobsTable tbody');
    tbody.replaceChildren(...list.map((j) => el('tr', {}, [
        el('td', { text: j.job_id }),
        el('td', { text: j.customer_email }),
        el('td', { text: j.tech_name || '' }),
        el('td', { text: money(j.price) }),
        el('td', {}, [el('span', { class: `pill status-${j.status}`, text: j.status })]),
        el('td', { text: fmtDate(j.created_at) }),
        el('td', {}, j.has_pdf ? [el('button', { type: 'button', class: 'link', onclick: () => openPdf(j.job_id) }, 'PDF')] : []),
    ])));
}

function renderHistory(list) {
    const root = document.getElementById('history');
    root.replaceChildren(...(list.length ? list.slice(0, 15).map((f) => el('div', { class: 'row' }, [
        el('span', { class: `pill status-${f.status}`, text: f.status }),
        el('span', { text: `${f.subject}` }),
        el('span', { class: 'muted', text: `${f.customer_email} - job ${f.job_id} - ${f.reviewed_by ? `reviewed by ${f.reviewed_by} ` : ''}${fmtDate(f.sent_at || f.reviewed_at || f.created_at)}${f.last_error ? ` - ${f.last_error}` : ''}` }),
    ])) : [el('p', { class: 'muted', text: 'No follow-up activity yet.' })]));
}

async function openPdf(jobId) {
    const blob = await api(`/api/jobs/${encodeURIComponent(jobId)}/pdf`);
    window.open(URL.createObjectURL(blob), '_blank');
}

document.getElementById('refreshBtn').addEventListener('click', load);
document.getElementById('portalKey').addEventListener('change', load);
load();
