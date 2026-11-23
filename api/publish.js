const { session, json, sameOrigin } = require('../lib/security');

const GH = 'https://api.github.com';
const OWNER = 'fisa67';
const REPO = 'cv-digital';
const PROFILE_PATH = 'profile.json';
const PHOTO_PATH = 'uploads/profile.jpg';

async function github(token, path, options = {}) {
  const response = await fetch(`${GH}${path}`, { ...options, headers: {
    Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28', ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {})
  }});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `GitHub retornou HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function validProfile(profile) {
  return profile && typeof profile === 'object' && !Array.isArray(profile) &&
    profile.version === 1 && profile.meta && typeof profile.meta === 'object' &&
    profile.hero && typeof profile.hero === 'object' && typeof profile.hero.name === 'string' &&
    profile.hero.name.trim().length > 0 && profile.hero.name.length <= 200;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Método não permitido.' }); }
  if (!sameOrigin(req)) return json(res, 403, { error: 'Origem inválida.' });
  const auth = session(req);
  if (!auth) return json(res, 401, { error: 'Sessão expirada. Entre novamente com GitHub.' });
  const token = process.env.GITHUB_TOKEN;
  const configuredRepo = process.env.GITHUB_REPOSITORY;
  if (!token || configuredRepo !== `${OWNER}/${REPO}`) return json(res, 500, { error: 'A configuração do repositório não está correta na Vercel.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return json(res, 400, { error: 'O corpo da requisição não contém JSON válido.' }); } }
  const profile = body && body.profile;
  if (!validProfile(profile)) return json(res, 400, { error: 'Os dados recebidos não parecem um profile.json válido.' });
  const profileText = JSON.stringify(profile, null, 2) + '\n';
  if (Buffer.byteLength(profileText) > 1_000_000) return json(res, 413, { error: 'O profile.json excede o tamanho permitido.' });

  const photo = body.photo;
  let photoBase64 = null;
  if (photo !== undefined && photo !== null) {
    if (!photo || photo.contentType !== 'image/jpeg' || typeof photo.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(photo.base64)) return json(res, 400, { error: 'A foto deve ser enviada em base64 como JPEG.' });
    photoBase64 = photo.base64;
    const imageBytes = Buffer.from(photoBase64, 'base64');
    if (imageBytes.length < 4 || imageBytes.length > 3_000_000 || imageBytes[0] !== 0xff || imageBytes[1] !== 0xd8 || imageBytes[2] !== 0xff) return json(res, 400, { error: 'O arquivo enviado não é um JPEG válido ou excede 3 MB.' });
  }

  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(branch) || branch.includes('..') || branch.startsWith('/') || branch.endsWith('/')) return json(res, 500, { error: 'GITHUB_BRANCH contém um nome inválido.' });
  const basePath = `/repos/${OWNER}/${REPO}/contents/`;
  const ref = `?ref=${encodeURIComponent(branch)}`;
  const completedFiles = [];
  try {
    const currentProfile = await github(token, `${basePath}${PROFILE_PATH}${ref}`);
    const currentPhoto = photoBase64 ? await github(token, `${basePath}${PHOTO_PATH}${ref}`) : null;
    const now = new Date().toISOString();
    const message = `Atualiza currículo pelo painel (${now})`;
    const updates = [{ path: PROFILE_PATH, sha: currentProfile.sha, content: Buffer.from(profileText).toString('base64') }];
    if (photoBase64) updates.push({ path: PHOTO_PATH, sha: currentPhoto.sha, content: photoBase64 });

    const results = [];
    for (const file of updates) {
      const result = await github(token, `${basePath}${file.path}`, { method: 'PUT', body: JSON.stringify({
        message, content: file.content, sha: file.sha, branch
      }) });
      results.push(result);
      completedFiles.push(file.path);
    }
    return json(res, 200, {
      ok: true,
      commits: results.map(result => result.commit.sha),
      publishedAt: results.at(-1)?.commit?.committer?.date || now,
      branch
    });
  } catch (err) {
    console.error('Curriculum publish failed:', err.message);
    if (completedFiles.length) return json(res, 502, { error: `Publicação parcial: ${completedFiles.join(', ')} foi atualizado, mas outro arquivo falhou. Confira o repositório antes de tentar novamente.`, updatedFiles: completedFiles });
    if (err.status === 409 || err.status === 422) return json(res, 409, { error: 'O arquivo mudou no GitHub durante a publicação. Recarregue o painel e tente novamente.' });
    if (err.status === 404) return json(res, 404, { error: 'O arquivo ou branch configurado não foi encontrado no repositório.' });
    if (err.status === 401 || err.status === 403) return json(res, 502, { error: 'O GitHub recusou a credencial ou a permissão de escrita configurada para publicação.' });
    return json(res, 502, { error: `Falha ao publicar no GitHub: ${err.message}` });
  }
};
