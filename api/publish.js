const { session, json, sameOrigin } = require('../lib/security');

const GH = 'https://api.github.com';
const OWNER = 'fisa67';
const REPO = 'cv-digital';
const PROFILE_PATH = 'profile.json';
const PHOTO_PATH = 'uploads/profile.jpg';
const PROJECT_IMAGE_RE = /^uploads\/projects\/[A-Za-z0-9_-]{1,64}\.jpg$/;
const MAX_IMAGES_PER_REQUEST = 8;
const MAX_PROJECTS = 200;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function validJpeg(base64) {
  if (typeof base64 !== 'string' || !BASE64_RE.test(base64)) return false;
  const bytes = Buffer.from(base64, 'base64');
  return bytes.length >= 4 && bytes.length <= 3_000_000 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

// Projetos são opcionais; quando existem, só aceitamos imagens em uploads/projects/ ou URLs https.
function validProjects(projects) {
  if (projects === undefined) return true;
  if (!projects || typeof projects !== 'object' || Array.isArray(projects) || !Array.isArray(projects.items) || projects.items.length > MAX_PROJECTS) return false;
  return projects.items.every(item => item && typeof item === 'object' &&
    (item.image === undefined || item.image === '' || (typeof item.image === 'string' && (PROJECT_IMAGE_RE.test(item.image) || /^https:\/\//i.test(item.image)))));
}

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
  const hasProfile = profile !== undefined && profile !== null;
  if (hasProfile && (!validProfile(profile) || !validProjects(profile.projects))) return json(res, 400, { error: 'Os dados recebidos não parecem um profile.json válido.' });
  const profileText = hasProfile ? JSON.stringify(profile, null, 2) + '\n' : null;
  if (profileText && Buffer.byteLength(profileText) > 1_000_000) return json(res, 413, { error: 'O profile.json excede o tamanho permitido.' });

  const photo = body && body.photo;
  let photoBase64 = null;
  if (photo !== undefined && photo !== null) {
    if (!photo || photo.contentType !== 'image/jpeg' || !validJpeg(photo.base64)) return json(res, 400, { error: 'A foto deve ser enviada em base64 como JPEG (até 3 MB).' });
    photoBase64 = photo.base64;
  }

  // Imagens de projetos: podem vir sozinhas (lotes enviados antes do profile.json).
  const images = [];
  const rawImages = body && body.images;
  if (rawImages !== undefined && rawImages !== null) {
    if (!Array.isArray(rawImages) || rawImages.length === 0 || rawImages.length > MAX_IMAGES_PER_REQUEST) return json(res, 400, { error: `Envie de 1 a ${MAX_IMAGES_PER_REQUEST} imagens por requisição.` });
    for (const image of rawImages) {
      if (!image || image.contentType !== 'image/jpeg' || typeof image.path !== 'string' || !PROJECT_IMAGE_RE.test(image.path) || !validJpeg(image.base64)) return json(res, 400, { error: 'Cada imagem de projeto deve ser um JPEG de até 3 MB em uploads/projects/.' });
      if (images.some(other => other.path === image.path)) return json(res, 400, { error: 'Há imagens repetidas na requisição.' });
      images.push({ path: image.path, base64: image.base64 });
    }
  }
  if (!hasProfile && !photoBase64 && !images.length) return json(res, 400, { error: 'Nada para publicar.' });

  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(branch) || branch.includes('..') || branch.startsWith('/') || branch.endsWith('/')) return json(res, 500, { error: 'GITHUB_BRANCH contém um nome inválido.' });
  const basePath = `/repos/${OWNER}/${REPO}/contents/`;
  const ref = `?ref=${encodeURIComponent(branch)}`;
  const completedFiles = [];
  try {
    const now = new Date().toISOString();
    const message = `Atualiza currículo pelo painel (${now})`;
    const shaOf = async (path, optional) => {
      try { return (await github(token, `${basePath}${path}${ref}`)).sha; }
      catch (err) { if (optional && err.status === 404) return undefined; throw err; }
    };
    // Ordem de gravação: imagens, foto e, por último, o profile.json,
    // para o site nunca apontar para um arquivo que ainda não existe.
    const updates = [];
    for (const image of images) updates.push({ path: image.path, sha: await shaOf(image.path, true), content: image.base64 });
    if (photoBase64) updates.push({ path: PHOTO_PATH, sha: await shaOf(PHOTO_PATH, false), content: photoBase64 });
    if (hasProfile) updates.push({ path: PROFILE_PATH, sha: await shaOf(PROFILE_PATH, false), content: Buffer.from(profileText).toString('base64') });

    const results = [];
    for (const file of updates) {
      const result = await github(token, `${basePath}${file.path}`, { method: 'PUT', body: JSON.stringify({
        message, content: file.content, ...(file.sha ? { sha: file.sha } : {}), branch
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
