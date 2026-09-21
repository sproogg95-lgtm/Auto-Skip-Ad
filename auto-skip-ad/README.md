# Auto Skip Ad Button (Chrome Extension)

Clicks **YouTube's own "Skip Ad" button** the instant it becomes available —
with a **real, trusted click** (v1.1), exactly like your physical mouse.

**This does NOT block or bypass ads.** The ad always plays in full until YouTube
itself offers the skip button — the extension simply clicks that button for you.

## What it does

- Detects when an ad is playing on YouTube (regular videos, Shorts, embeds, YouTube Music)
- Waits for the real "Skip Ad" button to appear and become clickable
- Clicks it immediately with a **trusted** click (see below)
- Shows a badge with how many ads it has skipped (verified skips only)
- Can be toggled on/off from the popup

## What it does NOT do

- ❌ Does not block, hide, or remove ads
- ❌ Does not skip non-skippable ads (there is no button, so nothing is clicked)
- ❌ Does not fast-forward, seek, or tamper with the video/ad playback in any way

## The "trusted click" (why v1.1 exists)

YouTube ignores clicks made by JavaScript (`element.click()` /
`dispatchEvent`) because those events have `isTrusted: false`. If your
console shows the button being "clicked" but the ad never skips — that's why.

This extension solves it in two phases:

1. First it tries the normal `.click()` (works on some player surfaces).
2. If the button is still there ~300 ms later, it asks the background
   service worker to deliver a **real mouse event** at the button's exact
   coordinates using the `chrome.debugger` API (Chrome DevTools protocol,
   `Input.dispatchMouseEvent`). These events have `isTrusted: true` —
   YouTube cannot distinguish them from your physical mouse.

### What to expect with the debugger

- While an ad is active you may see a yellow banner:
  **"Auto Skip Ad Button started debugging this browser"** — this is normal
  and expected. It disappears when the ad ends (the extension detaches
  automatically). Don't press its "Cancel" button; if you do, trusted
  clicking stops until you reload the page.
- **Keep DevTools (F12) closed** on the YouTube tab while watching. An open
  DevTools window occupies the tab's debugger slot and blocks the trusted
  click (the extension detects this and logs a hint in the console).
- The "debugger" permission may look scary in Chrome's permissions UI, but
  this extension only uses it to click the skip button — nothing else.

## Install

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `auto-skip-ad` folder (this folder)
5. Done! Open any YouTube video with a skippable ad.

**After updating the extension files:** press the circular **Reload** icon on
the extension's card in `chrome://extensions`, then hard-refresh YouTube tabs
(Ctrl+Shift+R). Make sure the extension is still toggled ON — Chrome may show
a new permission notice after adding the "debugger" permission.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Extension configuration (Manifest V3) |
| `content.js` | Runs on YouTube pages; finds ads, clicks skip (tries normal click first, then trusted click) |
| `background.js` | Service worker; delivers trusted clicks via `chrome.debugger`, keeps the badge and counter |
| `popup.html` / `popup.js` | On/off toggle + skip counter |
| `make-icons.ps1` | PowerShell script used to generate the icons |
| `icons/` | Extension icons |

## Settings

Open the popup (click the extension icon) to:

- Toggle the extension on/off
- See how many ads it has skipped

## Customizing

- **Also close dismissible banner overlays** (the "X" on overlay ads):
  in `content.js`, change `const CLICK_OVERLAY_CLOSE = false;` to `true`.
- **If YouTube changes its player markup** and skipping stops working:
  open DevTools (F12) on a YouTube ad, find the skip button, and add its
  CSS class to `SKIP_SELECTORS` at the top of `content.js`. The extension
  also has a text-based fallback that matches "Skip" buttons inside the
  video player, so it usually keeps working across YouTube redesigns.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Console says "Clicked the Skip Ad button" but ad doesn't skip | That's the pre-v1.1 behavior (untrusted click). Update to v1.1 and reload the extension. |
| Warning: "Cannot deliver a real click while DevTools (F12) is open" | Close DevTools on the YouTube tab. |
| Yellow banner bothers you | It only appears while an ad is playing. Do NOT press Cancel — reload the page instead if you want it back. |
| Trusted clicking stopped after pressing Cancel on the banner | Reload the YouTube page — it re-enables automatically. |
| Counter counts 1 per ad (not 24) | Yes — v1.1 only counts **verified** skips (button actually disappeared). |

## How it works (technical)

- A `MutationObserver` reacts to every DOM change (YouTube is a SPA, so ads
  are inserted dynamically) and re-scans with a 120 ms debounce; a 250 ms
  interval is a safety net.
- Detection uses YouTube's skip-button CSS classes (language independent),
  plus a text/aria-label fallback **strictly scoped to the video player** so
  unrelated page buttons (like "Skip navigation") can never be clicked.
- Buttons are only clicked when they are visible and enabled — so during the
  "Skip in 5s..." countdown nothing happens until the button is actually
  clickable.
- The click sequence: normal `.click()` → verify after 300 ms → if the button
  survived, `chrome.debugger` + `Input.dispatchMouseEvent` at the button's
  center (viewport CSS pixels) → verify again → only then count + log.

## Notes

- Automated interaction with a website may be against its Terms of Service;
  use at your own discretion. This extension only automates clicking a button
  that YouTube itself provides to every user.
