Testing & smoke-checklist
=========================

Purpose
- Fast, reproducible tests to validate core behavior before publishing.

Manual smoke tests (quick)
1. Load unpacked extension in Chrome/Edge (Developer mode).
2. Open Options and create a once schedule for a time 2–3 minutes in the future. Verify:
   - When the alarm fires the URL opens in the chosen target (tab/window).
   - The in-page banner appears (http/https pages only) and displays the message.
   - The schedule's `runCount` increments and `lastRun` is updated in the Options list.
3. Create a daily schedule and confirm the next occurrence is scheduled correctly (you can temporarily set time to a minute ahead for testing).
4. Create a weekly schedule (pick a weekday) and verify it fires on the correct day/time.
5. Create a monthly schedule on day 31 and verify it triggers on months with fewer days (it should use the last day of the month).
6. Test context-menu prefill: right-click a page or link -> "OpenWhen this link/page..." -> open Options and confirm the URL was prefilled.

Edge cases
- Timezones/DST: verify that scheduled times are local and handle DST changes by testing around DST transitions if possible.
- Service worker lifecycle: reload/disable/reenable the extension and ensure alarms are rebuilt (rebuild happens on startup/onInstalled).

Automated checks (recommended to run locally)
- Static grep for network or native APIs:
  - grep for `fetch\(`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `sendNativeMessage`.
- Unit tests for schedule computation (Node or a small JS harness): test computeNextForSchedule with sample inputs for once/daily/weekly/monthly, including month overflow and DST.

How to run a quick grep in PowerShell
```powershell
Select-String -Path .\**\*.js -Pattern "fetch\(|XMLHttpRequest|sendBeacon|WebSocket|sendNativeMessage" -SimpleMatch
```

Notes
- The content script is intentionally limited to http/https in the manifest. Confirm the banner does not inject on file:// or chrome:// pages.
- If you add remote APIs or telemetry, add automated tests that validate the consent flow and data filtering.
