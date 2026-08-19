/**
 * Cases for lib/cache-stats.ts — issue #5. Mirrors pi's official footer
 * semantics (verified against dist/modes/interactive/components/footer.js):
 * latest-request hit rate for CH, session-wide accumulation for R/W,
 * toolResult/compaction usage included.
 *
 * Run with (no test framework — zero-dep, bundled by esbuild):
 *   npx esbuild test/cache-stats.test.ts --bundle --format=esm \
 *     --platform=node --outfile=/tmp/cache-stats-test.mjs && node /tmp/cache-stats-test.mjs
 */
import {
	addUsage,
	cacheSummary,
	collectUsage,
	createUsageTotals,
	formatCost,
	formatTokens,
	type SessionEntryLike,
} from "../lib/cache-stats";

let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
	if (cond) {
		console.log(`ok   ${name}`);
	} else {
		failed++;
		console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

// --- entry builders ---
const assistant = (usage: {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
}): SessionEntryLike => ({
	type: "message",
	message: { role: "assistant", usage },
});
const toolResult = (usage?: {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
}): SessionEntryLike => ({
	type: "message",
	message: { role: "toolResult", usage },
});
const user = (): SessionEntryLike => ({
	type: "message",
	message: { role: "user" },
});
const compaction = (usage?: {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
}): SessionEntryLike => ({ type: "compaction", usage });
const branchSummary = (usage?: {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
}): SessionEntryLike => ({ type: "branch_summary", usage });
const other = (): SessionEntryLike => ({ type: "thinking_level_change" });

// ============ collectUsage ============
{
	const totals = collectUsage([]);
	check("collectUsage: empty -> all zero", totals.input === 0 && totals.output === 0 && totals.cacheRead === 0 && totals.cacheWrite === 0);
}
{
	const totals = collectUsage([
		assistant({ input: 1000, cacheRead: 9000, cacheWrite: 500, output: 200 }),
		assistant({ input: 2000, cacheRead: 18000, cacheWrite: 0, output: 400 }),
	]);
	check(
		"collectUsage: assistants accumulate",
		totals.input === 3000 && totals.cacheRead === 27000 && totals.cacheWrite === 500 && totals.output === 600,
		JSON.stringify(totals),
	);
}
{
	const totals = collectUsage([
		toolResult({ input: 100, output: 50 }),
		toolResult(),
	]);
	check(
		"collectUsage: toolResult with usage counts, without usage skipped",
		totals.input === 100 && totals.output === 50,
		JSON.stringify(totals),
	);
}
{
	const totals = collectUsage([
		compaction({ input: 300, output: 30 }),
		branchSummary({ input: 400, output: 40 }),
		compaction(),
	]);
	check(
		"collectUsage: compaction/branch_summary with usage counts, without skipped",
		totals.input === 700 && totals.output === 70,
		JSON.stringify(totals),
	);
}
{
	const totals = collectUsage([
		user(),
		other(),
		assistant({ input: 100, cacheRead: 0, cacheWrite: 0 }),
	]);
	check(
		"collectUsage: user/other types ignored",
		totals.input === 100 && totals.cacheRead === 0,
		JSON.stringify(totals),
	);
}
{
	const totals = createUsageTotals();
	addUsage(totals, { input: 10, cacheRead: 20, cacheWrite: 30, output: 40 });
	addUsage(totals, undefined);
	addUsage(totals, {});
	check(
		"addUsage: partial + undefined + empty are safe",
		totals.input === 10 && totals.cacheRead === 20 && totals.cacheWrite === 30 && totals.output === 40,
		JSON.stringify(totals),
	);
}

// ============ cacheSummary hitRate ============
{
	const { totals, hitRate } = cacheSummary([
		assistant({ input: 1000, cacheRead: 9000 }),
		assistant({ input: 500, cacheRead: 4500 }),
	]);
	check(
		"cacheSummary: uses LAST assistant (90% both here)",
		hitRate === 90,
		`got ${hitRate}`,
	);
	check(
		"cacheSummary: totals match collectUsage",
		JSON.stringify(totals) === JSON.stringify(collectUsage([assistant({ input: 1000, cacheRead: 9000 }), assistant({ input: 500, cacheRead: 4500 })])),
		JSON.stringify(totals),
	);
}
{
	// First request 90% hit, last request 50% hit -> must report 50, not 90.
	const { hitRate } = cacheSummary([
		assistant({ input: 1000, cacheRead: 9000 }),
		assistant({ input: 5000, cacheRead: 5000 }),
	]);
	check(
		"cacheSummary: recent breakage not diluted by history",
		hitRate === 50,
		`got ${hitRate}`,
	);
}
{
	const { hitRate } = cacheSummary([
		user(),
		other(),
		assistant({ input: 100, cacheRead: 900, cacheWrite: 0 }),
	]);
	check("cacheSummary: 90% with cacheWrite in formula", hitRate === 90, `got ${hitRate}`);
}
{
	const { hitRate } = cacheSummary([
		assistant({ input: 100, cacheRead: 100, cacheWrite: 100 }),
	]);
	// prompt = 300, cacheRead = 100 -> 33.33...%
	check(
		"cacheSummary: cacheWrite counts in denominator (official)",
		hitRate !== undefined && Math.abs(hitRate - 100 / 3) < 1e-9,
		`got ${hitRate}`,
	);
}
{
	const { hitRate } = cacheSummary([user(), other()]);
	check("cacheSummary: no assistant -> undefined", hitRate === undefined, `got ${hitRate}`);
}
{
	const { hitRate } = cacheSummary([]);
	check("cacheSummary: empty -> undefined", hitRate === undefined, `got ${hitRate}`);
}
{
	const { hitRate } = cacheSummary([assistant({ input: 0, cacheRead: 0, cacheWrite: 0 })]);
	check("cacheSummary: zero prompt -> undefined", hitRate === undefined, `got ${hitRate}`);
}
{
	const { hitRate } = cacheSummary([assistant({ input: 1000, cacheRead: 0 })]);
	check("cacheSummary: no cache read -> 0", hitRate === 0, `got ${hitRate}`);
}
{
	// A zero-prompt assistant overwrites the previous hit rate with undefined
	// (official footer behavior).
	const { hitRate } = cacheSummary([
		assistant({ input: 1000, cacheRead: 9000 }),
		assistant({ input: 0, cacheRead: 0, cacheWrite: 0 }),
	]);
	check("cacheSummary: zero-prompt last overwrites to undefined", hitRate === undefined, `got ${hitRate}`);
}

// ============ formatTokens (pi footer thresholds) ============
const fmtCases: Array<{ n: number; expect: string }> = [
	{ n: 0, expect: "0" },
	{ n: 999, expect: "999" },
	{ n: 1000, expect: "1.0k" },
	{ n: 9999, expect: "10.0k" },
	{ n: 10000, expect: "10k" },
	{ n: 999999, expect: "1000k" },
	{ n: 1000000, expect: "1.0M" },
	{ n: 9999999, expect: "10.0M" },
	{ n: 10000000, expect: "10M" },
];
for (const { n, expect } of fmtCases) {
	const got = formatTokens(n);
	check(`formatTokens: ${n} -> ${expect}`, got === expect, `got ${got}`);
}

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
	// Malformed cost.total must never concatenate into a string costTotal
	// (which would break toFixed in formatCost): numeric strings coerce to
	// numbers, non-finite values are ignored.
	const totals = createUsageTotals();
	addUsage(totals, { cost: { total: "0.5" as unknown as number } });
	addUsage(totals, { cost: { total: Number.NaN } });
	addUsage(totals, { cost: { total: 0.25 } });
	check(
		"addUsage: numeric-string cost coerces, non-finite ignored",
		typeof totals.costTotal === "number" && Math.abs(totals.costTotal - 0.75) < 1e-12,
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

if (failed) {
	console.error(`\n${failed} case group(s) FAILED`);
	process.exit(1);
}
console.log("\nall cases passed");
