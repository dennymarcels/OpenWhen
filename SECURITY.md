Security audit and notes
========================

Summary
- I reviewed the runtime code (background service worker and content script) for network calls and external data transmission. No outbound network calls (fetch/XHR/WebSocket/sendBeacon) or native messaging were detected.
- The extension stores schedules and a small prefill URL in `chrome.storage.local` only; data is not transmitted off-device by the code present.

Content script behavior
- The content script only injects a small, non-persistent DOM element (the banner) and does not read or send page content. It registers a runtime message listener and shows the banner when it receives an `openwhen_opened` message.
- The banner displays the schedule message text and a short source label. Those strings originate from extension-controlled schedule entries; they are not exfiltrated.

Prefill behavior
- Context-menu prefill stores the selected URL temporarily in `chrome.storage.local` under the key `openwhen_prefill_url` so the Options page can read it. This is local-only and is removed after the form reads it.

Automated checks performed
- Searched for common network APIs and native messaging: `fetch(`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `chrome.runtime.sendNativeMessage` — none found.

Recommendations
1. Keep the code base free of direct network calls unless you intentionally add telemetry or sync features. If you add them later, document what is sent, get user consent, and update the privacy policy.
2. Avoid displaying any PII in screenshots or default schedule messages. Remind users in the UI or docs to avoid adding sensitive text.
3. Consider clearing `openwhen_prefill_url` after read (already done in options but verify the flow) and avoid long-term storage of transient data unless necessary.
4. If you add telemetry later, use an opt-in flow and a clear privacy notice.

If you want, I can add a short automated unit test for the scheduling logic (computeNextForSchedule) to catch common timezone/daylight savings edge cases.
