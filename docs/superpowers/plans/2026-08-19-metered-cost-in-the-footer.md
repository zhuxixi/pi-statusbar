# Metered Cost in the Footer (USD/CNY) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the session's accumulated metered API cost on footer Line 1 (`$X.XX` / `¥X.XX`, two decimals, dim), configurable between USD and a manual-rate CNY, hidden when pi recorded zero cost.

**Architecture:** Cost accumulation rides the existing one-pass `cacheSummary()` scan in `lib/cache-stats.ts` (provider-agnostic: sum `usage.cost.total`, show only when > 0). A new `lib/config.ts` owns read/validate/write of `~/.pi/agent/extensions/pi-statusbar.json` with new `currency`/`cnyRate` fields. `index.ts` renders the segment and exposes `/statusbar config currency` (ctx.ui.select) and `/statusbar config rate` (ctx.ui.input) subcommands.

**Tech Stack:** TypeScript, zero runtime deps; tests are plain node scripts bundled by esbuild and run via `./test/run-all.sh`.

## Global Constraints

- Zero third-party dependencies: new modules import node builtins only (`node:fs` / `node:path` in `lib/config.ts`).
- Style: tab indentation, English code comments, double-quoted strings — match the existing `lib/` files.
- Currency values: `"usd"` (default) and `"cny"` are the ONLY accepted currency strings, verbatim.
- Default CNY rate: `7.2` (CNY per 1 USD). A valid rate is a finite number > 0.
- Cost formatting: always exactly two decimals via `toFixed(2)`, symbol `$` (usd) or `¥` (cny), rendered with the `dim` theme color.
- Footer cost segment renders only when accumulated `cost.total` > 0; zero-cost sessions show nothing (no `$0.00`).
- Existing R/W/CH cache behavior and all existing tests must not regress.
- All work happens in the worktree `issue-2-show-metered-api-cost-in-the-footer`; every task ends with a commit on that branch (conventional commits).
- Test command for the whole suite: `./test/run-all.sh` — must pass at the end of every task.
- Do not modify: `lib/remote-slug.ts`, `lib/statusline.ts`, `package.json`, `LICENSE`.

---

### Task 1: lib/config.ts — validated config read/write

**Files:**
- Create: `lib/config.ts`
- Create: `test/config.test.ts`

**Interfaces:**
- Produces: `DEFAULT_CURRENCY: "usd"`, `DEFAULT_CNY_RATE: number` (7.2), `interface StatusbarConfig { userHost?: string; currency: "usd" | "cny"; cnyRate: number }`, `emptyConfig(): StatusbarConfig`, `parseConfig(raw: string): StatusbarConfig`, `readConfig(path: string): StatusbarConfig`, `writeConfig(path: string, patch: Partial<StatusbarConfig>): void`. `run-all.sh` picks up `test/config.test.ts` automatically (it globs `test/*.test.ts` — no change needed there).

- [ ] **Step 1: Create `lib/config.ts`**

```ts
/**
 * Runtime config for pi-statusbar (~/.pi/agent/extensions/pi-statusbar.json).
 * Owns reading, validation, and writing of the config file; index.ts keeps
 * the in-memory copy and passes patches down. Only node builtins are used,
 * matching the other lib/ modules (zero third-party deps).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_CURRENCY = "usd" as const;
export const DEFAULT_CNY_RATE = 7.2;

export interface StatusbarConfig {
	/** Saved user@host label; undefined means auto-detect from the OS. */
	userHost?: string;
	/** Cost display currency; always a validated "usd" or "cny". */
	currency: "usd" | "cny";
	/** Manual exchange rate: CNY per 1 USD. */
	cnyRate: number;
}

/** Config with all defaults; userHost undefined triggers auto-detection. */
export function emptyConfig(): StatusbarConfig {
	return { currency: DEFAULT_CURRENCY, cnyRate: DEFAULT_CNY_RATE };
}

/**
 * Parse and validate config JSON. Never throws: invalid JSON, wrong-typed
 * fields, or invalid values each fall back to defaults so the footer always
 * renders.
 */
export function parseConfig(raw: string): StatusbarConfig {
	let obj: unknown;
	try {
		obj = JSON.parse(raw);
	} catch {
		return emptyConfig();
	}
	if (typeof obj !== "object" || obj === null) return emptyConfig();
	const cfg = obj as Record<string, unknown>;
	const out = emptyConfig();
	if (typeof cfg.userHost === "string") out.userHost = cfg.userHost;
	if (cfg.currency === "usd" || cfg.currency === "cny") {
		out.currency = cfg.currency;
	}
	if (typeof cfg.cnyRate === "number" && Number.isFinite(cfg.cnyRate) && cfg.cnyRate > 0) {
		out.cnyRate = cfg.cnyRate;
	}
	return out;
}

/** Read the config file; missing/unreadable/invalid files yield defaults. */
export function readConfig(path: string): StatusbarConfig {
	try {
		if (!existsSync(path)) return emptyConfig();
		return parseConfig(readFileSync(path, "utf8"));
	} catch {
		return emptyConfig();
	}
}

/**
 * Merge `patch` over the on-disk config and write it back (pretty-printed,
 * trailing newline). Creates parent directories. Throws on IO failure so the
 * caller can notify the user.
 */
export function writeConfig(path: string, patch: Partial<StatusbarConfig>): void {
	const current = readConfig(path);
	const next: StatusbarConfig = {
		userHost: patch.userHost !== undefined ? patch.userHost : current.userHost,
		currency: patch.currency ?? current.currency,
		cnyRate: patch.cnyRate ?? current.cnyRate,
	};
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(next, null, 2) + "\n", "utf8");
}
```

- [ ] **Step 2: Create `test/config.test.ts`**

```ts
/**
 * Cases for lib/config.ts — issue #2. Zero-dep node script, bundled by
 * esbuild (see run-all.sh). Exercises parse/read/write against temp files.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_CNY_RATE,
	DEFAULT_CURRENCY,
	parseConfig,
	readConfig,
	writeConfig,
} from "../lib/config";

let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
	if (cond) {
		console.log(`ok   ${name}`);
	} else {
		failed++;
		console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

const dir = mkdtempSync(join(tmpdir(), "pi-statusbar-config-test-"));
const path = join(dir, "pi-statusbar.json");

// ============ parseConfig ============
{
	const cfg = parseConfig(`{"userHost":"alice@workstation","currency":"cny","cnyRate":7.3}`);
	check(
		"parseConfig: valid fields round-trip",
		cfg.userHost === "alice@workstation" && cfg.currency === "cny" && cfg.cnyRate === 7.3,
		JSON.stringify(cfg),
	);
}
{
	const cfg = parseConfig("{}");
	check(
		"parseConfig: empty object -> defaults",
		cfg.userHost === undefined && cfg.currency === DEFAULT_CURRENCY && cfg.cnyRate === DEFAULT_CNY_RATE,
		JSON.stringify(cfg),
	);
}
{
	const cfg = parseConfig("not json");
	check("parseConfig: invalid JSON -> defaults", cfg.currency === "usd" && cfg.cnyRate === 7.2, JSON.stringify(cfg));
}
{
	const cfg = parseConfig(`{"userHost":123,"currency":"eur","cnyRate":-1}`);
	check(
		"parseConfig: wrong types fall back",
		cfg.userHost === undefined && cfg.currency === "usd" && cfg.cnyRate === DEFAULT_CNY_RATE,
		JSON.stringify(cfg),
	);
}
{
	const cfg = parseConfig(`{"cnyRate":"7.2"}`);
	check("parseConfig: string rate rejected", cfg.cnyRate === DEFAULT_CNY_RATE, JSON.stringify(cfg));
}
{
	const cfg = parseConfig(`{"cnyRate":0}`);
	check("parseConfig: zero rate rejected", cfg.cnyRate === DEFAULT_CNY_RATE, JSON.stringify(cfg));
}
{
	const cfg = parseConfig("null");
	check("parseConfig: null -> defaults", cfg.currency === "usd", JSON.stringify(cfg));
}
{
	const cfg = parseConfig(`{"userHost":"  "}`);
	check(
		"parseConfig: whitespace userHost kept for resolveUserHost trim",
		cfg.userHost === "  ",
		JSON.stringify(cfg),
	);
}

// ============ readConfig ============
{
	const cfg = readConfig(join(dir, "missing.json"));
	check(
		"readConfig: missing file -> defaults",
		cfg.userHost === undefined && cfg.currency === "usd" && cfg.cnyRate === DEFAULT_CNY_RATE,
		JSON.stringify(cfg),
	);
}
{
	writeFileSync(path, "{broken");
	const cfg = readConfig(path);
	check("readConfig: invalid file -> defaults", cfg.currency === "usd", JSON.stringify(cfg));
}
{
	writeFileSync(path, `{"userHost":"bob@pc","currency":"cny","cnyRate":7.1}`);
	const cfg = readConfig(path);
	check(
		"readConfig: valid file -> values",
		cfg.userHost === "bob@pc" && cfg.currency === "cny" && cfg.cnyRate === 7.1,
		JSON.stringify(cfg),
	);
}

// ============ writeConfig ============
{
	writeConfig(join(dir, "nested", "cfg.json"), { userHost: "carol@dev" });
	const raw = readFileSync(join(dir, "nested", "cfg.json"), "utf8");
	const parsed = JSON.parse(raw);
	check(
		"writeConfig: creates parent dirs + userHost patch",
		parsed.userHost === "carol@dev" && parsed.currency === "usd" && parsed.cnyRate === DEFAULT_CNY_RATE,
		raw,
	);
	check("writeConfig: trailing newline", raw.endsWith("\n"));
}
{
	writeConfig(path, { userHost: "dave@dev" });
	writeConfig(path, { currency: "usd" });
	const cfg = readConfig(path);
	check(
		"writeConfig: patch merges, other fields preserved",
		cfg.userHost === "dave@dev" && cfg.currency === "usd" && cfg.cnyRate === 7.1,
		JSON.stringify(cfg),
	);
}

rmSync(dir, { recursive: true, force: true });

if (failed) {
	console.error(`\n${failed} case group(s) FAILED`);
	process.exit(1);
}
console.log("\nall cases passed");
```

- [ ] **Step 3: Run the suite — new test must pass**

Run: `./test/run-all.sh`
Expected: config tests all `ok`, suite exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/config.ts test/config.test.ts
git commit -m "feat: add validated config module for userHost/currency/cnyRate"
```

---

### Task 2: lib/cache-stats.ts — cost accumulation + formatCost

**Files:**
- Modify: `lib/cache-stats.ts`
- Modify: `test/cache-stats.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `interface CostLike { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number }`, `UsageLike.cost?: CostLike`, `UsageTotals.costTotal: number`, `CacheSummary.costTotal: number`, `formatCost(costUsd: number, currency: "usd" | "cny", rate: number): string`.

- [ ] **Step 1: Modify `lib/cache-stats.ts`** — apply these three edits:

Edit A — extend `UsageLike` (insert `CostLike` above it):

```ts
/** Minimal structural subset of a per-request cost breakdown (USD). */
export interface CostLike {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	total?: number;
}

/** Minimal structural subset of pi-ai's Usage. */
export interface UsageLike {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: CostLike;
}
```

Edit B — add `costTotal` to `UsageTotals`, `createUsageTotals`, `addUsage`:

```ts
/** Accumulated usage totals, zero-initialized. */
export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Sum of usage.cost.total over all counted entries (USD). */
	costTotal: number;
}
```

```ts
export function createUsageTotals(): UsageTotals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costTotal: 0 };
}
```

```ts
export function addUsage(totals: UsageTotals, usage: UsageLike | undefined): void {
	if (!usage) return;
	totals.input += usage.input ?? 0;
	totals.output += usage.output ?? 0;
	totals.cacheRead += usage.cacheRead ?? 0;
	totals.cacheWrite += usage.cacheWrite ?? 0;
	totals.costTotal += usage.cost?.total ?? 0;
}
```

Edit C — `CacheSummary` gains `costTotal`; `cacheSummary()` returns it; add `formatCost` at the end of the file:

```ts
/** One-pass scan result for footer rendering: session-wide totals plus the
 * latest request's cache hit rate and the accumulated metered cost. */
export interface CacheSummary {
	totals: UsageTotals;
	/** Percent, or undefined when no assistant message with a non-zero
	 * prompt exists. 0 means the latest request had no cache reads. */
	hitRate: number | undefined;
	/** Sum of usage.cost.total across the session (USD). */
	costTotal: number;
}
```

In `cacheSummary()`, change only the return statement:

```ts
	return { totals, hitRate, costTotal: totals.costTotal };
```

Append after `formatTokens`:

```ts
/**
 * Format an accumulated USD cost for the footer. Two decimals always
 * (toFixed(2)); cny multiplies by the user-configured manual rate.
 */
export function formatCost(costUsd: number, currency: "usd" | "cny", rate: number): string {
	const value = currency === "cny" ? costUsd * rate : costUsd;
	return `${currency === "cny" ? "¥" : "$"}${value.toFixed(2)}`;
}
```

- [ ] **Step 2: Extend `test/cache-stats.test.ts`** — add `cost` to the entry-builder parameter types and add two test sections before the final `if (failed)` block.

Edit A — widen the builder signatures (all four builders get the same extra optional field). Replace the four builder function signatures' parameter type

```ts
{
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
}
```

with

```ts
{
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
}
```

(in `assistant`, `toolResult`, `compaction`, `branchSummary` — same type in all four).

Edit B — append two sections (before the `if (failed)` block):

```ts
// ============ cost accumulation ============
{
	const totals = collectUsage([
		assistant({ input: 100, cost: { total: 0.0207 } }),
		assistant({ input: 200, cost: { total: 0.0001 } }),
	]);
	check(
		"collectUsage: cost.total accumulates",
		Math.abs(totals.costTotal - 0.0208) < 1e-12,
		JSON.stringify(totals),
	);
}
{
	const totals = collectUsage([
		assistant({ input: 100, cost: { total: 0 } }),
		assistant({ input: 200, cost: { total: 0 } }),
	]);
	check("collectUsage: zero costs stay zero", totals.costTotal === 0, JSON.stringify(totals));
}
{
	const totals = collectUsage([
		toolResult({ input: 50, cost: { total: 0.001 } }),
		compaction({ input: 300, cost: { total: 0.002 } }),
	]);
	check(
		"collectUsage: toolResult/compaction cost counts",
		Math.abs(totals.costTotal - 0.003) < 1e-12,
		JSON.stringify(totals),
	);
}
{
	const totals = createUsageTotals();
	addUsage(totals, { cost: { total: 0.005 } });
	addUsage(totals, { input: 10 });
	check(
		"addUsage: cost-only and cost-less usage are safe",
		Math.abs(totals.costTotal - 0.005) < 1e-12 && totals.input === 10,
		JSON.stringify(totals),
	);
}
{
	const { costTotal, totals } = cacheSummary([
		assistant({ input: 1000, cacheRead: 9000, cost: { total: 0.0207 } }),
		assistant({ input: 500, cacheRead: 4500, cost: { total: 0.0001 } }),
	]);
	check(
		"cacheSummary: costTotal exposed and matches totals",
		costTotal === totals.costTotal && Math.abs(costTotal - 0.0208) < 1e-12,
		JSON.stringify({ costTotal, totals: totals.costTotal }),
	);
}

// ============ formatCost ============
const costCases: Array<{ usd: number; currency: "usd" | "cny"; rate: number; expect: string }> = [
	{ usd: 0, currency: "usd", rate: 7.2, expect: "$0.00" },
	{ usd: 0.02, currency: "usd", rate: 7.2, expect: "$0.02" },
	{ usd: 1.234, currency: "usd", rate: 7.2, expect: "$1.23" },
	{ usd: 1.236, currency: "usd", rate: 7.2, expect: "$1.24" },
	{ usd: 123.456, currency: "usd", rate: 7.2, expect: "$123.46" },
	{ usd: 0.02, currency: "cny", rate: 7.2, expect: "¥0.14" },
	{ usd: 1, currency: "cny", rate: 7.2, expect: "¥7.20" },
	{ usd: 2.5, currency: "cny", rate: 7.1, expect: "¥17.75" },
];
for (const { usd, currency, rate, expect } of costCases) {
	const got = formatCost(usd, currency, rate);
	check(`formatCost: $${usd} ${currency}@${rate} -> ${expect}`, got === expect, `got ${got}`);
}
```

Also add `formatCost` to the import list at the top of the test file:

```ts
import {
	addUsage,
	cacheSummary,
	collectUsage,
	createUsageTotals,
	formatCost,
	formatTokens,
	type SessionEntryLike,
} from "../lib/cache-stats";
```

- [ ] **Step 3: Run the suite — all tests pass, old cache tests unregressed**

Run: `./test/run-all.sh`
Expected: all test files green, exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/cache-stats.ts test/cache-stats.test.ts
git commit -m "feat: accumulate metered cost and add formatCost helper"
```

---

### Task 3: index.ts — render cost segment + config subcommands

**Files:**
- Modify: `index.ts`

**Interfaces:**
- Consumes (Task 1): `readConfig`, `writeConfig` from `./lib/config`; (Task 2): `formatCost` from `./lib/cache-stats`.
- Produces: footer Line 1 renders the cost segment (`$`/`¥`, dim, two decimals) when `costTotal > 0`; commands `/statusbar config currency`, `/statusbar config rate`; unchanged `/statusbar config` (userHost) behavior.

- [ ] **Step 1: Update imports and header doc**

Edit A — imports:

```ts
import { execSync } from "node:child_process";
import { homedir, hostname, userInfo } from "node:os";
import { join } from "node:path";
```

(remove `existsSync, mkdirSync, readFileSync, writeFileSync` from node:fs and `dirname` from node:path — the inline config functions below are deleted)

Edit B — cache-stats import line gains `formatCost`:

```ts
import { cacheSummary, formatCost, formatTokens, type SessionEntryLike } from "./lib/cache-stats";
```

Edit C — new config import after the cache-stats import:

```ts
import { readConfig, writeConfig } from "./lib/config";
```

Edit D — header layout line and fields doc:

```ts
 *   <user>@<host>  ~/project  <session title>      R6.7M CH99.9% $0.02  2026-08-07 23:25
```

and after the `R/W/CH` fields bullet add:

```ts
 *   cost        : accumulated metered API cost of the session — sum of
 *                 usage.cost.total over all entries (provider-agnostic;
 *                 subscription providers record 0 and add nothing). Shown
 *                 as $X.XX (usd) or ¥X.XX (cny, manual rate), always two
 *                 decimals, dim, only when the total is > 0.
```

- [ ] **Step 2: Replace the inline config functions with module config**

Delete `readConfiguredUserHost` and `saveConfiguredUserHost` (both whole functions, including their comments) and replace this block:

```ts
// Resolved at load: saved value wins, otherwise auto-detect username@hostname.
let userHost = resolveUserHost(readConfiguredUserHost(), userInfo().username, hostname());
```

with:

```ts
// Resolved at load: saved value wins, otherwise auto-detect username@hostname.
// currency/cnyRate also load once; /statusbar config * subcommands update them.
const initialConfig = readConfig(CONFIG_PATH);
let userHost = resolveUserHost(initialConfig.userHost, userInfo().username, hostname());
let currency: "usd" | "cny" = initialConfig.currency;
let cnyRate = initialConfig.cnyRate;
```

- [ ] **Step 3: Render the cost segment**

Replace:

```ts
					const { totals: cacheTotals, hitRate } = cacheSummary(entries);
					let cacheText = "";
```

with:

```ts
					const { totals: cacheTotals, hitRate, costTotal } = cacheSummary(entries);
					let cacheText = "";
```

After the cache-text block (after the closing `}` of `if (cacheTotals.cacheRead > 0 ...)`), add:

```ts
					const costText =
						costTotal > 0 ? dim(formatCost(costTotal, currency, cnyRate)) : "";
```

Replace:

```ts
					const l1Right = (cacheText ? cacheText + "  " : "") + timeColored;
```

with:

```ts
					const l1Right =
						(cacheText ? cacheText + "  " : "") + (costText ? costText + "  " : "") + timeColored;
```

- [ ] **Step 4: Add the two config subcommands**

Replace the argument completions block:

```ts
		getArgumentCompletions: () => [
			{ value: "config", label: "config", description: "Set the user@host label" },
			{ value: "help", label: "help", description: "Show statusbar commands" },
		],
```

with:

```ts
		getArgumentCompletions: () => [
			{ value: "config", label: "config", description: "Set the user@host label" },
			{ value: "config currency", label: "config currency", description: "Set the cost currency (usd/cny)" },
			{ value: "config rate", label: "config rate", description: "Set the CNY rate (CNY per 1 USD)" },
			{ value: "help", label: "help", description: "Show statusbar commands" },
		],
```

Replace the handler opening:

```ts
		handler: async (args, ctx) => {
			const action = args.trim().split(/\s+/u)[0]?.toLowerCase() ?? "";
			if (action === "config") {
				if (!ctx.hasUI) {
					ctx.ui.notify("Status bar configuration needs an interactive UI.", "error");
					return;
				}
				// pi's built-in input dialog ignores its placeholder argument, so
				// surface the current value in the title instead (input starts empty).
				const value = await ctx.ui.input(`Status bar user@host (current: ${userHost})`);
				if (value === undefined) return; // cancelled with Esc
				const trimmed = value.trim();
				if (!trimmed) {
					ctx.ui.notify("Status bar host unchanged: empty value.", "warning");
					return;
				}
				try {
					saveConfiguredUserHost(trimmed);
				} catch (err) {
					ctx.ui.notify(`Failed to save status bar config: ${err}`, "error");
					return;
				}
				userHost = trimmed;
				ctx.ui.notify(`Status bar host set to ${trimmed}.`, "info");
				requestFooterRender?.();
				return;
			}
```

with:

```ts
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/u);
			const action = parts[0]?.toLowerCase() ?? "";
			const sub = parts[1]?.toLowerCase() ?? "";
			if (action === "config" && sub === "currency") {
				if (!ctx.hasUI) {
					ctx.ui.notify("Status bar configuration needs an interactive UI.", "error");
					return;
				}
				// Native selector; current value surfaced in the title.
				const value = await ctx.ui.select(`Status bar cost currency (current: ${currency})`, [
					"usd",
					"cny",
				]);
				if (value === undefined) return; // cancelled with Esc
				try {
					writeConfig(CONFIG_PATH, { currency: value as "usd" | "cny" });
				} catch (err) {
					ctx.ui.notify(`Failed to save status bar config: ${err}`, "error");
					return;
				}
				currency = value as "usd" | "cny";
				ctx.ui.notify(`Status bar cost currency set to ${currency}.`, "info");
				requestFooterRender?.();
				return;
			}
			if (action === "config" && sub === "rate") {
				if (!ctx.hasUI) {
					ctx.ui.notify("Status bar configuration needs an interactive UI.", "error");
					return;
				}
				// pi's built-in input dialog ignores its placeholder argument, so
				// surface the current value in the title instead (input starts empty).
				const value = await ctx.ui.input(`Status bar CNY rate, CNY per 1 USD (current: ${cnyRate})`);
				if (value === undefined) return; // cancelled with Esc
				const parsed = Number(value.trim());
				if (value.trim() === "" || !Number.isFinite(parsed) || parsed <= 0) {
					ctx.ui.notify("Status bar rate unchanged: enter a positive number (e.g. 7.2).", "warning");
					return;
				}
				try {
					writeConfig(CONFIG_PATH, { cnyRate: parsed });
				} catch (err) {
					ctx.ui.notify(`Failed to save status bar config: ${err}`, "error");
					return;
				}
				cnyRate = parsed;
				ctx.ui.notify(`Status bar CNY rate set to ${parsed}.`, "info");
				requestFooterRender?.();
				return;
			}
			if (action === "config" && !sub) {
				if (!ctx.hasUI) {
					ctx.ui.notify("Status bar configuration needs an interactive UI.", "error");
					return;
				}
				// pi's built-in input dialog ignores its placeholder argument, so
				// surface the current value in the title instead (input starts empty).
				const value = await ctx.ui.input(`Status bar user@host (current: ${userHost})`);
				if (value === undefined) return; // cancelled with Esc
				const trimmed = value.trim();
				if (!trimmed) {
					ctx.ui.notify("Status bar host unchanged: empty value.", "warning");
					return;
				}
				try {
					writeConfig(CONFIG_PATH, { userHost: trimmed });
				} catch (err) {
					ctx.ui.notify(`Failed to save status bar config: ${err}`, "error");
					return;
				}
				userHost = trimmed;
				ctx.ui.notify(`Status bar host set to ${trimmed}.`, "info");
				requestFooterRender?.();
				return;
			}
```

Replace the help branch:

```ts
			if (action === "help") {
				ctx.ui.notify(
					"Status bar commands: /statusbar (show current host) · /statusbar config (set user@host label)",
					"info",
				);
				return;
			}
```

with:

```ts
			if (action === "help") {
				ctx.ui.notify(
					"Status bar commands: /statusbar (show current host) · /statusbar config (set user@host) · /statusbar config currency (usd/cny) · /statusbar config rate (CNY per 1 USD)",
					"info",
				);
				return;
			}
```

- [ ] **Step 5: Compile check + full suite**

Run: `npx esbuild index.ts --bundle --format=esm --platform=node --external:@earendil-works/pi-coding-agent --external:@earendil-works/pi-tui --outfile=/dev/null --log-level=warning`
Expected: no output, exit 0 (TS compiles, local imports resolve).

Run: `./test/run-all.sh`
Expected: all test files green, exit 0.

- [ ] **Step 6: Commit**

```bash
git add index.ts
git commit -m "feat: render metered cost in footer with usd/cny config commands"
```

---

### Task 4: README.md — document cost display and config

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing code-wise; documents Tasks 1-3 behavior.

- [ ] **Step 1: Update the sample layout line**

Replace:

```
<user>@<host>  ~/project  <session title>      R6.7M CH99.9%  2026-08-07 23:25
```

with:

```
<user>@<host>  ~/project  <session title>      R6.7M CH99.9% $0.02  2026-08-07 23:25
```

- [ ] **Step 2: Update the Features bullet for Line 1**

Replace:

```markdown
- **Line 1**: `user@host` label, current working directory (`$HOME` shortened to `~`), session title, prompt-cache stats (`R` reads / `W` writes / `CH` latest-request hit rate), live clock with minute precision.
```

with:

```markdown
- **Line 1**: `user@host` label, current working directory (`$HOME` shortened to `~`), session title, prompt-cache stats (`R` reads / `W` writes / `CH` latest-request hit rate), accumulated metered API cost (`$X.XX` / `¥X.XX`, two decimals, shown only when > 0), live clock with minute precision.
```

- [ ] **Step 3: Extend the Configuration section**

Replace the whole "## Configuration" section body (from `The `user@host` label is...` through the last config bullet) with:

```markdown
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
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document cost display and currency config"
```

- [ ] **Step 5: Final suite run**

Run: `./test/run-all.sh`
Expected: all green, exit 0.
