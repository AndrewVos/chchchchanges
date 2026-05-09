# Chchchchanges

Desktop pull request review app scaffolded with Bun, Electron, Vite, React, and TypeScript.

## Run

```bash
bun install
cp .env.example .env
bun run dev
```

Renderer-only preview:

```bash
bun run dev:renderer
```

Build:

```bash
bun run build
```

## What is included

- GitHub and Bitbucket provider adapter model in `src/providers.ts`
- Pull request sidebar with provider filtering and search
- Changed-file rail and unified diff viewer
- Syntax highlighting with `highlight.js`
- Inline code comments routed through provider-specific `publishComment`

## OAuth setup

The app shows demo PRs until you connect accounts.

### GitHub

1. Create a GitHub OAuth App.
2. Use callback URL `http://127.0.0.1/callback`.
3. Enable Device Flow for that app.
4. Put the OAuth app client ID in `.env` as `VITE_GITHUB_CLIENT_ID`.
5. Click `Connect GitHub`. The app opens your system browser and shows a device code.

Requested scopes: `repo read:user`.

GitHub uses device flow so the public desktop app only needs a client ID and never ships a client secret.

### Bitbucket

Bitbucket Cloud requires a client secret for OAuth code exchange, so public desktop builds use a hosted broker.

1. Deploy this repo to Vercel or another Node host.
2. Set hosted environment variables:
   - `BITBUCKET_CLIENT_ID`
   - `BITBUCKET_CLIENT_SECRET`
   - `OAUTH_STATE_SECRET`
3. In Bitbucket OAuth consumer, use callback URL `https://YOUR_HOST/api/bitbucket/callback`.
4. In desktop app config, set `VITE_BITBUCKET_BROKER_URL=https://YOUR_HOST`.
5. Click `Connect Bitbucket`. The app opens your system browser, broker exchanges the code, then redirects back to `chchchchanges://oauth/bitbucket`.

Do not ship `BITBUCKET_CLIENT_SECRET` in the desktop app.
