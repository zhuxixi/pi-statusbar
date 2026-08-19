# pi-statusbar

A Claude Code-style two-line status bar (footer) for [pi](https://github.com/earendil-works/pi-coding-agent).

```
<user>@<host>  ~/project  <session title>      R6.7M CH99.9%  2026-08-07 23:25
owner/repo | git:(main)                        (provider) model • effort • ctx:N%
```

## Features

- **Line 1**: `user@host` label, current working directory (`$HOME` shortened to `~`), session title, prompt-cache stats (`R` reads / `W` writes / `CH` latest-request hit rate), live clock with minute precision.
- **Line 2**: git remote slug (`owner/repo`, host-agnostic: GitHub/GitLab/Gitea/self-hosted/SSH aliases), current branch, provider, model, thinking-effort level, and context-usage percentage.
- **Adaptive colors**: `ctx:N%` thresholds adapt to the model's context window and pi's compaction trigger (`contextWindow - reserveTokens`); each thinking level gets its own theme color.
- **Zero dependencies beyond pi itself**: pure formatting logic lives in `lib/` and is unit-tested without a test framework.

## Installation

Clone this repository into a subdirectory of pi's global extensions dir and hot-reload:

```bash
git clone https://github.com/zhuxixi/pi-statusbar.git ~/.pi/agent/extensions/pi-statusbar
```

Then run `/reload` in pi (no restart needed).

## Configuration

The `user@host` label is auto-detected from the OS (`username@hostname`) by default. To set a custom value, run:

```
/statusbar config
```

This opens a text-input dialog showing the current value in its title. Type the new label, Enter saves, Esc cancels. The saved value takes effect immediately and survives `/reload` and restarts.

- Config file: `~/.pi/agent/extensions/pi-statusbar.json` (created automatically, per machine)
- Format: `{ "userHost": "alice@workstation" }`
- Delete the file to fall back to auto-detection. If you edit the file by hand, run `/reload` to apply (config is read once at extension load).

## Development

Tests use esbuild to bundle each `test/*.test.ts` and run it with node — no test framework, no `package.json` required:

```bash
./test/run-all.sh
```

## License

[MIT](./LICENSE)
