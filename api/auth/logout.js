const { COOKIE, clearCookie, json, sameOrigin } = require('../../lib/security');
module.exports = (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Método não permitido.' }); }
  if (!sameOrigin(req)) return json(res, 403, { error: 'Origem inválida.' });
  clearCookie(res, COOKIE); return json(res, 200, { ok: true });
};
