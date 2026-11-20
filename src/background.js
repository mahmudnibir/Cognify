// background.js
// Note: ytdl-core-browser is not available in service worker context
// YouTube download functionality requires a different approach

// ─── Error Logging System (Development) ─────────────────────────────────────
const ERROR_LOG_KEY = 'extensionErrorLogs';
const MAX_ERROR_LOGS = 100; // Keep last 100 errors

function addErrorLog(message, source = 'background', error = null) {
  const timestamp = Date.now();
  const errorMsg = error ? `${message} | ${error.message}` : message;
  
  chrome.storage.local.get([ERROR_LOG_KEY], (data) => {
    let logs = data[ERROR_LOG_KEY] || [];
    logs.push({ timestamp, message: errorMsg, source });
    // Keep only last MAX_ERROR_LOGS
    if (logs.length > MAX_ERROR_LOGS) logs = logs.slice(-MAX_ERROR_LOGS);
    chrome.storage.local.set({ [ERROR_LOG_KEY]: logs });
  });
}

// Capture unhandled errors and promise rejections
self.addEventListener('error', (event) => {
  addErrorLog(`Error: ${event.message}`, 'background', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  addErrorLog(`Unhandled Promise Rejection: ${event.reason}`, 'background');
});

// ─── YouTube watch-time tracking ─────────────────────────────────────────────
let activeTabId = null;
let activeTabDomain = null;
let lastActiveTime = null;

function getDomain(url) {
  try {
    return new URL(url).hostname === 'www.youtube.com' ? 'yt' : null;
  } catch (_) { return null; }
}

/**
 * Mapping from domain code to the chrome.storage.sync limit-setting key.
 */
const LIMIT_KEY = { yt: 'ytDailyLimit' };

/**
 * Sends a timeLimitHit action to all tabs on the active domain so the
 * content script can show the soft-block overlay.
 */
function notifyTimeLimitHit(domain) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (getDomain(tab.url || '') === domain) {
        chrome.tabs.sendMessage(tab.id, { action: 'timeLimitHit', domain }).catch(() => {});
      }
    }
  });
}

function recordTime(domain) {
  if (!domain || !lastActiveTime) return;
  const elapsed = Math.round((Date.now() - lastActiveTime) / 1000);
  if (elapsed <= 0 || elapsed > 7200) { lastActiveTime = null; return; }
  const today = new Date().toDateString();
  const key = `${domain}Stats`;
  chrome.storage.local.get([key], (localData) => {
    const stats = localData[key] || { dailyData: {} };
    const day = stats.dailyData[today] || { activeTime: 0, videosWatched: 0 };
    day.activeTime = (day.activeTime || 0) + elapsed;
    stats.dailyData[today] = day;
    chrome.storage.local.set({ [key]: stats });

    // ── Screen time limit check ──────────────────────────────────────────
    const limitSettingKey = LIMIT_KEY[domain];
    if (limitSettingKey) {
      chrome.storage.sync.get([limitSettingKey, `${domain}LimitEnabled`], (syncData) => {
        if (!syncData[`${domain}LimitEnabled`]) return;
        const limitMinutes = parseInt(syncData[limitSettingKey] || '0', 10);
        if (limitMinutes <= 0) return;
        const todaySeconds = day.activeTime;
        // Notify once per minute after the limit is crossed (not on every 10s flush)
        if (todaySeconds >= limitMinutes * 60 && todaySeconds < limitMinutes * 60 + 65) {
          notifyTimeLimitHit(domain);
        }
      });
    }
  });
  lastActiveTime = Date.now();
}

function switchActive(tabId, url) {
  recordTime(activeTabDomain);
  activeTabId = tabId;
  activeTabDomain = getDomain(url);
  lastActiveTime = activeTabDomain ? Date.now() : null;
}

// Generation counter — incremented on every onActivated so stale async callbacks are ignored
let activationGen = 0;

chrome.tabs.onActivated.addListener((info) => {
  const gen = ++activationGen;
  chrome.tabs.get(info.tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    if (gen !== activationGen) return; // stale callback — a newer activation already won
    switchActive(info.tabId, tab.url || '');
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== activeTabId || !changeInfo.url) return;
  const newDomain = getDomain(changeInfo.url);
  if (newDomain !== activeTabDomain) {
    switchActive(tabId, changeInfo.url);
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    recordTime(activeTabDomain);
    lastActiveTime = null;
  } else {
    const gen = ++activationGen;
    chrome.tabs.query({ active: true, windowId }, (tabs) => {
      if (gen !== activationGen) return;
      if (tabs && tabs[0]) switchActive(tabs[0].id, tabs[0].url || '');
    });
  }
});

// Periodic flush every 10 s so time is written continuously, not just on tab switches
setInterval(() => {
  if (activeTabDomain && lastActiveTime) {
    recordTime(activeTabDomain);
  }
}, 10000);

// ─── Message handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'getCloudSync') {
    chrome.storage.sync.get(['cloudSync'], (data) => {
      sendResponse({ cloudSync: data.cloudSync });
    });
    return true;
  }
  if (request.type === 'getShortcuts') {
    chrome.storage.sync.get(['shortcuts'], (data) => {
      sendResponse({ shortcuts: data.shortcuts });
    });
    return true;
  }
  if (request.type === 'downloadVideo') {
    const videoId = request.videoId;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // YouTube video download is handled by the content script using yt-dlp or similar
    // Service worker cannot directly use npm packages for this task
    // Delegate to content script or open download page
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'initiateYouTubeDownload',
          videoUrl: videoUrl,
          videoId: videoId
        }).catch((err) => {
          console.error('Could not send download message to content script:', err);
          addErrorLog(`Failed to send download message: ${err.message}`, 'background', err);
        });
      }
    });
    return true; // Indicates that the response is sent asynchronously
  }
  if (request.type === 'getErrorLogs') {
    chrome.storage.local.get([ERROR_LOG_KEY], (data) => {
      sendResponse({ logs: data[ERROR_LOG_KEY] || [] });
    });
    return true;
  }
  if (request.type === 'clearErrorLogs') {
    chrome.storage.local.set({ [ERROR_LOG_KEY]: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  if (request.type === 'logError') {
    const { message, source, error } = request;
    addErrorLog(message, source || 'content', error);
    sendResponse({ success: true });
  }
});

