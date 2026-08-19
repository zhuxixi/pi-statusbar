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
	parseRateInput,
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

// ============ parseRateInput ============
const rateCases: Array<{ raw: string; expect: number | undefined }> = [
	{ raw: "7.2", expect: 7.2 },
	{ raw: "7", expect: 7 },
	{ raw: "0.5", expect: 0.5 },
	{ raw: " 7.2 ", expect: 7.2 },
	{ raw: "", expect: undefined },
	{ raw: "abc", expect: undefined },
	{ raw: "0x10", expect: undefined },
	{ raw: "1e3", expect: undefined },
	{ raw: "-1", expect: undefined },
	{ raw: "0", expect: undefined },
	{ raw: "7.", expect: undefined },
	{ raw: ".5", expect: undefined },
	{ raw: "7.2.1", expect: undefined },
];
for (const { raw, expect } of rateCases) {
	const got = parseRateInput(raw);
	check(`parseRateInput: ${JSON.stringify(raw)} -> ${expect}`, got === expect, `got ${got}`);
}

rmSync(dir, { recursive: true, force: true });

if (failed) {
	console.error(`\n${failed} case group(s) FAILED`);
	process.exit(1);
}
console.log("\nall cases passed");
