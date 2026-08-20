# Security Policy

## Reporting a Vulnerability

If you find a security issue in pi-statusbar, please report it privately
instead of opening a public issue:

- **Email:** <zhuzhenxi_555@hotmail.com> — put `pi-statusbar security` in
  the subject line.

Please include a description of the issue, affected versions, and (if
possible) steps to reproduce. I will acknowledge your report within 7
days and aim to publish a fix within 30 days of confirmation.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Scope

The extension is pure formatting logic plus a small runtime config file
(`~/.pi/agent/extensions/pi-statusbar.json`). It has zero runtime
dependencies and makes no network requests. Security concerns would
primarily be: config parsing edge cases, command-argument handling in
`/statusbar config`, or shell invocation in git-remote detection. When
reporting, please note which of these areas is involved.
