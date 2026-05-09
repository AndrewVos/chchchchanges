# Chchchchanges

Review GitHub and Bitbucket pull requests from one desktop app, with a focused PR list, unified diffs, syntax highlighting, and inline review comments.

## Install

```bash
brew install --cask AndrewVos/tap/chchchchanges
```

The current desktop build is unsigned and not notarized. If macOS blocks the first launch after Homebrew installs it:

```bash
xattr -dr com.apple.quarantine /Applications/Chchchchanges.app
```

## Development

```bash
bun install
cp .env.example .env
bun run dev
```

Start the renderer without Electron:

```bash
bun run dev:renderer
```

Run type-checks and build artifacts:

```bash
bun run build
```

Package a local macOS DMG:

```bash
bun run dist:mac
```

Bump, tag, and push a release:

```bash
bun run release:patch
```
