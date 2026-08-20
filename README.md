# pi-statusbar

[![npm version](https://img.shields.io/npm/v/@zhuxixi/pi-statusbar)](https://www.npmjs.com/package/@zhuxixi/pi-statusbar)
[![license](https://img.shields.io/github/license/zhuxixi/pi-statusbar)](./LICENSE)

A two-line status bar (footer) extension for [pi](https://github.com/earendil-works/pi-coding-agent).

```
<user>@<host>  ~/project  <session title>      R6.7M CH99.9% $0.02  2026-08-07 23:25
owner/repo | git:(main)                        (provider) model • effort • ctx:N%
```

## Features

- **Line 1**: `user@host` label, current working directory (`$HOME` shortened to `~`), session title, prompt-cache stats (`R` reads / `W` writes / `CH` latest-request hit rate), accumulated metered API cost (`$X.XX` / `¥X.XX`, two decimals, shown only when > 0), live clock with minute precision.
- **Line 2**: git remote slug (`owner/repo`, host-agnostic: GitHub/GitLab/Gitea/self-hosted/SSH aliases), current branch, provider, model, thinking-effort level, and context-usage percentage.
- **Adaptive colors**: `ctx:N%` thresholds adapt to the model's context window and pi's compaction trigger (`contextWindow - reserveTokens`); each thinking level gets its own theme color.
- **Zero dependencies beyond pi itself**: pure formatting logic lives in `lib/` and is unit-tested without a test framework.

## Installation

Install from npm (recommended):

```bash
pi install npm:@zhuxixi/pi-statusbar
```

Then run `/reload` in pi (no restart needed).

Alternative — clone the repository into a subdirectory of pi's global extensions dir:

```bash
git clone https://github.com/zhuxixi/pi-statusbar.git ~/.pi/agent/extensions/pi-statusbar
```

## Configuration

The `user@host` label is auto-detected from the OS (`username@hostname`) by default. To set a custom value, run:

```
/statusbar config
```

This opens a text-input dialog showing the current value in its title. Type the new label, Enter saves, Esc cancels. The saved value takes effect immediately and survives `/reload` and restarts.

The footer also shows the session's accumulated API cost when pi recorded any (pay-per-token providers with prices in pi's built-in price tables, e.g. DeepSeek). Subscription providers record zero cost and show nothing. The rule is provider-agnostic: any provider whose costs pi knows counts automatically.

- `/statusbar config currency` — pick `usd` (default, pi's native unit) or `cny`
- `/statusbar config rate` — set the manual CNY exchange rate (CNY per 1 USD, default `7.2`; not fetched from any API, update it whenever you want)

- Config file: `~/.pi/agent/extensions/pi-statusbar.json` (created automatically, per machine)
- Format: `{ "userHost": "alice@workstation", "currency": "cny", "cnyRate": 7.2 }`
- Delete the file to fall back to defaults. If you edit the file by hand, run `/reload` to apply (config is read once at extension load).

## Development

Tests use esbuild to bundle each `test/*.test.ts` and run it with node — no test framework, no `package.json` required:

```bash
./test/run-all.sh
```

## License

[MIT](./LICENSE)
