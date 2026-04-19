# skila

Self-improving skill inventory controller for Claude Code: distill sessions into versioned skills, evolve them via feedback, and manage everything from a local web control panel.

> **Status: Phase 1 (skeleton).** The npm + plugin + smithery distribution surface is wired and `npm pack` is self-contained (web vendor assets are bundled at build time via esbuild + tailwindcss — no CDN). Real subcommand behaviour lands in Phases 2–5.

## Install

### npm (global CLI)

```sh
npm i -g @yao/skila
skila --help
```

### Claude Code plugin marketplace

```sh
/plugin marketplace add yao/skila
/plugin install skila@skila
```

The plugin auto-registers the `/skila` slash command plus PostToolUse + Stop hooks for feedback collection — zero post-install configuration.

### Smithery (MCP)

```sh
npx -y @yao/skila mcp
```

Smithery deploys it as an ephemeral, read-only MCP server (mutation commands are disabled in this transport — see Decision D5 in the implementation plan).

## Quick start

```sh
# inside Claude Code
/skila                         # distill the current session into NEW/UPDATE proposals

# from a terminal
skila serve                    # open the web control panel on http://127.0.0.1:7777
skila list                     # list skills grouped by status
skila inspect <name>           # show a skill (optionally --version v0.X.Y)
```

## Web control panel

`skila serve` starts a single-file UI on `127.0.0.1:7777` (auto-increments on conflict). Three-pane Obsidian-style workspace: sidebar (filter / search / skills) → center (CodeMirror 6 SKILL.md editor) → inspector (versions / feedback / actions).

> Screenshot placeholder — captured during Phase 3 visual gate (AC18 ≥ 7/10).

## License

MIT © yao 2026
