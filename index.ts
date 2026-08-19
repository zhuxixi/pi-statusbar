/**
 * cc-statusline — Claude Code 风格的底部状态栏（footer），两行布局
 *
 * Layout (two lines, left/right aligned):
 *   <user>@<host>  ~/project  <session title>      R6.7M CH99.9%  2026-08-07 23:25
 *   owner/repo | git:(main)                        (provider) model • effort • ctx:N%
 *
 * Line 1 — left: user@host + cwd + <session title>;  right: cache + datetime
 * Line 2 — left: git remote | git:(branch);  right: (provider) model • effort • ctx:N%
 *
 * Fields:
 *   user@host   : /statusbar config, auto-detected (username@hostname) by default
 *   cwd         : ctx.cwd, $HOME shortened to ~
 *   <title>     : pi.getSessionName() in angle brackets, only when set;
 *                 the leading "owner/repo: " prefix is stripped (cwd already shows it)
 *   datetime    : local time, minute precision (re-renders per minute), right-aligned
 *   git remote  : owner/repo from `git remote get-url origin` (cached per cwd)
 *   git:(branch): footerData.getGitBranch()
 *   (provider)  : ctx.model.provider, in parentheses before the model
 *   model       : ctx.model.id (ollama ":tag" stripped)
 *   effort      : ctx.thinkingLevel after "•"; hidden when "off"
 *   ctx:N%      : ctx.getContextUsage().percent (2 decimals)
 *   R/W/CH      : prompt cache, official pi footer semantics (issue #5) —
 *                 R=session cache reads, W=session cache writes, CH=hit rate
 *                 of the LATEST request (cacheRead / (input + cacheRead +
 *                 cacheWrite)); shown left of the datetime on Line 1,
 *                 hidden when no cache activity was ever reported (local
 *                 models, providers without caching)
 *
 * Colors (light-warm palette): cwd/ctx-normal = text(dark), title = accent(teal),
 * git branch = success(green), provider = border(blue), model = accent(teal),
 * effort = per-level thinking* color, metadata = dim(gray). ctx:% thresholds adapt
 * to the model's context window and pi's compaction trigger
 * (contextWindow - reserveTokens, default reserveTokens 16384):
 *   < 70% of trigger  -> text (normal)
 *   70–90% of trigger -> warning (amber)
 *   >= 90% of trigger -> error (red, compaction imminent)
 *
 * Auto-discovered from ~/.pi/agent/extensions/. Hot-reload with /reload.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { cacheSummary, formatTokens, type SessionEntryLike } from "./lib/cache-stats";
import { slugFromRemoteUrl } from "./lib/remote-slug";
import {
	clockStr,
	hjoin,
	modelName,
	resolveUserHost,
	shortCwd,
	stripRepoPrefix,
	thinkColor,
	triggerPct,
} from "./lib/statusline";

// Per-machine runtime config, written by /statusbar config:
//   { "userHost": "alice@workstation" }
// Lives next to the extension dir (same convention as pi-recap.json).
const CONFIG_PATH = join(homedir(), ".pi", "agent", "extensions", "pi-statusbar.json");

function readConfiguredUserHost(): string | undefined {
	try {
		if (!existsSync(CONFIG_PATH)) return undefined;
		const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as { userHost?: unknown };
		return typeof raw.userHost === "string" ? raw.userHost : undefined;
	} catch {
		return undefined; // unreadable/invalid config: fall back to auto-detection
	}
}

function saveConfiguredUserHost(value: string): void {
	mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	writeFileSync(CONFIG_PATH, JSON.stringify({ userHost: value }, null, 2) + "\n", "utf8");
}

// Resolved at load: saved value wins, otherwise auto-detect username@hostname.
let userHost = resolveUserHost(readConfiguredUserHost(), userInfo().username, hostname());

// Captured when the footer registers so /statusbar config can re-render line 1
// immediately after saving, without waiting for the next minute tick.
let requestFooterRender: (() => void) | null = null;

const HOME = homedir();

// Thin runtime wrapper: pure formatting lives in lib/statusline.ts (clockStr).
function nowStr(): string {
	return clockStr(new Date());
}

// Cache owner/repo slug per cwd to avoid spawning git on every render.
// Parsing (host-agnostic: GitHub/GitLab/Gitea/self-hosted/SSH alias) lives in
// lib/remote-slug.ts so it can be unit-tested without pi's runtime.
let slugKey = "";
let slugVal = "";
function remoteSlug(cwd: string): string {
	if (cwd === slugKey) return slugVal;
	slugKey = cwd;
	let slug = "";
	try {
		const url = execSync(`git -C "${cwd}" remote get-url origin`, {
			encoding: "utf8",
			timeout: 1500,
		}).trim();
		slug = slugFromRemoteUrl(url);
	} catch {
		slug = "";
	}
	slugVal = slug;
	return slug;
}

// Join a left-aligned block and a right-aligned block on one terminal line.
// Pads between them so `right` sits at the far right; when the two don't both
// fit, the right side is truncated (rare on wide terminals).
// Pure logic lives in lib/statusline.ts; pi-tui's width functions are injected.
function joinLine(left: string, right: string, width: number): string {
	return hjoin(left, right, width, visibleWidth, truncateToWidth);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
			requestFooterRender = () => tui.requestRender();
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());

			// Re-render when the thinking effort level or session name changes.
			pi.on("thinking_level_select", () => tui.requestRender());
			pi.on("session_info_changed", () => tui.requestRender());

			// Re-render when the displayed minute changes.
			let lastMin = "";
			const interval = setInterval(() => {
				const cur = nowStr().slice(-5); // HH:MM
				if (cur !== lastMin) {
					lastMin = cur;
					tui.requestRender();
				}
			}, 1000);

			return {
				dispose() {
					unsubBranch();
					clearInterval(interval);
					if (requestFooterRender) requestFooterRender = null;
				},
				invalidate() {},
				render(width: number): string[] {
					const dim = (s: string) => theme.fg("dim", s);
					const text = (s: string) => theme.fg("text", s);
					const accent = (s: string) => theme.fg("accent", s);
					const success = (s: string) => theme.fg("success", s);
					const warn = (s: string) => theme.fg("warning", s);
					const err = (s: string) => theme.fg("error", s);
					const blue = (s: string) => theme.fg("border", s);

					const branch = footerData.getGitBranch();
					const usage = ctx.getContextUsage();
					const ctxWindow = ctx.model?.contextWindow;
					const name = pi.getSessionName();

					// thinkingLevel is a *property* on ExtensionContext (pi >= 0.84); fall back to the
					// getThinkingLevel() method on ExtensionAPI for older builds — never crash on mismatch.
					const cc = ctx as unknown as {
						thinkingLevel?: string;
						getThinkingLevel?: () => string | undefined;
					};
					const thinking =
						cc.thinkingLevel ??
						(typeof cc.getThinkingLevel === "function" ? cc.getThinkingLevel() : undefined);

					// ---- cache segment: R/W totals + CH (latest-request hit rate) ----
					// Official pi footer semantics (issue #5): R/W accumulate over the
					// session; CH is the LATEST request's hit rate, so cache breakage
					// (system-prompt churn, idle > TTL, model switch) shows immediately
					// instead of being diluted by history. Shown left of the datetime on
					// Line 1; hidden when the session never reported cache activity.
					const entries = ctx.sessionManager.getEntries() as unknown as readonly SessionEntryLike[];
					const { totals: cacheTotals, hitRate } = cacheSummary(entries);
					let cacheText = "";
					if (cacheTotals.cacheRead > 0 || cacheTotals.cacheWrite > 0) {
						const parts: string[] = [];
						if (cacheTotals.cacheRead > 0) parts.push(`R${formatTokens(cacheTotals.cacheRead)}`);
						if (cacheTotals.cacheWrite > 0) parts.push(`W${formatTokens(cacheTotals.cacheWrite)}`);
						if (hitRate !== undefined) parts.push(`CH${hitRate.toFixed(1)}%`);
						cacheText = dim(parts.join(" "));
					}

					// ---- Line 1: [user@host  cwd  <title>]  ........  [cache  time] ----
					let l1Left = `${dim(userHost)}  ${text(shortCwd(ctx.cwd, HOME))}`;
					if (name) l1Left += `  ${accent(`<${stripRepoPrefix(name).toLowerCase()}>`)}`;
					// Date stays dim (rarely changes); the live HH:MM gets a warm amber accent
					// that stays readable on a light/white theme.
					const ts = nowStr();
					const tsSplit = ts.lastIndexOf(" ");
					const timeColored = dim(ts.slice(0, tsSplit)) + " " + warn(ts.slice(tsSplit + 1));
					const l1Right = (cacheText ? cacheText + "  " : "") + timeColored;
					const line1 = joinLine(l1Left, l1Right, width);

					// ---- Line 2 left: [slug | git:(branch)] ----
					let l2Left = "";
					if (branch) {
						const slug = remoteSlug(ctx.cwd);
						l2Left = [slug ? dim(slug) : "", success(`git:(${branch})`)]
							.filter(Boolean)
							.join(" | ");
					}

					// ---- Line 2 right: [(provider) model • effort • ctx:N%] ----
					const provider = ctx.model?.provider;
					let l2Right = (provider ? blue(`(${provider}) `) : "") + accent(modelName(ctx.model?.id));
					if (thinking && thinking !== "off") {
						l2Right += dim(" • ") + theme.fg(thinkColor(thinking), thinking);
					}
					const pct = usage && typeof usage.percent === "number" ? usage.percent : null;
					const trigger = triggerPct(ctxWindow);
					const ctxText = `ctx:${pct === null ? "-" : pct.toFixed(2)}%`;
					const ctxColored =
						pct === null
							? dim(ctxText)
							: pct >= trigger * 0.9
								? err(ctxText)
								: pct >= trigger * 0.7
									? warn(ctxText)
									: text(ctxText);
					l2Right += dim(" • ") + ctxColored;

					const line2 = joinLine(l2Left, l2Right, width);

					return [line1, line2];
				},
			};
		});
	});

	pi.registerCommand("statusbar", {
		description: "Configure the status bar",
		getArgumentCompletions: () => [
			{ value: "config", label: "config", description: "Set the user@host label" },
			{ value: "help", label: "help", description: "Show statusbar commands" },
		],
		handler: async (args, ctx) => {
			const action = args.trim().split(/\s+/u)[0]?.toLowerCase() ?? "";
			if (action === "config") {
				if (!ctx.hasUI) {
					ctx.ui.notify("Status bar configuration needs an interactive UI.", "error");
					return;
				}
				const value = await ctx.ui.input("Status bar user@host label", userHost);
				if (value === undefined) return; // cancelled with Esc
				const trimmed = value.trim();
				if (!trimmed) {
					ctx.ui.notify("Status bar host unchanged: empty value.", "warning");
					return;
				}
				saveConfiguredUserHost(trimmed);
				userHost = trimmed;
				ctx.ui.notify(`Status bar host set to ${trimmed}.`, "info");
				requestFooterRender?.();
				return;
			}
			ctx.ui.notify(`Status bar host: ${userHost}. Use /statusbar config to change it.`, "info");
		},
	});
}
