/* Auto Skip Ad Button - content script v1.1
 *
 * Waits for YouTube's own "Skip Ad" button and clicks it the instant it
 * becomes clickable. Nothing is blocked, hidden, or bypassed: the ad always
 * plays until YouTube itself offers the skip button.
 *
 * v1.1: YouTube ignores JavaScript-synthetic clicks (isTrusted === false),
 * so we first try the normal .click() and verify; if the button survives,
 * we ask the background service worker to deliver a REAL, trusted mouse
 * click at the button's coordinates via chrome.debugger (isTrusted === true).
 */
(() => {
  'use strict';

  // Prevent double injection in the same frame.
  if (window.__autoSkipAdLoaded) return;
  window.__autoSkipAdLoaded = true;

  const LOG = '[Auto Skip Ad]';

  // Selectors for YouTube's skip button across player generations.
  // Class-based selectors work in every language; the text fallback below
  // is strictly scoped to the video player so unrelated page controls can
  // never be clicked.
  const SKIP_SELECTORS = [
    '.ytp-skip-ad-button',                    // current player (2024+)
    '.ytp-ad-skip-button-modern',             // player 2022-2024
    '.ytp-ad-skip-button',                    // legacy player
    '.ytp-ad-skip-button-container button',   // container variant
    '.videoAdUiSkipButton',                  // very old embed player
  ];

  const PLAYER_SELECTOR = '#movie_player, .html5-video-player';
  const AD_ACTIVE_SELECTOR = '.ytp-ad-player-overlay';

  // Set to true to also dismiss banner-overlay ads using YouTube's own
  // close (X) button. Off by default - this extension only clicks "Skip".
  const CLICK_OVERLAY_CLOSE = false;
  const OVERLAY_CLOSE_SELECTORS = ['.ytp-ad-overlay-close-button'];

  const CLICK_COOLDOWN_MS = 700;
  const WARN_EVERY_MS = 30000;

  let enabled = false;          // inert until settings load (fail-safe)
  let lastClickAt = 0;
  let attemptInFlight = false; // one skip attempt at a time
  let wasAdActive = false;
  let lastWarnAt = 0;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ---- settings ------------------------------------------------------------
  chrome.storage.local
    .get({ enabled: true })
    .then((cfg) => {
      enabled = cfg.enabled;
    })
    .catch(() => {
      enabled = true;
    });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) enabled = !!changes.enabled.newValue;
  });

  // ---- helpers ------------------------------------------------------------
  function warnOnce(msg) {
    const now = Date.now();
    if (now - lastWarnAt < WARN_EVERY_MS) return;
    lastWarnAt = now;
    console.warn(LOG, msg);
  }

  function isActionable(el) {
    if (!el || el.disabled) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return false;
    const style = getComputedStyle(el);
    return (
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      style.opacity !== '0'
    );
  }

  function looksLikeSkipButton(el) {
    const text = (el.getAttribute('aria-label') || el.textContent || '')
      .trim()
      .toLowerCase();
    return (
      text === 'skip' ||
      text === 'skip ad' ||
      text === 'skip ads' ||
      text === 'skip this ad'
    );
  }

  function getPlayer() {
    return document.querySelector(PLAYER_SELECTOR);
  }

  function isAdActive() {
    const player = getPlayer();
    return (
      (player && player.classList.contains('ad-showing')) ||
      document.querySelector(AD_ACTIVE_SELECTOR) !== null
    );
  }

  function fireClick(el) {
    try {
      el.click();
    } catch (err) {
      try {
        el.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true, view: window })
        );
      } catch (e) {
        /* give up quietly */
      }
    }
  }

  function reportSkip() {
    try {
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({ type: 'ad-skipped' }).catch(() => {});
      }
    } catch (err) {
      /* extension context gone - ignore */
    }
  }

  // Ask the background worker to deliver a REAL trusted click at (x, y)
  // using the Chrome DevTools protocol (Input.dispatchMouseEvent).
  function requestTrustedClick(x, y) {
    return new Promise((resolve) => {
      const finish = (res) => resolve(res || { ok: false });
      try {
        chrome.runtime.sendMessage({ type: 'trusted-click', x, y }, (res) => {
          if (chrome.runtime.lastError) return finish(null);
          finish(res);
        });
      } catch (err) {
        finish(null);
      }
    });
  }

  // Center of the button in TOP-FRAME viewport coordinates (CSS px),
  // which is exactly the coordinate space the debugger click uses.
  function getViewportPoint(el) {
    if (!el) return null;
    try {
      const rect = el.getBoundingClientRect();
      let x = rect.left + rect.width / 2;
      let y = rect.top + rect.height / 2;

      let win = window;
      while (win !== win.top) {
        const fe = win.frameElement; // null when cross-origin
        if (!fe) return null;
        const fr = fe.getBoundingClientRect();
        x += fr.left;
        y += fr.top;
        win = win.parent;
      }
      return { x, y };
    } catch (err) {
      return null;
    }
  }

  // ---- detection ------------------------------------------------------------
  function findSkipButton() {
    for (const selector of SKIP_SELECTORS) {
      const matches = document.querySelectorAll(selector);
      for (const el of matches) {
        if (isActionable(el)) return el;
      }
    }

    // Text/aria-label fallback, scoped to the player so unrelated page
    // buttons (e.g. "Skip navigation") can never be clicked.
    const player = getPlayer();
    if (player) {
      const buttons = player.querySelectorAll('button');
      for (const btn of buttons) {
        if (isActionable(btn) && looksLikeSkipButton(btn)) return btn;
      }
    }
    return null;
  }

  function findOverlayCloseButton() {
    for (const selector of OVERLAY_CLOSE_SELECTORS) {
      const el = document.querySelector(selector);
      if (isActionable(el)) return el;
    }
    return null;
  }

  // ---- skipping -------------------------------------------------------------
  async function trustedClick(btn) {
    let point = getViewportPoint(btn);
    if (!point) {
      warnOnce('Cannot compute click coordinates (embedded/cross-origin player).');
      return false;
    }

    // Coordinates must be inside the visible viewport; scroll if needed.
    if (
      point.x < 1 ||
      point.y < 1 ||
      point.x > window.innerWidth - 1 ||
      point.y > window.innerHeight - 1
    ) {
      btn.scrollIntoView({ block: 'center', inline: 'center' });
      await sleep(250);
      btn = findSkipButton();
      if (!btn) return true; // ad ended on its own
      point = getViewportPoint(btn);
      if (!point) return false;
    }

    const res = await requestTrustedClick(point.x, point.y);
    await sleep(350);
    if (!findSkipButton()) return true; // skipped (or ended naturally)

    if (res && !res.ok) {
      const reason = String(res.reason || '');
      if (/another debugger|devtools/i.test(reason)) {
        warnOnce(
          'Cannot deliver a real click while DevTools (F12) is open on this tab. ' +
            'Close DevTools and the ad will be skipped automatically.'
        );
      } else if (/cancel/i.test(reason)) {
        warnOnce(
          'Trusted clicking was cancelled from the yellow banner. ' +
            'Reload the page to re-enable it.'
        );
      } else {
        warnOnce('Trusted click failed: ' + (reason || 'unknown error'));
      }
    }
    return false;
  }

  async function attemptSkip() {
    let btn = findSkipButton();
    if (!btn) return false;

    // Phase 1: ordinary programmatic click - enough on some player surfaces.
    fireClick(btn);
    await sleep(300);
    if (!findSkipButton()) return true;

    // Phase 2: YouTube ignored the synthetic click (isTrusted === false),
    // so deliver a REAL trusted click through the debugger protocol.
    btn = findSkipButton();
    if (!btn) return true; // ad ended on its own
    return trustedClick(btn);
  }

  // ---- scanning ---------------------------------------------------------------
  async function scan() {
    if (!enabled || attemptInFlight) return;
    const now = Date.now();
    if (now - lastClickAt < CLICK_COOLDOWN_MS) return;

    if (findSkipButton()) {
      attemptInFlight = true;
      lastClickAt = now;
      try {
        const ok = await attemptSkip();
        if (ok) {
          reportSkip();
          console.info(LOG, 'Skipped the ad.');
        }
      } finally {
        attemptInFlight = false;
      }
      return;
    }

    if (CLICK_OVERLAY_CLOSE) {
      const closeBtn = findOverlayCloseButton();
      if (closeBtn) {
        lastClickAt = now;
        fireClick(closeBtn);
        console.info(LOG, 'Closed a dismissible ad overlay.');
      }
    }
  }

  // ---- triggers ---------------------------------------------------------------
  // 1) React to any DOM change: covers YouTube's SPA navigation, ad
  //    insertion, countdown text updates, and button enable/disable.
  let scanTimer = null;
  const scheduleScan = () => {
    if (scanTimer !== null) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 120);
  };

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // 2) Safety net poll; also tells the background worker when ads
  //    start/end so it can attach/detach the debugger (and hide the banner).
  function notifyAdState(active) {
    try {
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({ type: 'ad-active', active }).catch(() => {});
      }
    } catch (err) {
      /* ignore */
    }
  }

  setInterval(() => {
    const active = isAdActive();
    if (active !== wasAdActive) {
      wasAdActive = active;
      notifyAdState(active);
    }
    scan();
  }, 250);

  scan(); // initial pass
})();
