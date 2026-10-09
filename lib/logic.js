import { db, getSettings, bit, truthy } from './db.js';

export const now = () => new Date().toISOString();
export const num = v => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const COUNTRY_CODES = [['Australia/', '61'], ['Pacific/Auckland', '64'], ['Europe/London', '44'], ['America/', '1'],
  ['Asia/Karachi', '92'], ['Asia/Dubai', '971'], ['Asia/Kolkata', '91'], ['Asia/Singapore', '65']];
/** Normalises to E.164. Local numbers ("0412 345 678") get the clinic's country code from its timezone. */
export function normPhone(p, tz = getSettings().timezone) {
  let s = String(p || '').trim().replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('+') || !s) return s;
  const cc = COUNTRY_CODES.find(([prefix]) => String(tz).startsWith(prefix))?.[1];
  if (cc && s.startsWith('0')) return `+${cc}${s.slice(1)}`;
  if (cc && s.startsWith(cc) && s.length > 9) return `+${s}`;
  return s;
}
const isoOr = v => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toISOString() : now(); };

/** Accepts YYYY-MM-DD, D/M/YYYY (AU) or anything Date can parse. Returns YYYY-MM-DD or null. */
export function normDate(v) {
  if (!v) return null;
  const s = String(v).trim(), au = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const d = au ? new Date(Date.UTC(+au[3], +au[2] - 1, +au[1])) : new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

// ---------- templates ----------
export const render = (tpl, ctx) => String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => ctx[k] ?? '');
export function ctxFor(p = {}, s = getSettings(), extra = {}) {
  const months = p.last_visit ? Math.max(1, Math.round((Date.now() - new Date(p.last_visit)) / (864e5 * 30))) : 'a few';
  return { first_name: String(p.name || 'there').split(' ')[0], name: p.name || 'there', phone: p.phone || '',
    clinic: s.clinic_name, booking_link: s.booking_link || s.clinic_phone, clinic_phone: s.clinic_phone, months, ...extra };
}

// ---------- opening hours ----------
export function isOpen(s = getSettings(), at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: s.timezone || 'UTC', weekday: 'short', hour: 'numeric', hourCycle: 'h23' })
    .formatToParts(at).map(p => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const days = String(s.open_days).split(',').map(Number);
  return days.includes(day) && +parts.hour >= s.open_hour && +parts.hour < s.close_hour;
}

// ---------- records ----------
export function insertSms(r, source = 'n8n') {
  const phone = normPhone(r.phone);
  if (!phone) throw new Error('phone is required');
  return Number(db.prepare(`INSERT INTO sms(name,phone,treatment,message,status,campaign,campaign_id,patient_id,sent_at,replied,reply_text,
    replied_at,opted_out,appointment_booked,value,notes,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    r.name ?? null, phone, r.treatment ?? null, r.message ?? null, r.status || 'sent', r.campaign ?? null,
    num(r.campaign_id), num(r.patient_id), isoOr(r.sent_at), bit(r.replied), r.reply_text ?? null, r.replied_at ?? null,
    bit(r.opted_out), bit(r.appointment_booked), num(r.value), r.notes ?? null, r.source || source).lastInsertRowid);
}
export function insertCall(r, source = 'n8n') {
  const number = normPhone(r.caller_number || r.phone);
  if (!number) throw new Error('caller_number is required');
  const channel = r.followup_channel ?? (r.channel === 'sms_fallback' ? 'sms' : r.channel) ?? null;
  const handled = r.handled_by || (channel === 'email' || channel === 'sms' ? channel : 'none');
  return Number(db.prepare(`INSERT INTO calls(caller_number,caller_name,caller_email,call_type,handled_by,followup_channel,
    status,summary,campaign,recovered,appointment_booked,value,created_at,notes,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    number, r.caller_name ?? null, r.caller_email ?? null, r.call_type || 'missed', handled, channel,
    r.status ?? null, r.summary ?? null, r.campaign ?? null, bit(r.recovered), bit(r.appointment_booked),
    num(r.value), isoOr(r.created_at || r.sent_at), r.notes ?? null, r.source || source).lastInsertRowid);
}

export const SMS_FIELDS = ['name', 'treatment', 'status', 'replied', 'reply_text', 'replied_at', 'opted_out', 'appointment_booked', 'value', 'notes', 'dismissed'];
export const CALL_FIELDS = ['caller_name', 'caller_email', 'call_type', 'handled_by', 'followup_channel', 'status', 'summary', 'recovered', 'appointment_booked', 'value', 'notes', 'dismissed'];
export const PATIENT_FIELDS = ['name', 'email', 'last_visit', 'treatment', 'consent', 'opted_out', 'notes'];
const BITS = ['replied', 'opted_out', 'appointment_booked', 'recovered', 'consent', 'dismissed'];

/** UPDATE from an allow-list of fields. */
export function patch(table, id, body, fields) {
  const sets = [], vals = [];
  for (const f of fields) if (f in body) {
    sets.push(`${f}=?`);
    vals.push(BITS.includes(f) ? bit(body[f]) : f === 'value' ? num(body[f]) : f === 'last_visit' ? normDate(body[f]) : body[f]);
  }
  if (!sets.length) return 0;
  return Number(db.prepare(`UPDATE ${table} SET ${sets.join(',')} WHERE id=?`).run(...vals, id).changes);
}

// ---------- patients ----------
export function upsertPatient(r, source = 'manual') {
  const phone = normPhone(r.phone);
  if (!phone) return null;
  const existing = db.prepare('SELECT id FROM patients WHERE phone=?').get(phone);
  // Blank cells never overwrite known data; consent only changes when the source actually says so.
  const consent = 'consent' in r && r.consent !== '' && r.consent != null ? bit(r.consent) : null;
  const vals = [r.name || null, r.email || null, normDate(r.last_visit), r.treatment || null, consent, bit(r.opted_out), r.notes || null];
  if (existing) {
    db.prepare('UPDATE patients SET name=COALESCE(?,name), email=COALESCE(?,email), last_visit=COALESCE(?,last_visit), treatment=COALESCE(?,treatment), consent=COALESCE(?,consent), opted_out=MAX(opted_out,?), notes=COALESCE(?,notes) WHERE id=?').run(...vals, existing.id);
    return { id: existing.id, created: false };
  }
  const id = Number(db.prepare('INSERT INTO patients(name,email,last_visit,treatment,consent,opted_out,notes,phone,created_at,source) VALUES(?,?,?,?,COALESCE(?,1),?,?,?,?,?)').run(...vals, phone, now(), source).lastInsertRowid);
  return { id, created: true };
}

const cutoff = months => { const d = new Date(); d.setMonth(d.getMonth() - months); return d.toISOString().slice(0, 10); };
/** Patients a campaign may message: has phone + consent + not opted out + last visit old enough + not already sent this campaign. */
export function eligiblePatients(minMonths, campaignId = 0) {
  return db.prepare(`SELECT * FROM patients WHERE phone!='' AND consent=1 AND opted_out=0
    AND (? = 0 OR (last_visit IS NOT NULL AND last_visit <= ?))
    AND phone NOT IN (SELECT phone FROM sms WHERE campaign_id=?) ORDER BY last_visit`).all(minMonths, cutoff(minMonths), campaignId);
}
export function recipientsFor(c, s = getSettings()) {
  return eligiblePatients(c.min_months, c.id).map(p => ({ patient_id: p.id, name: p.name, phone: p.phone, treatment: p.treatment,
    message: render(c.template, ctxFor(p, s)) }));
}

// ---------- inbound events ----------
const STOP = /^\s*(stop|unsubscribe|cancel|end|quit|opt.?out)\b/i;
const HOT = /^\s*(yes|y|yeah|yep|yup|sure|ok|okay|please|book)\b/i;
export function handleReply(phoneIn, text) {
  const s = getSettings(), phone = normPhone(phoneIn);
  const row = db.prepare('SELECT * FROM sms WHERE phone=? ORDER BY sent_at DESC LIMIT 1').get(phone);
  const stop = STOP.test(text), hot = !stop && HOT.test(text);
  if (stop) db.prepare('UPDATE patients SET opted_out=1 WHERE phone=?').run(phone);
  if (!row) return { matched: false, opted_out: stop, alert_owner: false };
  patch('sms', row.id, { replied: 1, reply_text: text, replied_at: now(), opted_out: stop ? 1 : row.opted_out }, SMS_FIELDS);
  return { matched: true, id: row.id, opted_out: stop, alert_owner: hot && !!s.owner_phone, demo_mode: s.demo_mode,
    owner_phone: normPhone(s.owner_phone, s.timezone), sms_from: normPhone(s.sms_from, s.timezone), alert_text: render(s.tpl_owner_alert, { ...ctxFor(row, s), reply: text }) };
}
export function handleBooking(b) {
  const phone = normPhone(b.phone || b.caller_number);
  if (String(b.kind || '').toLowerCase() === 'call') {
    const row = db.prepare('SELECT id FROM calls WHERE caller_number=? ORDER BY created_at DESC LIMIT 1').get(phone);
    if (!row) return null;
    patch('calls', row.id, { recovered: 1, appointment_booked: 1, ...('value' in b ? { value: b.value } : {}) }, CALL_FIELDS);
    return { id: row.id, kind: 'call' };
  }
  const row = db.prepare('SELECT id FROM sms WHERE phone=? ORDER BY sent_at DESC LIMIT 1').get(phone);
  if (!row) return null;
  patch('sms', row.id, { replied: 1, appointment_booked: 1, ...('value' in b ? { value: b.value } : {}) }, SMS_FIELDS);
  return { id: row.id, kind: 'sms' };
}
/** A call the phone system says nobody answered. Logs it now; returns what n8n should send. */
export function handleMissedCall(b) {
  const s = getSettings(), number = normPhone(b.caller_number || b.From || b.from);
  if (!number) throw new Error('caller_number is required');
  if (!s.missed_call_enabled) return { skip: true, reason: 'Missed-call follow-up is switched off' };
  const p = db.prepare('SELECT * FROM patients WHERE phone=?').get(number);
  const channel = p?.email ? 'email' : p?.opted_out ? 'none' : 'sms';
  const ctx = ctxFor(p || { name: b.caller_name }, s);
  const t = new Date(b.at || b.Timestamp || b.timestamp || Date.now()), at = isNaN(t) ? new Date() : t;
  const call_id = insertCall({ caller_number: number, caller_name: p?.name || b.caller_name, caller_email: p?.email,
    created_at: at.toISOString(), call_type: isOpen(s, at) ? 'missed' : 'after_hours', handled_by: channel, followup_channel: channel === 'none' ? null : channel,
    status: channel === 'none' ? 'opted_out' : 'following_up', campaign: 'missed-call' });
  return { skip: channel === 'none', call_id, demo_mode: s.demo_mode, delay_seconds: s.followup_delay_seconds, channel,
    email: { to: p?.email || '', subject: render(s.tpl_missed_email_subject, ctx), body: render(s.tpl_missed_email_body, ctx) },
    sms: { to: number, from: normPhone(s.sms_from, s.timezone), body: render(s.tpl_missed_sms, ctx) } };
}
/** Voice-agent end-of-call report. Accepts a flat shape or a Vapi-style { message: { call, analysis } } body. */
export function handleVoiceCall(raw) {
  const s = getSettings(), m = raw.message || raw;
  const number = raw.caller_number || m.call?.customer?.number || m.customer?.number || raw.from || '';
  const booked = truthy(raw.appointment_booked ?? m.analysis?.structuredData?.appointment_booked ?? false);
  const at = raw.started_at || m.call?.startedAt || m.startedAt;
  return insertCall({ caller_number: number, caller_name: raw.caller_name || m.call?.customer?.name || '',
    call_type: raw.call_type || (isOpen(s, at ? new Date(at) : new Date()) ? 'missed' : 'after_hours'),
    handled_by: 'ai', followup_channel: 'voice', status: booked ? 'booked' : 'answered',
    summary: raw.summary || m.summary || m.analysis?.summary || '', recovered: true, appointment_booked: booked,
    value: raw.value ?? null, campaign: 'voice-agent', created_at: at });
}

// ---------- reporting ----------
export function summary(sinceDays) {
  const s = getSettings(), avg = s.avg_appointment_value;
  const since = sinceDays ? new Date(Date.now() - sinceDays * 864e5).toISOString() : '0';
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const r = one(`SELECT COUNT(*) sent, COUNT(DISTINCT phone) contacts, COALESCE(SUM(replied),0) replies,
    COALESCE(SUM(opted_out),0) optouts, COALESCE(SUM(appointment_booked),0) booked,
    COALESCE(SUM(CASE WHEN appointment_booked=1 THEN COALESCE(value,?) END),0) revenue FROM sms WHERE sent_at>=?`, avg, since);
  r.cost = r.sent * s.sms_cost;
  r.reply_rate = r.sent ? r.replies / r.sent : 0;
  r.book_rate = r.sent ? r.booked / r.sent : 0;
  r.roi = r.cost ? (r.revenue - r.cost) / r.cost : null;
  r.last = one(`SELECT MAX(sent_at) m FROM sms WHERE source NOT IN ('seed','manual','demo')`).m;

  const v = one(`SELECT COUNT(*) total, COALESCE(SUM(call_type='missed'),0) missed, COALESCE(SUM(call_type='after_hours'),0) after_hours,
    COALESCE(SUM(call_type='missed' AND recovered=1),0) missed_recovered,
    COALESCE(SUM(call_type='after_hours' AND handled_by!='none'),0) after_hours_handled,
    COALESCE(SUM(followup_channel='email'),0) emails, COALESCE(SUM(followup_channel='sms'),0) sms_followups,
    COALESCE(SUM(handled_by='ai'),0) ai_handled, COALESCE(SUM(appointment_booked),0) booked,
    COALESCE(SUM(CASE WHEN appointment_booked=1 THEN COALESCE(value,?) END),0) revenue FROM calls WHERE created_at>=?`, avg, since);
  v.cost = v.ai_handled * s.voice_cost_per_call + v.emails * s.email_cost + v.sms_followups * s.sms_cost;
  v.recovery_rate = v.missed ? v.missed_recovered / v.missed : 0;
  v.handled_rate = v.after_hours ? v.after_hours_handled / v.after_hours : 0;
  v.roi = v.cost ? (v.revenue - v.cost) / v.cost : null;
  v.last = one(`SELECT MAX(created_at) m FROM calls WHERE source NOT IN ('seed','manual')`).m;

  const days = [...Array(14)].map((_, i) => new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10));
  const byDay = sql => Object.fromEntries(db.prepare(sql).all().map(x => [x.d, x.n]));
  const sd = byDay('SELECT substr(sent_at,1,10) d, COUNT(*) n FROM sms GROUP BY d'), cd = byDay('SELECT substr(created_at,1,10) d, COUNT(*) n FROM calls GROUP BY d');
  return { reactivation: r, voice: v, series: days.map(d => ({ date: d, sms: sd[d] || 0, calls: cd[d] || 0 })),
    totals: { revenue: r.revenue + v.revenue, cost: r.cost + v.cost, booked: r.booked + v.booked, net: r.revenue + v.revenue - r.cost - v.cost },
    n8n: { last_contact: s.last_n8n_contact || null, demo_mode: s.demo_mode } };
}
/** Things a human should act on today. */
export function inbox() {
  return {
    hot_leads: db.prepare(`SELECT * FROM sms WHERE replied=1 AND opted_out=0 AND appointment_booked=0 AND dismissed=0 ORDER BY COALESCE(replied_at,sent_at) DESC LIMIT 8`).all(),
    callbacks: db.prepare(`SELECT * FROM calls WHERE recovered=0 AND appointment_booked=0 AND dismissed=0 AND handled_by!='ai' ORDER BY created_at DESC LIMIT 8`).all(),
  };
}
export function campaignsWithStats() {
  const avg = getSettings().avg_appointment_value;
  return db.prepare(`SELECT c.*, COUNT(s.id) sent, COALESCE(SUM(s.replied),0) replies, COALESCE(SUM(s.appointment_booked),0) booked,
    COALESCE(SUM(s.opted_out),0) optouts, COALESCE(SUM(CASE WHEN s.appointment_booked=1 THEN COALESCE(s.value,?) END),0) revenue
    FROM campaigns c LEFT JOIN sms s ON s.campaign_id=c.id GROUP BY c.id ORDER BY c.created_at DESC`).all(avg);
}
