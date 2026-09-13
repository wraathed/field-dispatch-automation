// Shared helpers for the portal pages: portal key storage, authenticated fetch, small DOM utilities.
(function () {
  const KEY = 'fd.portalKey';
  const REVIEWER = 'fd.reviewer';

  function getKey() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } }
  function setKey(v) { try { localStorage.setItem(KEY, v); } catch { /* ignore */ } }
  function getReviewer() { try { return localStorage.getItem(REVIEWER) || ''; } catch { return ''; } }
  function setReviewer(v) { try { localStorage.setItem(REVIEWER, v); } catch { /* ignore */ } }

  async function api(path, { method = 'GET', body, headers = {} } = {}) {
    const h = { 'x-portal-key': getKey(), ...headers };
    const reviewer = getReviewer();
    if (reviewer) h['x-reviewer'] = reviewer;
    if (body && !(body instanceof FormData)) {
      h['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const res = await fetch(path, { method, headers: h, body });
    const type = res.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await res.json() : await res.blob();
    if (!res.ok) {
      const msg = data && data.error ? data.error : `HTTP ${res.status}`;
      const err = new Error(data && data.details ? `${msg}: ${data.details.join('; ')}` : msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) node.append(c);
    return node;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function money(n) { return '$' + Number(n).toFixed(2); }

  // Wires the shared "Portal access" box present on every page.
  function initAccessBox() {
    const keyInput = document.getElementById('portalKey');
    const reviewerInput = document.getElementById('reviewerName');
    if (keyInput) {
      keyInput.value = getKey();
      keyInput.addEventListener('change', () => setKey(keyInput.value.trim()));
    }
    if (reviewerInput) {
      reviewerInput.value = getReviewer();
      reviewerInput.addEventListener('change', () => setReviewer(reviewerInput.value.trim()));
    }
  }

  window.portal = { api, el, fmtDate, money, getKey, initAccessBox };
})();
