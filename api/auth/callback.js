const { STATE_COOKIE, COOKIE, seal, unseal, signSession, cookies, setCookie, clearCookie } = require('../../lib/security');

module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).end(); }
  const url = new URL(req.url, `https://${req.headers.host}`);
  const stateData = unseal(cookies(req)[STATE_COOKIE]);
  clearCookie(res, STATE_COOKIE);
  if (url.searchParams.has('error') || !url.searchParams.get('code') || !stateData || stateData.exp < Date.now() || url.searchParams.get('state') !== stateData.state) {
    res.writeHead(302, { Location: '/login.html?error=denied', 'Cache-Control': 'no-store' }); return res.end();
  }
  try {
    const callback = `${process.env.APP_URL || `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host}`}/api/auth/callback`;
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code: url.searchParams.get('code'), redirect_uri: callback, state: stateData.state })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error('OAuth inválido.');
    const userResponse = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    const user = await userResponse.json();
    if (!userResponse.ok || user.login !== 'fisa67') {
      clearCookie(res, COOKIE);
      res.writeHead(302, { Location: '/login.html?error=denied', 'Cache-Control': 'no-store' }); return res.end();
    }
    setCookie(res, COOKIE, signSession({ login: user.login, exp: Date.now() + 8 * 60 * 60 * 1000 }), 8 * 60 * 60);
    res.writeHead(302, { Location: '/admin.html', 'Cache-Control': 'no-store' }); res.end();
  } catch (err) {
    console.error('GitHub OAuth callback failed:', err.message);
    res.writeHead(302, { Location: '/login.html?error=oauth', 'Cache-Control': 'no-store' }); res.end();
  }
};
