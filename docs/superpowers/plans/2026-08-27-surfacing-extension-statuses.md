# Surfacing Extension Statuses as a Third Footer Line — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface extension statuses written via `ctx.ui.setStatus()` as an optional third footer line, mirroring pi's built-in footer behavior.

**Architecture:** Pure formatting helpers live in `lib/statusline.ts` (zero pi dependency, unit-tested via esbuild+node). The entry `index.ts` reads `footerData.getExtensionStatuses()` on render and polls the Map every 10s with a snapshot compare to trigger re-renders (pi has no callback for status changes).

**Tech Stack:** TypeScript, pi extension API (`@earendil-works/pi-coding-agent`), pi-tui (`visibleWidth`, `truncateToWidth`), zero-dep test harness (esbuild bundle + node).

## Global Constraints

- All work happens inside the worktree at `/home/elling/git-repo/github/pi-statusbar/.pi/worktrees/issue-5-surfacing-extension-statuses` (branch `issue-5-surfacing-extension-statuses`). Never touch the main checkout.
- Stage files individually with `git add <file>` — never `git add -A`.
- `lib/statusline.ts` stays pi-dependency-free: width functions are injected as parameters (existing pattern).
- Third-line rendering must mirror the built-in footer exactly: sort by key with `localeCompare`, join with a single space, truncate with `truncateToWidth(line, width, theme.fg("dim", "..."))`, preserve ANSI colors embedded in status values (no extra color wrapping).
- Test style: `check(name, cond, detail?)` / `eq(name, got, expect)` helpers, no framework. Run single file: `npx esbuild test/statusline.test.ts --bundle --format=esm --platform=node --outfile=/tmp/statusline-test.mjs && node /tmp/statusline-test.mjs`. Run everything: `bash test/run-all.sh`.
- Commit messages in English, conventional commits format.

---

### Task 1: Pure formatting helpers in lib/statusline.ts

**Files:**
- Modify: `lib/statusline.ts` (append three exports)
- Test: `test/statusline.test.ts` (add imports + test cases)

**Interfaces:**
- Produces:
  - `sanitizeStatusText(text: string): string` — replaces `[\r\n\t]` with a space, collapses multiple spaces to one, trims.
  - `formatExtensionStatuses(statuses: ReadonlyMap<string, string>): string` — sorts entries by key (`localeCompare`), sanitizes each value, joins with a single space; returns `""` for an empty Map.
  - `statusesChanged(prev: ReadonlyMap<string, string>, next: ReadonlyMap<string, string>): boolean` — true when size differs or any key's value differs; false otherwise.

- [ ] **Step 1: Write the failing tests**

Append to `test/statusline.test.ts`. First extend the import at the top of the file:

```ts
import {
	clockStr,
	formatExtensionStatuses,
	hjoin,
	modelName,
	pad,
	resolveUserHost,
	sanitizeStatusText,
	shortCwd,
	statusesChanged,
	stripRepoPrefix,
	thinkColor,
	triggerPct,
} from "../lib/statusline";
```

Then append these cases at the end of the file (before any final summary line; this file has no trailing summary — appending is safe):

```ts
// ---- sanitizeStatusText (mirrors pi built-in footer's sanitizeStatusText) ----
eq("sanitize newline to space", sanitizeStatusText("a\nb"), "a b");
eq("sanitize tab and CR", sanitizeStatusText("a\tb\rc"), "a b c");
eq("sanitize collapses spaces", sanitizeStatusText("a  b   c"), "a b c");
eq("sanitize trims ends", sanitizeStatusText("  x  "), "x");
eq("sanitize clean text unchanged", sanitizeStatusText("🔌 MCP: 7 servers"), "🔌 MCP: 7 servers");

// ---- formatExtensionStatuses ----
eq("formatStatuses empty map", formatExtensionStatuses(new Map()), "");
eq(
	"formatStatuses single entry",
	formatExtensionStatuses(new Map([["mcp", "🔌 MCP: 7 servers"]])),
	"🔌 MCP: 7 servers",
);
eq(
	"formatStatuses sorted by key",
	formatExtensionStatuses(
		new Map([
			["b", "second"],
			["a", "first"],
		]),
	),
	"first second",
);
eq(
	"formatStatuses sanitizes values",
	formatExtensionStatuses(new Map([["k", "a\nb  c"]])),
	"a b c",
);

// ---- statusesChanged ----
eq(
	"statusesChanged identical maps",
	statusesChanged(
		new Map([["a", "x"]]),
		new Map([["a", "x"]]),
	),
	false,
);
eq(
	"statusesChanged value change",
	statusesChanged(
		new Map([["a", "x"]]),
		new Map([["a", "y"]]),
	),
	true,
);
eq(
	"statusesChanged key added",
	statusesChanged(
		new Map([["a", "x"]]),
		new Map([
			["a", "x"],
			["b", "y"],
		]),
	),
	true,
);
eq(
	"statusesChanged key removed",
	statusesChanged(
		new Map([
			["a", "x"],
			["b", "y"],
		]),
		new Map([["a", "x"]]),
	),
	true,
);
eq(
	"statusesChanged insertion order ignored",
	statusesChanged(
		new Map([
			["a", "x"],
			["b", "y"],
		]),
		new Map([
			["b", "y"],
			["a", "x"],
		]),
	),
	false,
);
eq("statusesChanged both empty", statusesChanged(new Map(), new Map()), false);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/elling/git-repo/github/pi-statusbar/.pi/worktrees/issue-5-surfacing-extension-statuses && npx esbuild test/statusline.test.ts --bundle --format=esm --platform=node --outfile=/tmp/statusline-test.mjs && node /tmp/statusline-test.mjs`
Expected: FAIL — imports fail at bundle time (symbols not exported from `../lib/statusline`).

- [ ] **Step 3: Implement the three functions**

Append to `lib/statusline.ts`:

```ts
// Mirror pi's built-in footer sanitization for extension status texts:
// newlines/tabs/CR become spaces, runs of spaces collapse to one, ends trimmed.
export function sanitizeStatusText(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

// Format extension statuses (ctx.ui.setStatus) as one line, mirroring the
// built-in footer: sorted by key, values sanitized, joined with one space.
// Returns "" when there is nothing to show (empty Map or all values blank).
export function formatExtensionStatuses(statuses: ReadonlyMap<string, string>): string {
	if (statuses.size === 0) return "";
	return Array.from(statuses.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, text]) => sanitizeStatusText(text))
		.join(" ");
}

// Light snapshot compare for the status poll: true when the set of
// key/value pairs differs. Insertion order is irrelevant (Map lookups).
export function statusesChanged(
	prev: ReadonlyMap<string, string>,
	next: ReadonlyMap<string, string>,
): boolean {
	if (prev.size !== next.size) return true;
	for (const [key, value] of prev) {
		if (next.get(key) !== value) return true;
	}
	return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: same command as Step 2.
Expected: PASS — all new cases print `ok`, node exits 0. Existing cases unaffected.

- [ ] **Step 5: Commit**

```bash
cd /home/elling/git-repo/github/pi-statusbar/.pi/worktrees/issue-5-surfacing-extension-statuses
git add lib/statusline.ts test/statusline.test.ts
git commit -m "feat: add extension status formatting helpers to lib/statusline"
```

---

### Task 2: Render third line + 10s status poll in index.ts

**Files:**
- Modify: `index.ts` (imports, footer factory, render)

**Interfaces:**
- Consumes: `formatExtensionStatuses`, `statusesChanged` from `./lib/statusline` (Task 1); `footerData.getExtensionStatuses(): ReadonlyMap<string, string>` from pi's footer factory parameter.
- Produces: footer component now returns 2 or 3 lines; a 10s interval comparing status snapshots and calling `tui.requestRender()` on change.

- [ ] **Step 1: Extend the import from ./lib/statusline**

In `index.ts`, the import block currently reads:

```ts
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
```

Change it to (alphabetical order):

```ts
import {
	clockStr,
	formatExtensionStatuses,
	hjoin,
	modelName,
	resolveUserHost,
	shortCwd,
	statusesChanged,
	stripRepoPrefix,
	thinkColor,
	triggerPct,
} from "./lib/statusline";
```

- [ ] **Step 2: Add the status poll interval inside the footer factory**

In the footer factory (the `ctx.ui.setFooter((tui, theme, footerData) => { ... })` callback), directly after the existing minute-tick interval registration (the block ending with `}, 1000);`), insert:

```ts
			// pi's FooterDataProvider has no callback for extension status
			// changes (ctx.ui.setStatus), so poll the Map every 10s and
			// re-render only when its contents actually changed. The compare
			// is O(n) over a handful of entries — negligible.
			let statusSnapshot: ReadonlyMap<string, string> = new Map(footerData.getExtensionStatuses());
			const statusInterval = setInterval(() => {
				const current = footerData.getExtensionStatuses();
				if (statusesChanged(statusSnapshot, current)) {
					statusSnapshot = new Map(current);
					tui.requestRender();
				}
			}, 10000);
```

- [ ] **Step 3: Clear the status interval in dispose()**

The `dispose()` method currently reads:

```ts
			return {
				dispose() {
					unsubBranch();
					clearInterval(interval);
					requestFooterRender = null;
				},
```

Change it to:

```ts
			return {
				dispose() {
					unsubBranch();
					clearInterval(interval);
					clearInterval(statusInterval);
					requestFooterRender = null;
				},
```

- [ ] **Step 4: Render the third line**

The render function currently ends with:

```ts
					const line2 = joinLine(l2Left, l2Right, width);

					return [line1, line2];
```

Change it to:

```ts
					const line2 = joinLine(l2Left, l2Right, width);

					// ---- Line 3: extension statuses (ctx.ui.setStatus) ----
					// Mirrors the built-in footer: key-sorted, sanitized,
					// joined with spaces, truncated with a dim ellipsis.
					// Values keep their own ANSI colors (no wrapping).
					const lines = [line1, line2];
					const statusLine = formatExtensionStatuses(footerData.getExtensionStatuses());
					if (statusLine) {
						lines.push(truncateToWidth(statusLine, width, dim("...")));
					}
					return lines;
```

- [ ] **Step 5: Update the layout doc comment at the top of index.ts**

The header comment currently says (near the top):

```
 * Layout (two lines, left/right aligned):
 *   <user>@<host>  ~/project  <session title>      R6.7M CH99.9% $0.02  2026-08-07 23:25
 *   owner/repo | git:(main)                        (provider) model • effort • ctx:N%
```

Change it to:

```
 * Layout (two lines plus an optional status line, left/right aligned):
 *   <user>@<host>  ~/project  <session title>      R6.7M CH99.9% $0.02  2026-08-07 23:25
 *   owner/repo | git:(main)                        (provider) model • effort • ctx:N%
 *   💳 dt $0.01/$199.99   🔌 MCP: 7 servers enabled            (only when extensions set status)
```

And add this bullet to the `Fields:` list (after the `cost` bullet):

```
 *   status line : extension statuses from ctx.ui.setStatus (third line,
 *                 only shown when at least one extension has status text);
 *                 key-sorted, sanitized, truncated with a dim ellipsis;
 *                 ANSI colors from the status values are preserved
```

- [ ] **Step 6: Syntax-check index.ts**

Run: `cd /home/elling/git-repo/github/pi-statusbar/.pi/worktrees/issue-5-surfacing-extension-statuses && npx esbuild index.ts --loader:.ts=ts --outfile=/dev/null`
Expected: exit 0, no errors.

- [ ] **Step 7: Run the full test suite (regression)**

Run: `bash test/run-all.sh`
Expected: `OK: 5/5 test files passed` (all files pass, including the updated statusline tests).

- [ ] **Step 8: Commit**

```bash
cd /home/elling/git-repo/github/pi-statusbar/.pi/worktrees/issue-5-surfacing-extension-statuses
git add index.ts
git commit -m "feat: surface extension statuses as a third footer line (issue #5)"
```

---

### Task 3: Document the change in README and CHANGELOG

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: nothing from prior tasks beyond the change itself (documentation only).

- [ ] **Step 1: Update README layout description**

Make these three precise edits to `README.md`:

**1a. Intro sentence** — replace:

```markdown
A two-line status bar (footer) extension for [pi](https://github.com/earendil-works/pi-coding-agent).
```

with:

```markdown
A two-line status bar (footer) extension for [pi](https://github.com/earendil-works/pi-coding-agent),
plus an optional third line for extension statuses published via `ctx.ui.setStatus()`
(e.g. pi-mcp-adapter's MCP line).
```

**1b. Layout example** — replace the code block:

````markdown
```text
<user>@<host>  ~/project  <session title>      R6.7M CH99.9% $0.02  2026-08-07 23:25
owner/repo | git:(main)                        (provider) model • effort • ctx:N%
```
````

with:

````markdown
```text
<user>@<host>  ~/project  <session title>      R6.7M CH99.9% $0.02  2026-08-07 23:25
owner/repo | git:(main)                        (provider) model • effort • ctx:N%
💳 dt $0.01/$199.99   🔌 MCP: 7 servers enabled
```

The third line shows statuses that other extensions publish via
`ctx.ui.setStatus()`. It appears only while at least one extension has
status text, and disappears otherwise — the base layout stays two lines.
````

**1c. Features list** — after the `**Line 2**:` bullet (which ends with
"context-usage\n  percentage."), add:

```markdown
- **Line 3 (optional)**: statuses published by other extensions via
  `ctx.ui.setStatus()` — key-sorted, sanitized, truncated to the
  terminal width, ANSI colors preserved. Only rendered while at least
  one extension publishes a status; otherwise the footer stays two
  lines.
```

- [ ] **Step 2: Add a CHANGELOG entry**

In `CHANGELOG.md`, under `## [Unreleased]`, add:

```markdown
### Added

- Extension statuses from `ctx.ui.setStatus()` (e.g. the MCP status line
  from pi-mcp-adapter) are now surfaced as an optional third footer line,
  mirroring the built-in footer: key-sorted, sanitized, truncated. The line
  only appears while at least one extension publishes a status; existing
  two-line layout is unchanged otherwise. ([#5](https://github.com/zhuxixi/pi-statusbar/issues/5))
```

- [ ] **Step 3: Verify docs render (visual check)**

Run: `cd /home/elling/git-repo/github/pi-statusbar/.pi/worktrees/issue-5-surfacing-extension-statuses && git diff -- README.md CHANGELOG.md`
Expected: diff shows only the intended additions; no accidental rewrites.

- [ ] **Step 4: Commit**

```bash
cd /home/elling/git-repo/github/pi-statusbar/.pi/worktrees/issue-5-surfacing-extension-statuses
git add README.md CHANGELOG.md
git commit -m "docs: document extension status line in README and CHANGELOG"
```

---

## Final Verification

After all tasks:

- [ ] `bash test/run-all.sh` → all test files pass
- [ ] `npx esbuild index.ts --loader:.ts=ts --outfile=/dev/null` → no syntax errors
- [ ] `git log --oneline` shows the four commits (spec + 3 tasks) on branch `issue-5-surfacing-extension-statuses`
- [ ] Main checkout (`/home/elling/git-repo/github/pi-statusbar`) is untouched: `git status --short` there is clean
