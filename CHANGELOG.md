# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-20

First public release, published to npm as `@zhuxixi/pi-statusbar`.

### Added

- Two-line footer: `user@host` + cwd + session title on line 1, git
  remote/branch + provider + model + thinking-effort + context usage on
  line 2.
- Prompt-cache stats (`R` reads / `W` writes / `CH` latest-request hit rate)
  with the same semantics as pi's built-in footer.
- Accumulated metered API cost with `usd`/`cny` display and a manual CNY
  exchange rate.
- `/statusbar config` command to set a custom `user@host` label
  (`/statusbar config currency` and `/statusbar config rate` for cost
  display settings).
- Adaptive context-usage colors that track the model's context window and
  pi's compaction trigger.
- Dependency-free unit tests run through esbuild (`./test/run-all.sh`).
- `package.json` pi manifest so the extension installs via
  `pi install npm:@zhuxixi/pi-statusbar`.
