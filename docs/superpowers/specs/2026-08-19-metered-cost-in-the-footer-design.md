# Spec: Metered API cost in the footer (USD/CNY) — issue #2

Status: draft, pending user review.

## Problem

pi-statusbar shows session activity but not how much the session costs.
Users on pay-per-token providers (DeepSeek official API) want a running
total in the footer; subscription providers (zai-coding-cn GLM coding
plan, ollama cloud) must stay silent.

## Verification scope (important)

The cost-accumulation rule below is **provider-agnostic**: it sums
`usage.cost.total` over all entries regardless of provider. However,
**all real-session verification data was measured with a single metered
API — DeepSeek official API** (`deepseek-v4-flash` / `deepseek-v4-pro`),
because that is the only pay-per-token provider in the user's
environment. Subscription providers contribute zero by construction (pi
records their cost as 0), so the accumulated value equals the DeepSeek
spend in practice. Future metered providers with a cost table in pi will
be counted automatically with no code change.

## Decisions

1. **Generic accumulation, no provider list.** Sum `usage.cost.total`
   across session entries using the exact scan rules of the existing
   `cacheSummary()` (assistant always; toolResult / compaction /
   branch_summary when they carry usage). Render only when the total is
   > 0. Sessions that only used subscription providers show nothing
   (no `$0.00` noise). No provider names are hardcoded.
2. **Two currency modes, manually configured:**
   - `usd` (default) — pi's native cost unit, zero config needed.
   - `cny` — convert with a user-supplied rate (default `7.2` CNY per
     1 USD). Rate is a manual config value, NOT fetched from any API
     (no network dependency, no privacy concern). Stale rate is
     accepted; user updates it via `/statusbar config rate`.
3. **Formatting: always two decimals**, symbol `$` for usd and `¥` for
   cny, rendered dim. JS `toFixed(2)` rounding.
4. **Config**: extend the existing runtime config file
   `~/.pi/agent/extensions/pi-statusbar.json` to
   `{ userHost?, currency?: "usd" | "cny", cnyRate?: number }`.
   Same file, same convention as pi-recap's JSON config.
5. **Config UX**: subcommands.
   - `/statusbar config` — unchanged (sets user@host).
   - `/statusbar config currency` — native `ctx.ui.select` dialog with
     current value in the title, options `usd` / `cny`.
   - `/statusbar config rate` — `ctx.ui.input` dialog with current
     value in the title; invalid input is rejected with a warning.
   Saving any of these re-renders the footer immediately via the
   existing `requestFooterRender` hook.
6. **Extract `lib/config.ts`**: the config read/write functions
   currently inline in `index.ts` move into a pure, dependency-free
   module with defensive parsing, so the new currency/rate fields get
   unit tests (previously an open "optional" item in issue #1
   follow-up). Config is read once at extension load; manual JSON edits
   need `/reload`, same as today.

## Data foundation (verified)

- Every assistant usage in pi carries
  `cost: { input, output, cacheRead, cacheWrite, total }` (USD),
  computed from pi's built-in per-model price tables. Verified against
  the type definitions in `@earendil-works/pi-coding-agent` and real
  session JSONL files.
- Real session (jfox repo, 2026-08-12): 20 zai-coding-cn assistant
  entries with `cost.total: 0`, then 8 deepseek-v4-flash entries with
  real values (0.0001–0.0021). Summing all entries yields exactly the
  DeepSeek spend.
- Mid-session model switching attributes correctly: each entry is
  stamped with its own provider/model.

## Components

### `lib/cache-stats.ts` (pure, no deps)

- `UsageLike` gains optional
  `cost?: { input?; output?; cacheRead?; cacheWrite?; total?: number }`.
- `UsageTotals` gains `costTotal: number` (zero-initialized in
  `createUsageTotals()`).
- `addUsage()` also accumulates `usage.cost?.total ?? 0`.
- `cacheSummary()` returns `{ totals, hitRate, costTotal }`; cost is
  accumulated in the same single pass, scan rules unchanged.
- New `formatCost(costUsd: number, currency: "usd" | "cny", rate:
  number): string`:
  - usd: `` `$${(costUsd).toFixed(2)}` `` — e.g. `$0.02`, `$1.24`.
  - cny: `` `¥${(costUsd * rate).toFixed(2)}` `` — e.g. `¥0.14`.
  - Two decimals always (user decision), even for large amounts
    (`$123.45`).
  - Lives next to `formatTokens` (formatting helpers together).

### `lib/config.ts` (new, pure, no deps)

- `DEFAULT_CURRENCY = "usd"`, `DEFAULT_CNY_RATE = 7.2`.
- `interface StatusbarConfig { userHost?: string; currency?: "usd" |
  "cny"; cnyRate?: number }`.
- `parseConfig(raw: string): StatusbarConfig` — JSON.parse + field
  validation: `currency` must be exactly `"usd"` or `"cny"` else
  default; `cnyRate` must be a finite number > 0 else default;
  `userHost` must be a string else undefined. Invalid JSON → `{}`.
- `readConfig(path: string): StatusbarConfig` — missing file → `{}`,
  unreadable → `{}` (never throws).
- `writeConfig(path: string, patch: Partial<StatusbarConfig>): void` —
  merge patch over the current on-disk config, pretty-print JSON with
  trailing newline. Throws on IO failure (caller notifies the user).
- `index.ts` stops using its inline `readConfiguredUserHost` /
  `saveConfiguredUserHost`; config load becomes a single
  `readConfig(CONFIG_PATH)` at startup supplying userHost, currency,
  cnyRate. `resolveUserHost` still receives the configured string.

### `index.ts`

- Module-level `currency` and `cnyRate` loaded at startup, mutable by
  the config commands (same pattern as `userHost` today).
- `render()`: after the cache segment,
  `const costText = costTotal > 0 ? dim(formatCost(costTotal, currency, cnyRate)) : "";`
  and Line 1 right becomes
  `[cache]  [cost]  [datetime]` — cost segment inserted between the
  cache segment and the datetime, two spaces between segments.
- Commands:
  - `/statusbar config` — unchanged.
  - `/statusbar config currency` — `ctx.ui.select("Status bar currency (current: …)", ["usd", "cny"])`; undefined (Esc) → no-op; save; re-render; notify.
  - `/statusbar config rate` — `ctx.ui.input("Status bar CNY rate, CNY per 1 USD (current: 7.2)")`; parse float, must be finite > 0, else warning and keep old value; save; re-render; notify.
  - `/statusbar help` — mention currency/rate.
  - `getArgumentCompletions` — add `currency`, `rate`.
- No changes to line 2, git branch logic, or the cache segment.

## Error handling

| Failure | Behavior |
|---|---|
| Config file missing / unreadable / invalid JSON | defaults (usd, 7.2, auto-detected host), no crash |
| Invalid `currency` value in JSON | fall back to usd |
| Invalid / non-positive `cnyRate` in JSON | fall back to 7.2 |
| Rate dialog: non-numeric / ≤ 0 input | warning notification, keep previous rate |
| Config write fails | error notification, keep previous value |
| Cost absent on all entries | no cost segment rendered |

## Testing

- `test/cache-stats.test.ts` (extend):
  - cost accumulation across assistant entries (mixed providers,
    zero-cost entries contribute nothing);
  - toolResult / compaction / branch_summary with usage accumulate
    cost;
  - `cacheSummary` returns `costTotal` matching `collectUsage`;
  - `formatCost`: usd symbol + 2 decimals, cny symbol + rate
    multiplication, rounding at 2 decimals (e.g. 0.005 boundaries at
    safe float values), zero cost formatting.
- `test/config.test.ts` (new):
  - parse: valid config, invalid JSON, wrong-typed fields, invalid
    currency string, non-positive rate, missing fields;
  - write: merge semantics (patch preserves other fields), output is
    valid JSON.
- `test/run-all.sh` gains a config test invocation (same esbuild
  bundle-and-run pattern).
- Existing tests must stay green (no regression in R/W/CH behavior).

## README

- Features list: add cost display (`$`/`¥`, two decimals, shown only
  when > 0).
- Config section: document `currency`, `cnyRate`, and the two new
  subcommands.
- Note that costs come from pi's built-in price tables and that the
  rule is provider-agnostic (any metered provider counts once pi knows
  its prices); verified against DeepSeek.

## Out of scope

- Per-model cost breakdown in the footer (could be a future
  `/statusbar cost` command).
- Live exchange-rate fetching.
- Custom price overrides in the config file.
