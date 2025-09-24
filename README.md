OpenWhen
========

A minimal Chromium extension to open URLs at scheduled times or once, showing a short reminder message when the page is opened.

How to load for testing (Edge/Chrome):

1. Open the browser extensions page (edge://extensions or chrome://extensions)
2. Enable developer mode
3. Click "Load unpacked" and point to this project folder
4. Open the options page from the extension's details (Options)

Notes
- This initial version implements the options page and background scheduling (daily/weekly/once).
- Styles are centralized in `styles.css` and applied to both the options page and the in-page banner.
