const crypto = require('node:crypto');

const COOKIE = process.env.NODE_ENV === 'production' ? '__Host-cv_admin' : 'cv_admin';
const STATE_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-cv_oauth_state' : 'cv_oauth_state';
const MAX_AGE = 60 * 60 * 8;

function secret() {
  const value = process.env.SESSION_SECRET || '';
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('SESSION_SECRET deve conter 64 caracteres hexadecimais.');
  return Buffer.from(value, 'hex');
}
function seal(value) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', secret(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
function unseal(value) {
  try {
    const b = Buffer.from(value || '', 'base64url');
    if (b.length < 29) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', secret(), b.subarray(0, 12));
    decipher.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]));
  } catch { return null; }
}
function signSession(value) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function verifySession(value) {
  try {
    const [payload, signature, extra] = String(value || '').split('.');
    if (!payload || !signature || extra) return null;
    const expected = crypto.createHmac('sha256', secret()).update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch { return null; }
}
function cookieOptions(maxAge, secure = process.env.NODE_ENV === 'production') {
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim()).filter(Boolean).map(x => {
    const i = x.indexOf('='); return [x.slice(0, i), decodeURIComponent(x.slice(i + 1))];
  }));
}
function setCookie(res, name, value, maxAge) {
  const previous = res.getHeader('Set-Cookie');
  const values = previous ? (Array.isArray(previous) ? previous : [previous]) : [];
  res.setHeader('Set-Cookie', [...values, `${name}=${encodeURIComponent(value)}; ${cookieOptions(maxAge)}`]);
}
function clearCookie(res, name) { setCookie(res, name, '', 0); }
function session(req) {
  const value = verifySession(cookies(req)[COOKIE]);
  if (!value || value.login !== 'fisa67' || value.exp < Date.now()) return null;
  return value;
}
function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try { return !!origin && !!host && new URL(origin).host === host; } catch { return false; }
}
module.exports = { COOKIE, STATE_COOKIE, MAX_AGE, seal, unseal, signSession, setCookie, clearCookie, cookies, session, json, sameOrigin };
