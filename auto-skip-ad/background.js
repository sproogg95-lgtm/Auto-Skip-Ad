/* Auto Skip Ad Button - service worker v1.1
 *
 * Badge + skip counter, plus the trusted-click engine: uses the
 * chrome.debugger API to send a REAL mouse event (isTrusted: true)
 * at the skip button's coordinates. YouTube ignores synthetic clicks,
 * but cannot distinguish these from your physical mouse.
 */

const DEFAULTS = { enabled: true, skipCount: 0 };

const attachedTabs = new Set();   // tabs where we hold a debugger session
const cancelledTabs = new Set();  // tabs where the user hit "Cancel" on the banner

// ---- badge -----------------------------------------------------------------
function updateBadge(count) {
  const text = count > 0 ? String(Math.min(count, 999)) : '';
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: '#cc0000' });
}

// ---- debugger helpers (callback-wrapped so they always work in MV3) -------
function attachDebugger(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

function detachDebugger(tabId) {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      void chrome.runtime.lastError; // ignore "not attached"
      resolve();
    });
  });
}

function sendCmd(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
}

async function ensureAttached(tabId) {
  if (attachedTabs.has(tabId)) return;
  try {
    await attachDebugger(tabId);
    attachedTabs.add(tabId);
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (/another debugger/i.test(msg)) {
      // DevTools or another extension holds this tab's debugger.
      const e = new Error('devtools-open: ' + msg);
      throw e;
    }
    if (/already attached/i.test(msg)) {
      // Almost certainly our own session after a service-worker restart.
      attachedTabs.add(tabId);
      return;
    }
    throw err;
  }
}

// Deliver a genuine trusted click: move -> press -> release (left button).
async function dispatchTrustedClick(tabId, x, y) {
  await sendCmd(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
    buttons: 0,
    clickCount: 0,
  });
  await sendCmd(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await sendCmd(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
}

// ---- lifecycle ---------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(DEFAULTS, (cfg) => {
    chrome.storage.local.set(cfg);
    updateBadge(cfg.skipCount || 0);
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get({ skipCount: 0 }, ({ skipCount }) => {
    updateBadge(skipCount || 0);
  });
});

// A page (re)load gives trusted clicking a fresh chance after a cancel.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info && info.status === 'complete') cancelledTabs.delete(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
  cancelledTabs.delete(tabId);
});

// User pressed "Cancel" on the yellow banner (or target closed).
chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source && source.tabId;
  if (tabId == null) return;
  attachedTabs.delete(tabId);
  if (reason === 'canceled_by_user') cancelledTabs.add(tabId);
});

// ---- messages ----------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender && sender.tab && sender.tab.id;

  // Content script found the skip button and needs a REAL click.
  if (msg && msg.type === 'trusted-click' && tabId != null) {
    if (cancelledTabs.has(tabId)) {
      sendResponse({ ok: false, reason: 'cancelled by user' });
      return false;
    }
    (async () => {
      try {
        await ensureAttached(tabId);
        await dispatchTrustedClick(tabId, msg.x, msg.y);
        sendResponse({ ok: true });
      } catch (err) {
        const reason = String((err && err.message) || err);
        attachedTabs.delete(tabId);
        sendResponse({ ok: false, reason });
      }
    })();
    return true; // async response
  }

  // Ads started/ended: detach the debugger when ads end so the yellow
  // "debugging this browser" banner disappears between ads.
  if (msg && msg.type === 'ad-active' && tabId != null && msg.active === false) {
    detachDebugger(tabId).then(() => attachedTabs.delete(tabId));
    return false;
  }

  // A skip was verified - bump the counter/badge.
  if (msg && msg.type === 'ad-skipped') {
    chrome.storage.local.get({ skipCount: 0 }, ({ skipCount }) => {
      const total = (skipCount || 0) + 1;
      chrome.storage.local.set({ skipCount: total });
      updateBadge(total);
    });
  }
  return false;
});
