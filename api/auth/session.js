const { COOKIE, session, json, clearCookie } = require('../../lib/security');
module.exports = (req, res) => {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: 'Método não permitido.' }); }
  const user = session(req);
  if (!user) { clearCookie(res, COOKIE); return json(res, 401, { authenticated: false }); }
  return json(res, 200, { authenticated: true, login: user.login });
};
