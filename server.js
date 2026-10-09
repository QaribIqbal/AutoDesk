// Clinic Automation CRM — zero-dependency server (Node 22.5+). Run: npm start
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { db, getSettings, saveSettings, setInternal } from './lib/db.js';
import * as L from './lib/logic.js';
import * as A from './lib/auth.js';
import { buildWorkflow, webhookPaths } from './lib/workflow.js';
import { seed, clearSeed } from './lib/seed.js';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(import.meta.dirname, 'public');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const SENT = Symbol('sent');
const send = (res, code, data, headers = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
  return SENT;
};
const asArray = b => (Array.isArray(b) ? b : Array.isArray(b?.items) ? b.items : [b]);
const origin = req => `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
const crmUrl = (s, req) => s.public_url || origin(req);
const webhookUrls = s => s.n8n_base_url
  ? Object.fromEntries(Object.entries(webhookPaths(s.install_id)).map(([k, p]) => [k, `${s.n8n_base_url.replace(/\/$/, '')}/webhook/${p}`])) : null;

// ---------- router ----------
// auth: 'public' | 'session' | 'any' (session or API key) | 'n8n' (API key or session; key use is recorded as a sync heartbeat)
const routes = [];
const on = (method, pattern, auth, fn) => routes.push({ method, auth, fn, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$') });

// ----- auth -----
on('GET', '/api/status', 'public', ({ req }) => {
  const s = getSettings();
  return { setup_complete: s.setup_complete && s.has_password, logged_in: A.isLoggedIn(req), clinic_name: s.clinic_name };
});
on('POST', '/api/auth/setup', 'public', ({ req, res, body }) => {
  if (getSettings().has_password) fail(403, 'This clinic is already set up. Please log in.');
  if (String(body.password || '').length < 8) fail(400, 'Password must be at least 8 characters.');
  saveSettings(body.settings || {});
  A.setPassword(body.password); setInternal('setup_complete', '1');
  return send(res, 200, { ok: true }, { 'Set-Cookie': A.sessionCookie(A.createSession(), req) });
});
on('POST', '/api/auth/login', 'public', ({ req, res, body, ip }) => {
  if (A.throttled(ip)) fail(429, 'Too many attempts. Try again in 15 minutes.');
  if (!A.verifyPassword(body.password, getSettings({ secrets: true }).password_hash)) { A.noteFailure(ip); fail(401, 'That password is not right.'); }
  A.clearFailures(ip);
  return send(res, 200, { ok: true }, { 'Set-Cookie': A.sessionCookie(A.createSession(), req) });
});
on('POST', '/api/auth/logout', 'public', ({ req, res }) => {
  A.destroySession(A.cookies(req).sid);
  return send(res, 200, { ok: true }, { 'Set-Cookie': A.sessionCookie(null, req) });
});
on('POST', '/api/auth/password', 'session', ({ req, res, body }) => {
  if (!A.verifyPassword(body.current, getSettings({ secrets: true }).password_hash)) fail(401, 'Your current password is not right.');
  if (String(body.next || '').length < 8) fail(400, 'New password must be at least 8 characters.');
  A.setPassword(body.next); A.destroyAllSessions();
  return send(res, 200, { ok: true }, { 'Set-Cookie': A.sessionCookie(A.createSession(), req) });
});

// ----- dashboard -----
on('GET', '/api/summary', 'session', ({ q }) => L.summary(Number(q.days) || 0));
on('GET', '/api/inbox', 'session', () => L.inbox());
on('GET', '/api/settings', 'session', () => getSettings());
on('PUT', '/api/settings', 'session', ({ body }) => { saveSettings(body); return getSettings(); });

// ----- patients -----
on('GET', '/api/patients', 'session', ({ q }) => {
  const where = [], p = [];
  if (q.search) { where.push('(name LIKE ? OR phone LIKE ? OR email LIKE ?)'); p.push(...Array(3).fill(`%${q.search}%`)); }
  if (q.filter === 'eligible') where.push('consent=1 AND opted_out=0');
  if (q.filter === 'opted_out') where.push('opted_out=1');
  if (q.filter === 'no_consent') where.push('consent=0');
  const rows = db.prepare(`SELECT p.*, (SELECT MAX(sent_at) FROM sms WHERE sms.phone=p.phone) last_contacted,
    (SELECT MAX(appointment_booked) FROM sms WHERE sms.phone=p.phone) booked FROM patients p
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY name COLLATE NOCASE LIMIT 1000`).all(...p);
  const counts = db.prepare(`SELECT COUNT(*) total, COALESCE(SUM(consent=1 AND opted_out=0),0) eligible,
    COALESCE(SUM(opted_out=1),0) opted_out, COALESCE(SUM(consent=0),0) no_consent FROM patients`).get();
  return { rows, counts };
});
on('POST', '/api/patients', 'any', ({ body }) => {
  const r = L.upsertPatient(body); if (!r) fail(400, 'A phone number is required.'); return r;
});
on('POST', '/api/patients/import', 'session', ({ body }) => {
  let added = 0, updated = 0, skipped = 0;
  db.exec('BEGIN');
  try { for (const row of asArray(body.rows || [])) { const r = L.upsertPatient(row, 'import'); if (!r) skipped++; else if (r.created) added++; else updated++; } db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  return { added, updated, skipped };
});
on('PATCH', '/api/patients/:id', 'session', ({ params, body }) => ({ updated: L.patch('patients', +params.id, body, L.PATIENT_FIELDS) }));
on('DELETE', '/api/patients/:id', 'session', ({ params }) => ({ deleted: Number(db.prepare('DELETE FROM patients WHERE id=?').run(+params.id).changes) }));

// ----- campaigns -----
on('GET', '/api/campaigns', 'session', () => L.campaignsWithStats());
on('POST', '/api/campaigns/preview', 'session', ({ body }) => {
  const s = getSettings(), list = L.eligiblePatients(Number(body.min_months) || 0);
  const p = list[0] || { name: 'Sarah Mitchell', phone: '+61412345678', last_visit: new Date(Date.now() - 300 * 864e5).toISOString().slice(0, 10) };
  return { count: list.length, sample: { name: p.name, message: L.render(body.template || s.tpl_reactivation, L.ctxFor(p, s)) } };
});
on('POST', '/api/campaigns', 'session', ({ body }) => {
  if (!String(body.name || '').trim()) fail(400, 'Give the campaign a name.');
  const id = Number(db.prepare('INSERT INTO campaigns(name,template,min_months,created_at) VALUES(?,?,?,?)')
    .run(body.name.trim(), body.template || getSettings().tpl_reactivation, Number(body.min_months) || 0, L.now()).lastInsertRowid);
  return { id };
});
on('DELETE', '/api/campaigns/:id', 'session', ({ params }) => {
  const c = db.prepare('SELECT * FROM campaigns WHERE id=?').get(+params.id) || fail(404, 'Campaign not found.');
  if (c.status !== 'draft' && c.source !== 'seed') fail(400, 'Sent campaigns are kept for your records.');
  db.prepare('DELETE FROM campaigns WHERE id=?').run(c.id); return { deleted: 1 };
});
on('POST', '/api/campaigns/:id/launch', 'session', async ({ params }) => {
  const s = getSettings(), c = db.prepare('SELECT * FROM campaigns WHERE id=?').get(+params.id) || fail(404, 'Campaign not found.');
  if (!s.reactivation_enabled) fail(400, 'Win-back campaigns are switched off. Turn them on in Automations.');
  const recipients = L.recipientsFor(c, s);
  if (!recipients.length) fail(400, 'No patients match this campaign (everyone eligible has already been messaged).');
  const hooks = webhookUrls(s);
  if (hooks) {
    try {
      const r = await fetch(hooks.launch, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaign_id: c.id }), signal: AbortSignal.timeout(10000) });
      if (!r.ok) fail(502, r.status === 404 ? 'n8n answered, but the engine workflow is not active. Activate it in n8n.' : `n8n returned an error (${r.status}).`);
    } catch (e) { if (e instanceof HttpError) throw e; fail(502, `Couldn't reach n8n: ${e.message}`); }
    db.prepare("UPDATE campaigns SET status='sending', launched_at=? WHERE id=?").run(L.now(), c.id);
    return { mode: 'n8n', queued: recipients.length };
  }
  if (!s.demo_mode) fail(400, 'Connect n8n first (Settings → Connect) to send real messages.');
  // Test mode without n8n: record what would have been sent, so the clinic can try the whole flow.
  for (const r of recipients) L.insertSms({ ...r, status: 'demo_sent', campaign: c.name, campaign_id: c.id }, 'demo');
  db.prepare("UPDATE campaigns SET status='sent', launched_at=?, recipients=? WHERE id=?").run(L.now(), recipients.length, c.id);
  return { mode: 'test', sent: recipients.length };
});

// ----- message + call logs -----
const list = (table, dateCol, q, searchCols, filters) => {
  const where = [], p = [];
  if (q.search) { where.push('(' + searchCols.map(c => `${c} LIKE ?`).join(' OR ') + ')'); searchCols.forEach(() => p.push(`%${q.search}%`)); }
  for (const [k, sql] of Object.entries(filters)) if (q[k]) { where.push(sql); if (sql.includes('?')) p.push(q[k]); }
  return db.prepare(`SELECT * FROM ${table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${dateCol} DESC LIMIT ${Math.min(Number(q.limit) || 500, 2000)}`).all(...p);
};
on('GET', '/api/sms', 'session', ({ q }) => list('sms', 'sent_at', q, ['name', 'phone', 'message'],
  { replied: 'replied=1', booked: 'appointment_booked=1', opted_out: 'opted_out=1', campaign_id: 'campaign_id=?' }));
on('POST', '/api/sms', 'n8n', ({ body }) => { const ids = asArray(body).map(r => L.insertSms(r)); return { inserted: ids.length, ids }; });
on('PATCH', '/api/sms/:id', 'session', ({ params, body }) => ({ updated: L.patch('sms', +params.id, body, L.SMS_FIELDS) }));
on('DELETE', '/api/sms/:id', 'session', ({ params }) => ({ deleted: Number(db.prepare('DELETE FROM sms WHERE id=?').run(+params.id).changes) }));
on('GET', '/api/calls', 'session', ({ q }) => list('calls', 'created_at', q, ['caller_name', 'caller_number', 'caller_email', 'summary'],
  { type: 'call_type=?', recovered: 'recovered=1', booked: 'appointment_booked=1' }));
on('POST', '/api/calls', 'n8n', ({ body }) => { const ids = asArray(body).map(r => L.insertCall(r)); return { inserted: ids.length, ids }; });
on('PATCH', '/api/calls/:id', 'session', ({ params, body }) => ({ updated: L.patch('calls', +params.id, body, L.CALL_FIELDS) }));
on('DELETE', '/api/calls/:id', 'session', ({ params }) => ({ deleted: Number(db.prepare('DELETE FROM calls WHERE id=?').run(+params.id).changes) }));
// Earlier integrations (paste-in nodes) still post here.
on('POST', '/api/sms/reply', 'n8n', ({ body }) => L.handleReply(body.phone, String(body.reply_text ?? body.body ?? '')));
on('POST', '/api/sms/update-by-phone', 'n8n', ({ body }) => L.handleBooking({ ...body, kind: 'sms' }) || fail(404, 'No message to that number.'));
on('POST', '/api/calls/update-by-number', 'n8n', ({ body }) => L.handleBooking({ ...body, kind: 'call' }) || fail(404, 'No call from that number.'));

// ----- n8n engine endpoints -----
on('GET', '/api/n8n/campaigns/:id/recipients', 'n8n', ({ params }) => {
  const s = getSettings(), c = db.prepare('SELECT * FROM campaigns WHERE id=?').get(+params.id) || fail(404, 'Campaign not found.');
  const recipients = s.reactivation_enabled ? L.recipientsFor(c, s) : [];
  db.prepare("UPDATE campaigns SET status='sent', launched_at=COALESCE(launched_at,?), recipients=recipients+? WHERE id=?").run(L.now(), recipients.length, c.id);
  return { campaign: { id: c.id, name: c.name }, demo_mode: s.demo_mode, sms_from: L.normPhone(s.sms_from, s.timezone), recipients };
});
on('POST', '/api/n8n/missed-call', 'n8n', ({ body }) => L.handleMissedCall(body));
on('POST', '/api/n8n/calls/:id/followup', 'n8n', ({ params, body }) => {
  const failed = body.status === 'failed';
  return { updated: L.patch('calls', +params.id, { status: body.status || 'sent', ...(failed ? { handled_by: 'none' } : {}) }, L.CALL_FIELDS) };
});
on('POST', '/api/n8n/sms-reply', 'n8n', ({ body }) => L.handleReply(body.from || body.From, String(body.body ?? body.Body ?? '')));
on('POST', '/api/n8n/voice-call', 'n8n', ({ body }) => ({ id: L.handleVoiceCall(body) }));
on('POST', '/api/n8n/booking', 'n8n', ({ body }) => L.handleBooking(body) || fail(404, 'No message or call found for that number.'));
on('POST', '/api/n8n/ping', 'n8n', () => ({ ok: true }));

// ----- integrations -----
on('GET', '/api/integrations', 'session', ({ req }) => {
  const s = getSettings({ secrets: true });
  return { crm_url: crmUrl(s, req), n8n_base_url: s.n8n_base_url, install_id: s.install_id, api_key: s.api_key,
    webhooks: webhookUrls(s), last_n8n_contact: s.last_n8n_contact || null };
});
on('GET', '/api/integrations/workflow', 'session', ({ req, res }) => {
  const s = getSettings({ secrets: true });
  const wf = buildWorkflow({ crmUrl: crmUrl(s, req), apiKey: s.api_key, installId: s.install_id, clinic: s.clinic_name,
    twilioCred: { id: s.n8n_twilio_cred_id, name: s.n8n_twilio_cred_name }, gmailCred: { id: s.n8n_gmail_cred_id, name: s.n8n_gmail_cred_name } });
  const file = `clinic-automation-engine-${s.clinic_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  return send(res, 200, JSON.stringify(wf, null, 2), { 'Content-Disposition': `attachment; filename="${file}"` });
});
on('POST', '/api/integrations/test', 'session', async () => {
  const s = getSettings(), hooks = webhookUrls(s);
  if (!hooks) fail(400, 'Add your n8n address first.');
  const before = s.last_n8n_contact;
  try {
    const r = await fetch(hooks.ping, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { n8n: false, crm: false, hint: r.status === 404 ? 'n8n is reachable, but the engine workflow is not imported or not active.' : `n8n returned ${r.status}.` };
  } catch (e) { return { n8n: false, crm: false, hint: `Couldn't reach n8n at ${s.n8n_base_url} (${e.cause?.code || e.message}).` }; }
  for (let i = 0; i < 16; i++) { await new Promise(r => setTimeout(r, 500)); if (getSettings().last_n8n_contact !== before) return { n8n: true, crm: true }; }
  return { n8n: true, crm: false, hint: "n8n received the test but couldn't call the CRM back. Check the CRM public address (n8n must be able to reach it)." };
});

// ----- exports & sample data -----
on('GET', '/api/export/:table', 'session', ({ params, res }) => {
  const table = { 'patients.csv': 'patients', 'messages.csv': 'sms', 'calls.csv': 'calls' }[params.table] || fail(404, 'Unknown export.');
  const rows = db.prepare(`SELECT * FROM ${table}`).all(), cols = rows[0] ? Object.keys(rows[0]) : [];
  const cell = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return send(res, 200, [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n'),
    { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${params.table}"` });
});
on('POST', '/api/demo/seed', 'session', () => { seed(); return { ok: true }; });
on('DELETE', '/api/demo', 'session', () => { clearSeed(); return { ok: true }; });

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
const readBody = req => new Promise((ok, bad) => {
  let b = ''; req.on('data', c => { b += c; if (b.length > 10e6) { bad(new HttpError(413, 'Upload too large.')); req.destroy(); } });
  req.on('end', () => {
    if (!b) return ok({});
    if (String(req.headers['content-type']).includes('application/x-www-form-urlencoded')) return ok(Object.fromEntries(new URLSearchParams(b)));
    try { ok(JSON.parse(b)); } catch { bad(new HttpError(400, 'Invalid JSON.')); }
  });
});

http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  try {
    if (p.startsWith('/api/')) {
      const match = routes.map(r => ({ r, m: r.method === req.method && p.match(r.re) })).find(x => x.m);
      if (!match) fail(404, 'Not found.');
      const { r, m } = match, key = A.hasApiKey(req);
      if (r.auth === 'session' && !A.isLoggedIn(req)) fail(401, 'Please log in.');
      if ((r.auth === 'any' || r.auth === 'n8n') && !key && !A.isLoggedIn(req)) fail(401, 'Missing or wrong API key.');
      if (r.auth === 'n8n' && key) setInternal('last_n8n_contact', L.now());
      const body = ['GET', 'DELETE'].includes(req.method) ? {} : await readBody(req);
      const out = await r.fn({ req, res, body, q: Object.fromEntries(url.searchParams), params: m.groups || {}, ip: req.socket.remoteAddress });
      if (out !== SENT) send(res, 200, out ?? { ok: true });
      return;
    }
    const file = path.join(PUBLIC, p === '/' ? 'index.html' : path.normalize(decodeURIComponent(p)));
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Something went wrong on the server.' });
  }
}).listen(PORT, () => console.log(`Clinic Automation CRM running → http://localhost:${PORT}`));
