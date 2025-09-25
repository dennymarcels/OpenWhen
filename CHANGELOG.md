# Changelog

All notable changes to this project will be documented in this file.

The format is based on "Keep a Changelog" and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2025-09-25

### Added
- Initial public release of OpenWhen.
- Core features:
  - Schedule URLs to open at specific times (once, daily, weekly, monthly).
  - In-browser reminder banner when a scheduled URL is opened.
  - Options page for creating and editing schedules.
  - Popup and side panel UI for quick access and prefill helpers.
  - Context menu actions to prefill a URL from a page or link.
  - Local-only data storage (uses chrome.storage.local).
  - Alarm-based scheduler using Manifest V3 service worker.

### Changed
- N/A (first release)

### Fixed
- N/A (first release)

### Security & Privacy
- No external network requests are made by the extension (no fetch/XMLHttpRequest/sendBeacon/WebSocket usage).
- Host permissions are limited to `http://*/*` and `https://*/*` only (content script matches), and extension permissions are limited to required APIs (storage, alarms, tabs, windows, contextMenus).
- A privacy policy is available at the repository GitHub Pages site (docs/privacy.html).

### Notes
- Tests and linting are included and run in CI; see `.github/workflows/pack-extension.yml`.
- Packaging: a `build:zip` script and CI workflow produce `dist/openwhen-<version>.zip` for store upload.

### Contributors
- Project maintained by the repository owner.


## How to write future entries

- Add a new section under `Unreleased` with subsections `Added`, `Changed`, `Fixed`, and `Security` as appropriate.
- When cutting a release, move the `Unreleased` content into a new heading for the released version (for example `## [1.0.1] - 2025-10-01`) and update `package.json` version/tag accordingly.
- Keep entries short and focused. For changelogs intended as release notes, prefer user-facing language (what changed and why it matters).

---

This file is consumed by the release workflow: when a tag (e.g. `v1.0.0`) is pushed, the workflow will use this changelog as the release body if present; otherwise it will fall back to recent commit messages.
