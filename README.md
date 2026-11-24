# CV Digital

Currículo estático em HTML, CSS e JavaScript. `admin.html` mantém o editor, preview ao vivo, rascunhos, histórico de desfazer e exportação ZIP. `login.html` oferece o acesso OAuth. As funções em `api/` são executadas pela Vercel, sem framework ou dependência adicional.

## Fluxo de autenticação e publicação

1. Abra `https://cv-digital-delta.vercel.app/login.html`. O site GitHub Pages continua servindo o currículo público; as páginas administrativas devem ser acessadas no domínio Vercel, onde a API serverless está disponível.
2. `/api/auth/login` redireciona para o OAuth GitHub com `state` aleatório. `/api/auth/callback` valida state, troca o código no servidor e consulta `/user` no GitHub. Só `fisa67` recebe sessão.
3. A sessão contém apenas login e expiração. Ela é assinada com HMAC-SHA256 usando `SESSION_SECRET`, expira em oito horas e usa cookie HttpOnly, SameSite=Lax e Secure em produção. O access token OAuth é descartado após a consulta da identidade. Nenhum token ou secret vai para localStorage/sessionStorage.
4. `admin.html` consulta `/api/auth/session` antes de carregar `profile.json` ou rascunhos. O endpoint de publicação verifica sessão e origem no servidor.
5. “Publicar alterações” envia o profile atual e, opcionalmente, foto JPEG. `/api/publish` consulta os SHA atuais pela GitHub Contents API e atualiza somente `profile.json` e `uploads/profile.jpg`, na branch definida no servidor por `GITHUB_BRANCH`. A exportação ZIP permanece disponível.

O GitHub Contents API cria um commit por arquivo atualizado. Se a publicação incluir foto, são dois commits sequenciais; os SHA de ambos os arquivos são lidos antes das atualizações. Se o segundo arquivo falhar após o primeiro commit, o endpoint informa a publicação parcial e qual caminho foi atualizado. Se o GitHub detectar conflito, o endpoint retorna erro para recarregar e tentar novamente. O push em `main` atualiza GitHub Pages e inicia o deploy Vercel caso ambos estejam conectados à branch.

## Variáveis da Vercel

As variáveis informadas já estão cadastradas. Confirme que estão disponíveis em Production e Preview:

| Variável | Valor esperado |
| --- | --- |
| `GITHUB_CLIENT_ID` | Client ID do OAuth App |
| `GITHUB_CLIENT_SECRET` | Client Secret do OAuth App |
| `SESSION_SECRET` | 64 caracteres hexadecimais aleatórios (32 bytes) |
| `GITHUB_REPOSITORY` | `fisa67/cv-digital` |
| `GITHUB_BRANCH` | `main` |
| `GITHUB_TOKEN` | Fine-grained PAT com Contents: Read and write somente em `fisa67/cv-digital` |
| `APP_URL` | `https://cv-digital-delta.vercel.app` |

Não use token clássico amplo. As funções não aceitam repositório nem branch no corpo da requisição; o repositório é fixado na API e a branch vem apenas da variável de ambiente. `SESSION_SECRET` é necessário para assinar as sessões e proteger o `state` OAuth.

## OAuth App no GitHub

Em **GitHub → Settings → Developer settings → OAuth Apps**, crie ou edite o OAuth App:

- Homepage URL: `https://cv-digital-delta.vercel.app`
- Authorization callback URL: `https://cv-digital-delta.vercel.app/api/auth/callback`
- Client ID e Client Secret correspondem a `GITHUB_CLIENT_ID` e `GITHUB_CLIENT_SECRET`.

Para `vercel dev`, use um OAuth App de desenvolvimento separado, com callback `http://localhost:3000/api/auth/callback`. Configure as variáveis locais em `.env.local`, sem versionar o arquivo. Em localhost o cookie usa HttpOnly e SameSite=Lax, sem Secure para permitir HTTP local; em Vercel Secure é obrigatório.

## Vercel

O projeto Vercel deve apontar para o repositório `fisa67/cv-digital`, com a raiz contendo `index.html`, `admin.html`, `login.html`, `profile.json` e `api/`, e `main` definida como Production Branch. Não é necessário `vercel.json`, build ou pacote npm. Os handlers Node usam somente APIs integradas do runtime.

## Teste

1. Para testar localmente, instale/use o CLI Vercel, configure `.env.local` e execute `vercel dev`.
2. Acesse `http://localhost:3000/login.html`; faça login com `fisa67`. Uma conta diferente deve ver “Acesso não autorizado”.
3. Edite um campo, verifique o preview e confirme que o rascunho continua ao recarregar. Pressione “Publicar alterações”; o botão mostra carregamento, sucesso ou erro.
4. Para testar publicação sem tocar em produção, configure localmente uma branch de teste em `GITHUB_BRANCH` (ou use um repositório de teste com as mesmas duas rotas de arquivo) e um token fino limitado a esse repositório. Confira o commit e abra o preview Vercel correspondente.

O checkout de desenvolvimento usa `feature/admin-panel`; o botão de publicar usa o valor configurado em `GITHUB_BRANCH`. Não faça um teste real com `main` se não quiser publicar alterações em produção.

## Visibilidade e proteção

O repositório `fisa67/cv-digital` é público. Qualquer pessoa pode ler o código de `admin.html`/`login.html`, `profile.json` e a foto. A autenticação protege a edição no navegador e, principalmente, as rotas mutáveis no backend; não transforma os arquivos públicos em privados. Os secrets e o PAT permanecem nas variáveis da Vercel.
