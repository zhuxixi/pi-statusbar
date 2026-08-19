/**
 * Parameterized cases for lib/statusline.ts — issue #6.
 * hjoin is tested with stub measure/truncate (lib stays pi-tui-free; the entry
 * injects pi-tui's visibleWidth/truncateToWidth at the wiring layer).
 *
 * Run with (no test framework — zero-dep, bundled by esbuild):
 *   npx esbuild test/statusline.test.ts --bundle --format=esm \
 *     --platform=node --outfile=/tmp/statusline-test.mjs && node /tmp/statusline-test.mjs
 */
import {
	clockStr,
	hjoin,
	modelName,
	pad,
	resolveUserHost,
	shortCwd,
	stripRepoPrefix,
	thinkColor,
	triggerPct,
} from "../lib/statusline";

let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
	if (cond) {
		console.log(`ok   ${name}`);
	} else {
		failed++;
		console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
	}
}
function eq(name: string, got: unknown, expect: unknown): void {
	check(name, got === expect, `got ${JSON.stringify(got)}, expected ${JSON.stringify(expect)}`);
}

// ---- shortCwd (home injected — no dependence on the test machine) ----
const HOME = "/home/dev";
eq("shortCwd home itself", shortCwd("/home/dev", HOME), "~");
eq("shortCwd subdir", shortCwd("/home/dev/proj/x", HOME), "~/proj/x");
eq("shortCwd outside home untouched", shortCwd("/etc/nginx", HOME), "/etc/nginx");
eq("shortCwd prefix lookalike untouched", shortCwd("/home/dev2/x", HOME), "/home/dev2/x");

// ---- pad ----
eq("pad 0", pad(0), "00");
eq("pad 9", pad(9), "09");
eq("pad 10", pad(10), "10");

// ---- clockStr (deterministic Date) ----
eq("clockStr zero-pads", clockStr(new Date(2026, 0, 5, 9, 7)), "2026-01-05 09:07");
eq("clockStr no pad needed", clockStr(new Date(2026, 11, 25, 23, 59)), "2026-12-25 23:59");

// ---- modelName ----
eq("modelName undefined", modelName(undefined), "no-model");
eq("modelName empty", modelName(""), "no-model");
eq("modelName plain", modelName("glm-5.2"), "glm-5.2");
eq("modelName ollama tag", modelName("glm-5.2:cloud"), "glm-5.2");
eq("modelName multi-colon strips last only", modelName("a:b:c"), "a:b");

// ---- stripRepoPrefix ----
eq("stripRepoPrefix repo title", stripRepoPrefix("owner/repo: core goal"), "core goal");
eq("stripRepoPrefix keeps rest after first ': '", stripRepoPrefix("owner/repo: a: b"), "a: b");
eq("stripRepoPrefix no slash keeps title", stripRepoPrefix("Fix: login"), "Fix: login");
eq("stripRepoPrefix no colon-space", stripRepoPrefix("plain title"), "plain title");
eq("stripRepoPrefix empty", stripRepoPrefix(""), "");

// ---- triggerPct ----
const approx = (name: string, got: number, expect: number) =>
	check(name, Math.abs(got - expect) < 1e-9, `got ${got}, expected ${expect}`);
approx("triggerPct 128k default", triggerPct(128000), ((128000 - 16384) / 128000) * 100);
approx("triggerPct undefined -> 128k default", triggerPct(undefined), triggerPct(128000));
approx("triggerPct 0 -> 128k default", triggerPct(0), triggerPct(128000));
approx("triggerPct 200k", triggerPct(200000), ((200000 - 16384) / 200000) * 100);
approx("triggerPct custom reserve", triggerPct(100000, 10000), 90);

// ---- thinkColor ----
eq("thinkColor high", thinkColor("high"), "thinkingHigh");
eq("thinkColor max", thinkColor("max"), "thinkingMax");
eq("thinkColor unknown -> accent", thinkColor("turbo"), "accent");
eq("thinkColor off -> accent", thinkColor("off"), "accent");

// ---- hjoin with stub width functions (ASCII semantics) ----
const measure = (s: string) => s.length;
const truncate = (s: string, w: number) => s.slice(0, w);
eq("hjoin pads gap", hjoin("ab", "cd", 6, measure, truncate), "ab  cd");
eq("hjoin exact fit", hjoin("ab", "cd", 4, measure, truncate), "abcd");
eq("hjoin overflow truncates to width", hjoin("left-long", "right-long", 10, measure, truncate), "left-longr");
check(
	"hjoin result never exceeds width",
	hjoin("aaaa", "bbbb", 5, measure, truncate).length <= 5,
);
eq("hjoin empty right", hjoin("ab", "", 5, measure, truncate), "ab   ");

// ---- resolveUserHost: /statusbar config value vs auto-detection ----
eq("resolveUserHost falls back to detection", resolveUserHost(undefined, "alice", "laptop"), "alice@laptop");
eq("resolveUserHost uses configured value", resolveUserHost("bob@server", "alice", "laptop"), "bob@server");
eq("resolveUserHost trims configured value", resolveUserHost("  bob@server  ", "alice", "laptop"), "bob@server");
eq("resolveUserHost rejects blank configured value", resolveUserHost("   ", "alice", "laptop"), "alice@laptop");

if (failed) {
	console.error(`\n${failed} checks FAILED`);
	process.exit(1);
}
console.log("\nall checks passed");
