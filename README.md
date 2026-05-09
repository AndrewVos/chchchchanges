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

Package a macOS DMG:

```bash
bun run dist:mac
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

GitHub OAuth uses the hosted broker for browser login.

1. In GitHub OAuth App, use callback URL `https://YOUR_HOST/api/github/callback`.
2. Set hosted environment variables:
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
   - `OAUTH_STATE_SECRET`
3. In desktop app config, set `VITE_GITHUB_BROKER_URL=https://YOUR_HOST`.
4. Click `Connect GitHub`. The app opens your system browser, broker exchanges the code, then redirects back to `chchchchanges://oauth/github`.

Requested scopes: `repo read:user`.

Do not ship `GITHUB_CLIENT_SECRET` in the desktop app.

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

## Release

Releases are built by GitHub Actions from version tags.

1. Update `version` in `package.json`.
2. Commit and push the change.
3. Tag the commit and push the tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The `Release desktop app` workflow builds `release/Chchchchanges-<version>-mac-universal.dmg`, publishes it to the
GitHub Release, calculates its SHA-256 checksum, validates the cask syntax, and updates `Casks/chchchchanges.rb` on
`main`.

Users can install from this repository as a Homebrew tap:

```bash
brew tap AndrewVos/chchchchanges https://github.com/AndrewVos/chchchchanges
brew install --cask chchchchanges
```

For a conventional tap, create `AndrewVos/homebrew-chchchchanges` and add a `HOMEBREW_TAP_TOKEN` repository secret with
push access to that tap. Future releases will sync `Casks/chchchchanges.rb` there automatically, and users can install
with:

```bash
brew tap AndrewVos/chchchchanges
brew install --cask chchchchanges
```

Once the conventional tap exists, users can also install in one command:

```bash
brew install --cask AndrewVos/chchchchanges/chchchchanges
```

The current desktop build is unsigned and not notarized. If macOS blocks the first launch after Homebrew installs it:

```bash
xattr -dr com.apple.quarantine /Applications/Chchchchanges.app
```
