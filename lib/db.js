import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = process.env.DATA_DIR || path.join(import.meta.dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const db = new DatabaseSync(path.join(DATA_DIR, 'crm.db'));

db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, phone TEXT NOT NULL UNIQUE, email TEXT, last_visit TEXT, treatment TEXT,
  consent INTEGER DEFAULT 1, opted_out INTEGER DEFAULT 0, notes TEXT,
  created_at TEXT NOT NULL, source TEXT DEFAULT 'manual'
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, template TEXT NOT NULL, min_months INTEGER DEFAULT 6,
  status TEXT DEFAULT 'draft', recipients INTEGER DEFAULT 0,
  created_at TEXT NOT NULL, launched_at TEXT, source TEXT DEFAULT 'manual'
);
CREATE TABLE IF NOT EXISTS sms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, phone TEXT NOT NULL, treatment TEXT, message TEXT,
  status TEXT DEFAULT 'sent', campaign TEXT, sent_at TEXT NOT NULL,
  replied INTEGER DEFAULT 0, reply_text TEXT, replied_at TEXT,
  opted_out INTEGER DEFAULT 0, appointment_booked INTEGER DEFAULT 0,
  value REAL, notes TEXT, source TEXT DEFAULT 'n8n'
);
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caller_number TEXT NOT NULL, caller_name TEXT, caller_email TEXT,
  call_type TEXT DEFAULT 'missed',      -- missed | after_hours
  handled_by TEXT DEFAULT 'none',       -- ai | email | sms | human | none
  followup_channel TEXT, status TEXT, summary TEXT, campaign TEXT,
  recovered INTEGER DEFAULT 0, appointment_booked INTEGER DEFAULT 0,
  value REAL, created_at TEXT NOT NULL, notes TEXT, source TEXT DEFAULT 'n8n'
);
CREATE INDEX IF NOT EXISTS idx_sms_phone ON sms(phone);
CREATE INDEX IF NOT EXISTS idx_calls_number ON calls(caller_number);
`);

// Additive migrations for databases created by earlier versions.
const addColumn = (table, col, def) => {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};
addColumn('sms', 'campaign_id', 'INTEGER');
addColumn('sms', 'patient_id', 'INTEGER');
addColumn('sms', 'dismissed', 'INTEGER DEFAULT 0');
addColumn('calls', 'dismissed', 'INTEGER DEFAULT 0');

export const DEFAULTS = {
  clinic_name: 'Bright Smiles Dental',
  clinic_phone: '',
  booking_link: '',
  timezone: 'Australia/Sydney',
  open_days: '1,2,3,4,5',
  open_hour: '9',
  close_hour: '17',
  avg_appointment_value: '250',
  sms_cost: '0.08',
  email_cost: '0',
  voice_cost_per_call: '0.30',
  sms_from: '',
  owner_phone: '',
  demo_mode: '1',
  reactivation_enabled: '1',
  missed_call_enabled: '1',
  followup_delay_seconds: '60',
  // SMS defaults stay within the GSM character set (no em dashes / curly quotes) so each text costs 1-2 credits, not 3-4.
  tpl_reactivation: "Hi {first_name}, it's {clinic}. It's been about {months} months since your last visit. Your health fund extras reset Dec 31, so it's use-it-or-lose-it time. Reply YES and we'll get you booked in. Reply STOP to opt out.",
  tpl_missed_email_subject: 'Sorry we missed your call — {clinic}',
  tpl_missed_email_body: "Hi {first_name},\n\nYou just called {clinic} and we couldn't pick up — sorry about that.\n\nFastest way back in: book straight here → {booking_link}\nOr just reply to this email and we'll sort you out. We reply within one business hour.\n\n— The team at {clinic}",
  tpl_missed_sms: "Hi {first_name}, sorry we missed your call at {clinic}! Book online: {booking_link} or reply here and we'll call you back. Reply STOP to opt out.",
  tpl_owner_alert: 'Hot lead: {name} ({phone}) replied "{reply}" to your SMS. Call them back to book.',
  public_url: '',
  n8n_base_url: '',
  n8n_twilio_cred_id: '', n8n_twilio_cred_name: '',
  n8n_gmail_cred_id: '', n8n_gmail_cred_name: '',
  last_n8n_contact: '',
  setup_complete: '0',
  password_hash: '',
  api_key: '',
  install_id: '',
};
const INTERNAL = ['password_hash', 'api_key', 'install_id', 'setup_complete', 'last_n8n_contact'];
const NUM = ['avg_appointment_value', 'sms_cost', 'email_cost', 'voice_cost_per_call', 'open_hour', 'close_hour', 'followup_delay_seconds'];
const BOOL = ['demo_mode', 'reactivation_enabled', 'missed_call_enabled', 'setup_complete'];

for (const [k, v] of Object.entries(DEFAULTS)) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(k, v);
const setRaw = (k, v) => db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(k, String(v));
const raw = () => Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, r.value]));
if (!raw().api_key) setRaw('api_key', crypto.randomBytes(24).toString('hex'));
if (!raw().install_id) setRaw('install_id', crypto.randomBytes(4).toString('hex'));
// Earlier versions had no setup flow; treat an existing DB without a password as "not set up".

export const truthy = v => v === true || v === 1 || ['true', '1', 'yes', 'y', 'on'].includes(String(v).toLowerCase());
export const bit = v => (truthy(v) ? 1 : 0);

export function getSettings({ secrets = false } = {}) {
  const s = raw();
  for (const k of NUM) s[k] = Number(s[k]);
  for (const k of BOOL) s[k] = s[k] === '1';
  s.has_password = !!s.password_hash;
  if (!secrets) { delete s.password_hash; delete s.api_key; }
  return s;
}
export function saveSettings(body) {
  for (const k of Object.keys(DEFAULTS)) {
    if (!(k in body) || INTERNAL.includes(k)) continue;
    setRaw(k, BOOL.includes(k) ? (truthy(body[k]) ? '1' : '0') : body[k] ?? '');
  }
}
export const setInternal = (k, v) => setRaw(k, BOOL.includes(k) ? (truthy(v) ? '1' : '0') : v);
