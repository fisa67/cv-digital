const crypto = require('node:crypto');
const { STATE_COOKIE, seal, setCookie } = require('../../lib/security');

module.exports = (req, res) => {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).end(); }
  if (!process.env.GITHUB_CLIENT_ID) return res.status(500).send('GITHUB_CLIENT_ID não configurado.');
  const state = crypto.randomBytes(32).toString('hex');
  setCookie(res, STATE_COOKIE, seal({ state, exp: Date.now() + 10 * 60 * 1000 }), 600);
  const callback = `${process.env.APP_URL || `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host}`}/api/auth/callback`;
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID);
  url.searchParams.set('redirect_uri', callback);
  url.searchParams.set('scope', 'read:user');
  url.searchParams.set('state', state);
  res.writeHead(302, { Location: url.toString(), 'Cache-Control': 'no-store' }); res.end();
};
