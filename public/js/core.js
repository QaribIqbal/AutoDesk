export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { ...opts, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.startsWith('/auth')) window.dispatchEvent(new Event('auth-required'));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

export const money = n => '$' + Math.round(n || 0).toLocaleString('en-US');
export const pct = n => ((n || 0) * 100).toFixed(1) + '%';
export const when = iso => { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
export const day = iso => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const debounce = (f, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
export function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago';
}
export const hourLabel = h => (h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`);

/** SMS credit count: GSM-7 = 160/153 chars per credit, anything else (emoji, —, curly quotes) = 70/67. */
const GSM = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅå_ÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;
export function smsCredits(text) {
  const unicode = !GSM.test(text), len = [...text].length, one = unicode ? 70 : 160, many = unicode ? 67 : 153;
  return { len, unicode, credits: len === 0 ? 0 : len <= one ? 1 : Math.ceil(len / many) };
}

// ---------- modal & toast ----------
export function modal(html, { wide = false } = {}) {
  const m = $('#modal');
  m.innerHTML = `<div class="dialog ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  m.classList.remove('hidden');
  m.onclick = e => { if (e.target === m) closeModal(); };
  document.onkeydown = e => { if (e.key === 'Escape') closeModal(); };
  setTimeout(() => $('input,textarea,select', m)?.focus(), 30);
  return m;
}
export const closeModal = () => { $('#modal').classList.add('hidden'); document.onkeydown = null; };
export function confirmBox(title, text, okLabel = 'Yes, continue', danger = false) {
  return new Promise(resolve => {
    modal(`<h3>${title}</h3><p class="sub">${text}</p><div class="foot"><button class="btn" id="cb_no">Cancel</button><button class="btn ${danger ? 'danger-solid' : 'primary'}" id="cb_yes">${okLabel}</button></div>`);
    $('#cb_no').onclick = () => { closeModal(); resolve(false); };
    $('#cb_yes').onclick = () => { closeModal(); resolve(true); };
  });
}
export function toast(msg, tone = 'ok') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.append(box); }
  const t = document.createElement('div'); t.className = `toast ${tone}`; t.textContent = msg; box.append(t);
  setTimeout(() => t.classList.add('out'), 3200); setTimeout(() => t.remove(), 3700);
}
export async function copy(text) { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }

// ---------- icons ----------
const ICONS = {
  overview: '<path d="M4 13a8 8 0 0 1 16 0"/><path d="M12 13l4-4"/><circle cx="12" cy="13" r="1.3"/><path d="M4 19h16"/>',
  sms: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  voice: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  patients: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  invoice: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7z"/>',
};
export const icon = (name, size = 18) => `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// ---------- CSV ----------
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}
