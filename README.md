
OpenWhen
========

[![CI](https://github.com/dennymarcels/OpenWhen/actions/workflows/ci.yml/badge.svg)](https://github.com/dennymarcels/OpenWhen/actions/workflows/ci.yml)

Small Chromium extension to open URLs on a schedule (once / daily / weekly / monthly).

Features
- Create one-time or recurring schedules to open URLs.
- Open in a tab or window, optionally in background.
- Small in-page banner shows a reminder when a scheduled URL is opened.
- Context-menu prefill: right-click a link or page -> "OpenWhen this link/page..." to prefill the options form.

Permissions (manifest)
- chrome.permissions: storage, alarms, tabs, windows, notifications, contextMenus
- host_permissions: http://*/* and https://*/* (content script injects the banner only on web pages)

Load for testing (Edge / Chrome)
1. Open edge://extensions or chrome://extensions
2. Enable Developer mode
3. Click "Load unpacked" and select this folder
4. Open the options page from the extension details and add schedules

Quick tests to run
- Add a once schedule for a near-future time and confirm the URL opens and banner appears.
- Test daily / weekly / monthly schedules and ensure runCount and lastRun update in the options list.
- Monthly edge case: schedule on day 31 and verify it triggers on months with fewer days (it will use the last day of the month).
- Confirm the banner does not inject on non-HTTP(S) pages (file://, chrome://, etc.).

Packaging & publishing notes
- Before publishing, bump `manifest.json` version (for example to `1.0.0`) and prepare release notes.
- You must provide a hosted privacy policy URL when publishing if you request host permissions. Document that schedules are stored in `chrome.storage.local` and that no data is sent externally.
- Prepare screenshots of the options page and the in-page banner for the store listing.
- When packaging locally, zip the extension root (exclude `.git/`). Example (PowerShell):

```powershell
Compress-Archive -Path .\openwhen\* -DestinationPath .\openwhen-1.0.0.zip -Force
```

License & contribution
- This repository does not yet include a LICENSE file. MIT is a good default for permissive reuse; Apache-2.0 adds a patent grant; GPLv3 is strong copyleft. Add `LICENSE` before publishing if desired.
- If you accept contributions, include a CONTRIBUTING.md and consider a CLA/DCO if you have legal/patent concerns.

Notes
- Styles live in `styles.css` and are used by the options/popup/sidebar pages and the in-page banner.
- The content script is intentionally limited to HTTP/HTTPS pages to reduce permission scope.

Contact & support
- Add a `homepage_url` (and a hosted privacy policy) in the store listing or `manifest.json` if you want a public project page.

Enjoy — load the extension locally to test and tell me if you want me to prepare the privacy policy and/or a LICENSE file.

