/**
 * Pure helpers for pi-statusbar cache display (issue #5): accumulate prompt
 * cache usage from session entries and derive the hit rate pi's built-in
 * footer reports.
 *
 * Mirrors pi's official implementation (dist/modes/interactive/components/
 * footer.js + dist/core/cache-stats.js):
 *   - pi's usage.input EXCLUDES cache tokens; total prompt =
 *     input + cacheRead + cacheWrite.
 *   - Hit rate is per-request and shown for the LATEST assistant message only
 *     (a live health signal), while R/W totals accumulate over the session.
 *   - toolResult usage (nested LLM calls) and compaction/branch_summary usage
 *     also count toward totals.
 * Minimal structural types keep this file dependency-free (esbuild-bundleable),
 * matching lib/inject-stamp.ts and lib/remote-slug.ts.
 */

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

/** Minimal structural subset of pi's SessionEntry union (message, compaction,
 * branch_summary). Extra fields are ignored. */
export interface SessionEntryLike {
	type?: string;
	message?: {
		role?: string;
		usage?: UsageLike;
	};
	/** Direct usage on compaction / branch_summary entries. */
	usage?: UsageLike;
}

/** Accumulated usage totals, zero-initialized. */
export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Sum of usage.cost.total over all counted entries (USD). */
	costTotal: number;
}

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

export function createUsageTotals(): UsageTotals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costTotal: 0 };
}

/** Add one usage record into totals; missing/undefined fields count as 0. */
export function addUsage(totals: UsageTotals, usage: UsageLike | undefined): void {
	if (!usage) return;
	totals.input += usage.input ?? 0;
	totals.output += usage.output ?? 0;
	totals.cacheRead += usage.cacheRead ?? 0;
	totals.cacheWrite += usage.cacheWrite ?? 0;
	totals.costTotal += usage.cost?.total ?? 0;
}

/**
 * Accumulate usage across all session entries, following pi's footer rules:
 * assistant messages always (usage is required there), toolResult messages
 * and compaction/branch_summary entries only when they carry usage.
 */
export function collectUsage(entries: readonly SessionEntryLike[]): UsageTotals {
	const totals = createUsageTotals();
	for (const entry of entries) {
		if (entry.type === "message" && entry.message) {
			const role = entry.message.role;
			if (role === "assistant") {
				addUsage(totals, entry.message.usage);
			} else if (role === "toolResult" && entry.message.usage) {
				addUsage(totals, entry.message.usage);
			}
		} else if (
			(entry.type === "branch_summary" || entry.type === "compaction") &&
			entry.usage
		) {
			addUsage(totals, entry.usage);
		}
	}
	return totals;
}

/**
 * One pass over the entries: session-wide usage totals plus the LATEST
 * assistant request's hit rate (pi's official CH semantics — the last
 * message's rate reflects the cache's health right now, while a session
 * average would dilute recent breakage). Hit-rate formula:
 *   cacheRead / (input + cacheRead + cacheWrite) * 100
 * cacheWrite counts in the denominator: writing is not a read hit.
 */
export function cacheSummary(entries: readonly SessionEntryLike[]): CacheSummary {
	const totals = createUsageTotals();
	let hitRate: number | undefined;
	for (const entry of entries) {
		if (entry.type === "message" && entry.message) {
			const role = entry.message.role;
			if (role === "assistant") {
				addUsage(totals, entry.message.usage);
				const usage = entry.message.usage;
				const promptTokens = usage
					? (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
					: 0;
				// Overwrite every time (official behavior): the surviving value
				// belongs to the last assistant message.
				hitRate =
					promptTokens > 0 ? ((usage?.cacheRead ?? 0) / promptTokens) * 100 : undefined;
			} else if (role === "toolResult" && entry.message.usage) {
				addUsage(totals, entry.message.usage);
			}
		} else if (
			(entry.type === "branch_summary" || entry.type === "compaction") &&
			entry.usage
		) {
			addUsage(totals, entry.usage);
		}
	}
	return { totals, hitRate, costTotal: totals.costTotal };
}

/**
 * Format token counts for compact footer display — identical thresholds to
 * pi's built-in footer (dist/modes/interactive/components/footer.js).
 */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/**
 * Format an accumulated USD cost for the footer. Two decimals always
 * (toFixed(2)); cny multiplies by the user-configured manual rate.
 */
export function formatCost(costUsd: number, currency: "usd" | "cny", rate: number): string {
	const value = currency === "cny" ? costUsd * rate : costUsd;
	return `${currency === "cny" ? "¥" : "$"}${value.toFixed(2)}`;
}
