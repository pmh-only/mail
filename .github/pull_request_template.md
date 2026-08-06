## Summary

<!-- What problem does this pull request solve? -->

<!--
  Example:

  The shared mail screen (/share/[token]) ignored the app's theme setting — it always rendered with a hardcoded opaque dark background, regardless of the light/dark preference or gradient style chosen in Settings.
-->

## Changes

<!-- List the notable implementation changes. -->

<!--
  Example:

  Replaced the opaque bg-zinc-950 on the share page's root wrapper with bg-transparent, the same fix already applied to the mail list/content panes (c0e1125). The existing layout.css light-theme overrides for text-zinc-*/border-white/*/bg-white/* already handle color inversion; the opaque background was the only thing blocking the theme gradient wash and light-mode background from showing through on this screen.
-->

## Checklist

<!-- Do not change checklist questions. -->
<!-- All PRs must have every box checked. If even a single checkbox is left unchecked, the PR will be rejected. -->

- [ ] I ran exlint linter and/or fixed lint issues.
- [ ] I ran exfmt formatter and/or fixed fomatting issues.
- [ ] I ran vitest test suites and passed 100%.
- [ ] I ran vitest coverage test and it returned 100% coverage percent.
- [ ] I followed AGENTS.md/CLAUDE.md for AI Generated/Assisted codes.
- [ ] I followed Conventional Commits rules include in CONTRIBUTING.md
- [ ] This PR doesn't include any personal development environment files.
