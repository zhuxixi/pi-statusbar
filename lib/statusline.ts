/**
 * Pure formatting helpers for cc-statusline. Zero pi dependency — unit-tested
 * via esbuild+node (test/statusline.test.ts). The extension entry
 * (cc-statusline.ts) wires these into pi's footer render loop, passing the
 * machine-dependent values (home dir, current time) and pi-tui's width
 * functions in as parameters.
 */

// pi default reserveTokens (settings.json compaction.reserveTokens). Adjust if customized.
const RESERVE_TOKENS = 16384;

// Theme ships a dedicated color per thinking level (thinkingOff..thinkingMax).
// Map level -> ThemeColor so effort color shifts with intensity; unknown -> accent.
export type ThinkColor =
	| "thinkingMinimal"
	| "thinkingLow"
	| "thinkingMedium"
	| "thinkingHigh"
	| "thinkingXhigh"
	| "thinkingMax";
const THINK_COLORS: Record<string, ThinkColor> = {
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
};

export function thinkColor(level: string): ThinkColor | "accent" {
	return THINK_COLORS[level] ?? "accent";
}

export function shortCwd(cwd: string, home: string): string {
	if (cwd === home) return "~";
	if (cwd.startsWith(home + "/")) return "~" + cwd.slice(home.length);
	return cwd;
}

export function pad(n: number): string {
	return n < 10 ? "0" + n : String(n);
}

/** Deterministic clock formatting; the entry passes `new Date()`. */
export function clockStr(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function modelName(id: string | undefined): string {
	if (!id) return "no-model";
	// Strip ollama tag suffix (e.g. "glm-5.2:cloud" -> "glm-5.2")
	return id.includes(":") ? id.slice(0, id.lastIndexOf(":")) : id;
}

// auto-rename titles look like "owner/repo: core goal | issue#N PR#N". The cwd
// already shows the directory, so drop the leading "owner/repo: " repo prefix
// (identified by a "/" before the first ": ") and keep the rest.
export function stripRepoPrefix(title: string): string {
	const idx = title.indexOf(": ");
	if (idx > 0 && title.slice(0, idx).includes("/")) {
		return title.slice(idx + 2);
	}
	return title;
}

// Compaction trigger percentage for the given context window.
export function triggerPct(ctxWindow: number | undefined, reserveTokens: number = RESERVE_TOKENS): number {
	const w = ctxWindow && ctxWindow > 0 ? ctxWindow : 128000;
	return ((w - reserveTokens) / w) * 100;
}

// Resolve the user@host label shown at the left of the status bar's first
// line. A value saved via /statusbar config wins; otherwise fall back to
// auto-detection from the OS. Blank/whitespace-only configured values are
// treated as missing.
export function resolveUserHost(configured: string | undefined, username: string, host: string): string {
	const trimmed = configured?.trim();
	return trimmed ? trimmed : `${username}@${host}`;
}

// Join a left-aligned block and a right-aligned block on one terminal line.
// Pads between them so `right` sits at the far right; when the two don't both
// fit, the right side is truncated (rare on wide terminals).
// `measure`/`truncate` are injected — the entry passes pi-tui's visibleWidth /
// truncateToWidth so this module stays pi-free and unit-testable.
export function hjoin(
	left: string,
	right: string,
	width: number,
	measure: (s: string) => number,
	truncate: (s: string, w: number) => string,
): string {
	const gap = Math.max(0, width - measure(left) - measure(right));
	return truncate(left + " ".repeat(gap) + right, width);
}
