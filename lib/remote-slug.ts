/**
 * remote-slug — parse the repo path from a git remote URL.
 *
 * Pure (no fs / execSync) so it can be unit-tested in isolation. pi-statusbar
 * calls slugFromRemoteUrl() with the URL returned by `git remote get-url origin`.
 *
 * Host-agnostic: works for GitHub, GitLab (incl. subgroups), Gitea, Bitbucket,
 * self-hosted git, and SSH host aliases (e.g. `gh:owner/repo.git`). The original
 * implementation anchored on the literal `github.com`; this module widens it to
 * any host (issue #1) and also handles non-standard ports (CR r1), GitLab
 * subgroup multi-segment paths (CR r1), local file/relative-path/Windows-drive
 * rejection (CR r1 + r2), basic-auth credentials without leaking them (CR r2),
 * and numeric first path segments in SCP syntax (CR r2).
 */
export function slugFromRemoteUrl(url: string): string {
	// Reject local / non-remote forms up front: file:// URLs, absolute paths,
	// relative paths (../, ./), and Windows drive-letter paths (C:\, C:/).
	// These would otherwise match the host-agnostic logic below.
	if (/^(?:file:|\.+\/|\/|[A-Za-z]:[\\/])/.test(url)) return "";

	const isUrl = /^\w+:\/\//.test(url);
	// Strip scheme:// (URL form only), then strip user[:pass]@ — confined to the
	// authority segment ([^/]*@: the part before the first /) so basic-auth
	// credentials (https://user:pass@host/..., CI x-access-token:${TOKEN}@host/...)
	// can never leak into the slug, while an @ inside the path is preserved.
	// Known boundary (acknowledged in CR r4, issue-9): a userinfo containing a
	// RAW "/" (e.g. https://user/to%40ken@host/...) is RFC 3986-illegal and is
	// NOT protected — it is indistinguishable from a legal path-with-@ without
	// a host whitelist, which would defeat host-agnostic support. Percent-
	// encoded credentials (%2F, %40) and every mainstream token format are safe.
	const s = url.replace(/^\w+:\/\//, "").replace(/^[^/]*@/, "");

	// Two shapes after normalization:
	//   URL form    host[:port]/path   — a non-standard port is allowed here
	//   SCP/alias   host:path          — SCP syntax has NO port, so the port
	//                                     branch must NOT apply (otherwise a
	//                                     numeric first segment like
	//                                     git@gitlab.com:1234/team/repo is
	//                                     eaten as a port and the slug loses it).
	const m = isUrl
		? s.match(/^[\w.-]+(?::\d+)?\/(.+)$/)
		: s.match(/^[\w.-]+:(.+)$/);
	if (!m) return "";

	// Strip any query string / fragment first (a ?token=... injected by git
	// url.insteadOf or CI must never reach the status bar), then an optional
	// trailing ".git" and "/", then require at least two segments (owner/repo).
	// A single-segment root repo is not a slug.
	const path = m[1].replace(/[?#].*$/, "").replace(/(?:\.git)?\/?$/, "").trim();
	return path.includes("/") ? path : "";
}
