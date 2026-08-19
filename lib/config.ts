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
		userHost: patch.userHost === undefined ? current.userHost : patch.userHost,
		currency: patch.currency ?? current.currency,
		cnyRate: patch.cnyRate ?? current.cnyRate,
	};
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(next, null, 2) + "\n", "utf8");
}
