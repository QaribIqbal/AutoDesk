import crypto from 'node:crypto';
import { db, getSettings, setInternal } from './db.js';

const SESSION_DAYS = 30;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex'), b = crypto.scryptSync(String(pw), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const setPassword = pw => setInternal('password_hash', hashPassword(pw));

export function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO sessions(token, expires_at) VALUES(?,?)').run(token, new Date(Date.now() + SESSION_DAYS * 864e5).toISOString());
  return token;
}
export const destroySession = token => db.prepare('DELETE FROM sessions WHERE token=?').run(token || '');
export const destroyAllSessions = () => db.exec('DELETE FROM sessions');

export function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
export function sessionCookie(token, req) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
  return token ? `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}` : 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
}
export function isLoggedIn(req) {
  const t = cookies(req).sid;
  return !!t && !!db.prepare('SELECT 1 FROM sessions WHERE token=? AND expires_at > ?').get(t, new Date().toISOString());
}
export function hasApiKey(req) {
  const key = getSettings({ secrets: true }).api_key, given = String(req.headers['x-api-key'] || '');
  return !!key && given.length === key.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
}

// Tiny in-memory login throttle: 10 failures per IP per 15 minutes.
const fails = new Map();
export function throttled(ip) {
  const f = fails.get(ip);
  return !!f && f.n >= 10 && Date.now() - f.t < 15 * 60e3;
}
export function noteFailure(ip) {
  const f = fails.get(ip);
  fails.set(ip, !f || Date.now() - f.t > 15 * 60e3 ? { n: 1, t: Date.now() } : { n: f.n + 1, t: f.t });
}
export const clearFailures = ip => fails.delete(ip);
