const toggle = document.getElementById('toggle');
const countEl = document.getElementById('count');
const statusDot = document.getElementById('statusDot');

function refreshStatus(isEnabled) {
  statusDot.classList.toggle('off', !isEnabled);
}

chrome.storage.local
  .get({ enabled: true, skipCount: 0 })
  .then(({ enabled, skipCount }) => {
    toggle.checked = enabled;
    countEl.textContent = skipCount || 0;
    refreshStatus(enabled);
  });

toggle.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: toggle.checked });
  refreshStatus(toggle.checked);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.skipCount) countEl.textContent = changes.skipCount.newValue || 0;
  if (changes.enabled) {
    toggle.checked = changes.enabled.newValue;
    refreshStatus(changes.enabled.newValue);
  }
});
