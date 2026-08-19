/**
 * Parameterized cases for slugFromRemoteUrl(). Covers issue #1's original table
 * (GitHub regression guards + non-GitHub hosts) plus the cases raised in code
 * review (ports, GitLab subgroups, file/relative-path regressions) and negative
 * cases. All intranet examples are anonymized.
 *
 * Run with (no test framework — zero-dep, bundled by esbuild):
 *   npx esbuild test/remote-slug.test.ts --bundle --format=esm \
 *     --platform=node --outfile=/tmp/remote-slug-test.mjs && node /tmp/remote-slug-test.mjs
 */
import { slugFromRemoteUrl } from "../lib/remote-slug";

const cases: Array<{ url: string; expect: string; note?: string }> = [
	// --- GitHub / generic hosts (regression guard: these already worked) ---
	{ url: "git@github.com:owner/repo.git", expect: "owner/repo" },
	{ url: "https://github.com/owner/repo", expect: "owner/repo" },
	{ url: "ssh://git@github.com/owner/repo.git", expect: "owner/repo" },
	{ url: "https://github.com/owner/repo/", expect: "owner/repo", note: "trailing slash" },
	{ url: "git@gitlab.com:owner/repo.git", expect: "owner/repo" },
	{ url: "https://git.mycompany.com/team/svc.git", expect: "team/svc" },
	{ url: "gh:owner/repo.git", expect: "owner/repo", note: "SSH alias host" },
	{ url: "git@corp-git.example.net:team_a/svc-b.git", expect: "team_a/svc-b", note: "self-hosted intranet" },

	// --- CR issue #1: SSH/HTTPS remotes with a port ---
	{ url: "ssh://git@host:7999/owner/repo.git", expect: "owner/repo", note: "ssh url + port" },
	{ url: "ssh://git@host:7999/repo.git", expect: "", note: "single-segment root repo with port -> empty" },

	// --- CR issue #2: GitLab subgroups (multi-segment path) ---
	{ url: "git@gitlab.com:group/sub/repo.git", expect: "group/sub/repo", note: "gitlab subgroup, 3 segments" },
	{ url: "git@gitlab.com:group/sub/deep/repo.git", expect: "group/sub/deep/repo", note: "gitlab subgroup, 4 segments" },

	// --- CR issue #3: file:// / relative-path remotes must NOT match (regression) ---
	{ url: "../other/repo.git", expect: "", note: "relative path -> empty" },
	{ url: "file:///home/user/repo.git", expect: "", note: "file url -> empty" },

	// --- CR round 2 issue #4: basic-auth credentials must NOT leak into the slug ---
	{ url: "https://user:pass@github.com/owner/repo.git", expect: "owner/repo", note: "basic-auth https" },
	{ url: "https://x-access-token:tok@gitlab.com/g/repo.git", expect: "g/repo", note: "CI token https" },
	// --- CR round 2 issue #5: Windows drive-letter local paths rejected ---
	{ url: "C:/Users/x/repo", expect: "", note: "windows drive letter" },
	// --- CR round 2 issue #6: a numeric first segment in SCP must not be eaten as a port ---
	{ url: "git@gitlab.com:1234/team/repo.git", expect: "1234/team/repo", note: "numeric first segment" },
	{ url: "git@host:1234567/repo.git", expect: "1234567/repo", note: "two-segment numeric owner" },

	// --- CR round 3 issue #7: @ inside the path must not be eaten by the userinfo strip ---
	{ url: "https://host.com/a@b/c/repo.git", expect: "a@b/c/repo", note: "@ in https path" },
	{ url: "git@host:o/name@2x/repo.git", expect: "o/name@2x/repo", note: "@ in scp path" },
	// --- CR round 3 issue #8: query string / fragment must not leak into the slug ---
	{ url: "https://github.com/owner/repo.git?token=secret", expect: "owner/repo", note: "query token stripped" },
	{ url: "https://github.com/owner/repo.git#frag", expect: "owner/repo", note: "fragment stripped" },
	// --- regression guard: password containing @ must still be fully stripped ---
	{ url: "https://user:p@ss@github.com/o/r.git", expect: "o/r", note: "password containing @" },

	// --- Negative cases ---
	{ url: "not a url", expect: "" },
	{ url: "/home/user/local-dir", expect: "" },
];

let failed = 0;
for (const { url, expect, note } of cases) {
	const got = slugFromRemoteUrl(url);
	const tag = note ? `  (${note})` : "";
	if (got === expect) {
		console.log(`ok   ${url}${tag} -> ${got === "" ? "(empty)" : got}`);
	} else {
		failed++;
		console.error(`FAIL ${url}${tag} -> got '${got === "" ? "(empty)" : got}', expected '${expect === "" ? "(empty)" : expect}'`);
	}
}

if (failed) {
	console.error(`\n${failed}/${cases.length} cases FAILED`);
	process.exit(1);
}
console.log(`\nall ${cases.length} cases passed`);
