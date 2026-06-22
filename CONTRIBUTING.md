# Contributing

This repository is maintained for production use. Changes should be small,
reviewable, and validated before they reach the default branch.

## Before You Open a PR

- Start from the current default branch.
- Keep unrelated refactors out of the change.
- Do not commit secrets, Firebase credentials beyond public client config, test
  user data, or generated local artifacts.
- Run the Quality workflow checks locally when possible.

## Production Checklist

- The app still loads from GitHub Pages.
- Firebase rules/config changes are intentional and keep deny-by-default posture.
- Local HTML asset references are relative and resolve on case-sensitive hosts.
- User-facing behavior is described in the PR.
- Any security-sensitive change references `SECURITY.md`.
