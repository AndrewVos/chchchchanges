# Chchchchanges

Review GitHub and Bitbucket pull requests from one desktop app, with a focused PR list, unified diffs, syntax highlighting, and inline review comments.

## Install

```bash
brew tap AndrewVos/chchchchanges https://github.com/AndrewVos/chchchchanges
brew install --cask chchchchanges
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

## What is included

- GitHub and Bitbucket provider adapter model in `src/providers.ts`
- Pull request sidebar with provider filtering and search
- Changed-file rail and unified diff viewer
- Syntax highlighting with `highlight.js`
- Inline code comments routed through provider-specific `publishComment`
