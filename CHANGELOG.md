# Changelog

All notable changes to this project will be documented in this file.

The format is based on "Keep a Changelog" and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- Improved banner injection error handling to detect privileged pages (`chrome://`, `edge://`, etc.) and skip retry attempts.
- Enhanced notification fallback behavior: notifications are now always shown regardless of banner injection success, providing reliable reminders even on pages where content scripts cannot be injected.

## [1.1.0] - 2025-10-30

### Added
- Browser notifications when scheduled URLs are opened, with clickable notifications to focus the opened tab.
- Favicon fetching and display in notifications, with automatic resizing to 32x32 PNG format.
- Persistent notification-to-tab mapping to enable focusing tabs from notification clicks even after service worker restarts.
- Retry logic for notification creation when image downloads fail, with automatic fallback to extension icon.
- Enhanced date computation for displaying scheduled times in notifications and banners, including support for late/missed occurrences.
- Cancel button in injected page banners to immediately cancel a schedule directly from the opened page.
- Inline confirmation toast when a schedule is cancelled from the banner.
- Real-time search functionality for filtering schedules by URL or message content as you type.
- Website favicons displayed next to URLs in schedule list items using Google's favicon service.
- Enhanced sorting options with ascending/descending directions for all sort criteria:
  - Created (newest → oldest / oldest → newest)
  - Next trigger time (next → farthest / farthest → next)
  - Times triggered (highest → lowest / lowest → highest)
- Edit mode functionality with visual feedback, allowing users to modify existing schedules directly from the options page.
- Cancel button to exit edit mode and return to add mode.

### Changed
- Improved context menu handling for prefilling schedules from links and pages.
- Enhanced options page to display schedule opening methods more clearly (tab/window, foreground/background).
- Refactored notification and banner injection code for better reliability and error handling.
- Updated CI workflow to support all branch triggers without restrictions.
- Improved schedule list display with favicon icons for better visual identification.
- Enhanced h1 title/icon alignment using flexbox for consistent vertical centering across options and popup pages.
- Refactored schedule rendering to support favicon display with graceful fallback for failed icon loads.
- Updated default sort order to "created (newest → oldest)" for better usability.

### Fixed
- Tabs now open correctly when alarms fire, addressing Chrome Web Store review feedback about schedules not opening tabs.
- Improved reliability of tab creation and content script injection with retry logic and fallback mechanisms.
- Fixed notification icon updates to handle favicon changes after page load.
- Enhanced error handling throughout to prevent silent failures.
- Icon and title alignment now properly centered with appropriate spacing (8px gap).
- Search bar styling optimized for both options and popup pages with responsive width.

### Security & Privacy
- All notification and tab operations remain local-only with no external network requests.
- Notification mappings are stored in local storage and cleaned up when no longer needed.

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
