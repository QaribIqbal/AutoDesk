// End-to-end: real server + a fake n8n that behaves like the generated engine workflow.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'));
const PORT = 3900 + Math.floor(Math.random() * 90), BASE = `http://127.0.0.1:${PORT}`;
let server, fakeN8n, n8nPort, cookie = '', apiKey = '', installId = '';

const call = async (p, { method = 'GET', body, key, auth = true } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && cookie) headers.Cookie = cookie;
  if (key) headers['x-api-key'] = key;
  const r = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
};

before(async () => {
  // Fake n8n: answers the engine's webhooks the way the real workflow would.
  fakeN8n = http.createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const body = b ? JSON.parse(b) : {};
    res.end('{"message":"Workflow was started"}');
    if (req.url.endsWith('-ping')) await call('/api/n8n/ping', { method: 'POST', body: {}, key: apiKey, auth: false });
    if (req.url.endsWith('-launch')) {
      const { json } = await call(`/api/n8n/campaigns/${body.campaign_id}/recipients`, { key: apiKey, auth: false });
      for (const r of json.recipients) await call('/api/sms', { method: 'POST', key: apiKey, auth: false,
        body: { ...r, campaign: json.campaign.name, campaign_id: json.campaign.id, status: json.demo_mode ? 'demo_sent' : 'sent' } });
    }
  }).listen(0);
  n8nPort = fakeN8n.address().port;
  server = spawn(process.execPath, ['--no-warnings', 'server.js'], { cwd: root, env: { ...process.env, PORT, DATA_DIR: dataDir } });
  await new Promise((ok, bad) => { server.stdout.on('data', d => String(d).includes('running') && ok()); server.on('exit', bad); });
});
after(() => { server?.kill(); fakeN8n?.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('first run: setup required, API locked', async () => {
  assert.equal((await call('/api/status')).json.setup_complete, false);
  assert.equal((await call('/api/summary')).status, 401);
  assert.equal((await call('/api/auth/setup', { method: 'POST', body: { password: 'short' } })).status, 400);
});

test('setup wizard logs the clinic in', async () => {
  const r = await call('/api/auth/setup', { method: 'POST', body: { password: 'correct horse', settings: { clinic_name: 'Test Dental', timezone: 'Australia/Sydney', owner_phone: '0400 000 001' } } });
  assert.equal(r.status, 200);
  const st = (await call('/api/status')).json;
  assert.equal(st.setup_complete, true); assert.equal(st.logged_in, true);
  assert.equal((await call('/api/auth/setup', { method: 'POST', body: { password: 'another one' } })).status, 403);
  const integ = (await call('/api/integrations')).json; apiKey = integ.api_key; installId = integ.install_id;
  assert.ok(apiKey.length >= 32);
});

test('wrong password is rejected, right one works', async () => {
  const saved = cookie; cookie = '';
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { password: 'nope' } })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { password: 'correct horse' } })).status, 200);
  assert.notEqual(cookie, saved);
});

test('CSV-style import normalises AU numbers and dates, and never duplicates', async () => {
  const rows = [
    { name: 'Sarah Mitchell', phone: '0412 345 678', email: 'sarah@example.com', last_visit: '14/02/2025', consent: 'yes' },
    { name: 'James OConnor', phone: '+61423456789', last_visit: '2024-11-03' },
    { name: 'No Consent', phone: '0434 567 890', last_visit: '2024-01-01', consent: 'no' },
    { name: 'No Phone', phone: '' },
  ];
  assert.deepEqual((await call('/api/patients/import', { method: 'POST', body: { rows } })).json, { added: 3, updated: 0, skipped: 1 });
  assert.equal((await call('/api/patients/import', { method: 'POST', body: { rows: [{ phone: '+61412345678', name: '' }] } })).json.updated, 1);
  const { rows: list } = (await call('/api/patients')).json;
  const sarah = list.find(p => p.phone === '+61412345678');
  assert.equal(sarah.name, 'Sarah Mitchell', 'blank cell must not wipe the name');
  assert.equal(sarah.last_visit, '2025-02-14');
});

test('campaign in test mode without n8n logs test texts only to eligible patients', async () => {
  const pv = (await call('/api/campaigns/preview', { method: 'POST', body: { min_months: 6, template: 'Hi {first_name} from {clinic}' } })).json;
  assert.equal(pv.count, 2);
  assert.match(pv.sample.message, /^Hi (Sarah|James) from Test Dental$/);
  const { id } = (await call('/api/campaigns', { method: 'POST', body: { name: 'Test run', template: 'Hi {first_name}', min_months: 6 } })).json;
  const r = (await call(`/api/campaigns/${id}/launch`, { method: 'POST', body: {} })).json;
  assert.deepEqual(r, { mode: 'test', sent: 2 });
  assert.equal((await call(`/api/campaigns/${id}/launch`, { method: 'POST', body: {} })).status, 400, 'nobody gets the same campaign twice');
});

test('n8n endpoints require the API key', async () => {
  assert.equal((await call('/api/n8n/ping', { method: 'POST', body: {}, auth: false })).status, 401);
  assert.equal((await call('/api/n8n/ping', { method: 'POST', body: {}, auth: false, key: 'wrong' })).status, 401);
  assert.equal((await call('/api/n8n/ping', { method: 'POST', body: {}, auth: false, key: apiKey })).status, 200);
});

test('connection test + launch through (fake) n8n', async () => {
  await call('/api/settings', { method: 'PUT', body: { n8n_base_url: `http://127.0.0.1:${n8nPort}` } });
  assert.deepEqual((await call('/api/integrations/test', { method: 'POST', body: {} })).json, { n8n: true, crm: true });
  await call('/api/patients', { method: 'POST', body: { name: 'Priya Sharma', phone: '0456 789 012', last_visit: '2024-05-01' } });
  const { id } = (await call('/api/campaigns', { method: 'POST', body: { name: 'Via n8n', template: 'Hey {first_name}', min_months: 6 } })).json;
  assert.equal((await call(`/api/campaigns/${id}/launch`, { method: 'POST', body: {} })).json.queued, 3);
  await new Promise(r => setTimeout(r, 400));
  const sms = (await call(`/api/sms?campaign_id=${id}`)).json;
  assert.equal(sms.length, 3);
  assert.ok(sms.every(m => m.status === 'demo_sent' && m.message.startsWith('Hey ')));
});

test('replies: YES alerts the owner, STOP opts the patient out everywhere', async () => {
  const yes = (await call('/api/n8n/sms-reply', { method: 'POST', key: apiKey, auth: false, body: { from: '+61412345678', body: 'Yes please' } })).json;
  assert.equal(yes.alert_owner, true); assert.equal(yes.owner_phone, '+61400000001');
  assert.match(yes.alert_text, /Sarah Mitchell/);
  const stop = (await call('/api/n8n/sms-reply', { method: 'POST', key: apiKey, auth: false, body: { from: '+61423456789', body: 'STOP' } })).json;
  assert.equal(stop.opted_out, true); assert.equal(stop.alert_owner, false);
  const james = (await call('/api/patients?search=James')).json.rows[0];
  assert.equal(james.opted_out, 1);
  assert.equal((await call('/api/inbox')).json.hot_leads.length, 1);
});

test('missed call: known patient gets email, unknown gets text, call is logged', async () => {
  const wednesdayMorning = 'Wed, 07 Oct 2026 00:30:00 +0000'; // 11:30am in Sydney, Twilio's Timestamp format
  const known = (await call('/api/n8n/missed-call', { method: 'POST', key: apiKey, auth: false, body: { caller_number: '+61412345678', at: wednesdayMorning } })).json;
  assert.equal(known.channel, 'email'); assert.equal(known.email.to, 'sarah@example.com');
  assert.match(known.email.subject, /Test Dental/);
  const unknown = (await call('/api/n8n/missed-call', { method: 'POST', key: apiKey, auth: false, body: { From: '+61499999999', Timestamp: wednesdayMorning } })).json;
  assert.equal(unknown.channel, 'sms'); assert.equal(unknown.skip, false);
  await call(`/api/n8n/calls/${unknown.call_id}/followup`, { method: 'POST', key: apiKey, auth: false, body: { status: 'failed' } });
  const calls = (await call('/api/calls')).json;
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c.call_type === 'missed'), 'calls during opening hours are "missed", not after-hours');
  assert.equal(calls.find(c => c.id === unknown.call_id).handled_by, 'none');
});

test('voice agent: after-hours is worked out from clinic hours', async () => {
  const sundayNight = '2026-10-11T12:00:00Z'; // 11pm Sunday in Sydney
  const { id } = (await call('/api/n8n/voice-call', { method: 'POST', key: apiKey, auth: false,
    body: { message: { call: { customer: { number: '+61411111111' }, startedAt: sundayNight }, summary: 'Booked a clean', analysis: { structuredData: { appointment_booked: true } } } } })).json;
  const c = (await call('/api/calls')).json.find(x => x.id === id);
  assert.equal(c.call_type, 'after_hours'); assert.equal(c.handled_by, 'ai'); assert.equal(c.appointment_booked, 1);
});

test('booking webhook marks the latest text as booked, and revenue follows', async () => {
  await call('/api/n8n/booking', { method: 'POST', key: apiKey, auth: false, body: { phone: '0412 345 678', kind: 'sms', value: 400 } });
  const s = (await call('/api/summary')).json;
  assert.equal(s.reactivation.booked, 1); assert.equal(s.reactivation.revenue, 400);
  assert.equal(s.voice.after_hours_handled, 1); assert.equal(s.voice.revenue, 250);
  assert.ok(s.n8n.last_contact);
});

test('engine download is a valid, fully wired n8n workflow for this clinic', async () => {
  const wf = (await call('/api/integrations/workflow')).json;
  assert.match(wf.name, /Test Dental/);
  const names = new Set(wf.nodes.map(n => n.name));
  assert.equal(names.size, wf.nodes.length, 'node names must be unique');
  for (const [from, c] of Object.entries(wf.connections)) {
    assert.ok(names.has(from), `missing source ${from}`);
    for (const out of c.main) for (const t of out) assert.ok(names.has(t.node), `missing target ${t.node}`);
  }
  const hooks = wf.nodes.filter(n => n.type === 'n8n-nodes-base.webhook').map(n => n.parameters.path);
  assert.deepEqual(hooks.sort(), ['booking', 'launch', 'missed-call', 'ping', 'sms-reply', 'voice-call'].map(p => `${installId}-${p}`).sort());
  assert.ok(JSON.stringify(wf).includes(apiKey));
  assert.equal((await call('/api/integrations/workflow', { auth: false })).status, 401);
});

test('CSV export and logout', async () => {
  const csv = (await call('/api/export/patients.csv')).json;
  assert.match(csv, /^id,name,phone/);
  await call('/api/auth/logout', { method: 'POST', body: {} });
  assert.equal((await call('/api/summary')).status, 401);
});
