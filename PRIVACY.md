OpenWhen Privacy & Data Use

This document explains what OpenWhen stores and why. It's written for reviewers and users.

What we store
- Schedules: the extension stores schedule entries (URL, schedule type, time, optional message, runCount, lastRun) in `chrome.storage.local` on your device.

What we do NOT store or send
- We do NOT transmit schedule data, browsing history, or personal data to any external servers.
- We do NOT collect analytics, telemetry, or any personal identifiers.

Why we request host permissions
- OpenWhen injects a small in-page banner into web pages (HTTP/HTTPS) when a scheduled URL is opened by the extension. The banner is added by a content script which runs only on HTTP/HTTPS pages.
- Host permissions are limited to `http://*/*` and `https://*/*` in the manifest to allow the content script to run on web pages opened by the extension.

How to delete your data
- To delete all saved schedules, open the extension Options page and remove schedules, or remove the extension (which clears extension data), or clear extension data via the browser's Extensions UI.

Contact
- If you have questions about privacy or data handling, add a contact email or project homepage to the store listing and in the repository's `README.md`.
