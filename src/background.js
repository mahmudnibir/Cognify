// background.js

// ─── CDN segment cache ───────────────────────────────────────────────────────
// Maps tabId → Map<basePath, { url: string, byteEnd: number }>
//
// FB/IG DASH sends video and audio as separate .mp4 segment requests. They
// share the same CDN domain and look identical in the path EXCEPT that the
// video segment's byteEnd value is always much larger than the audio segment's.
//
// Strategy: collect ALL distinct .mp4 base-paths per tab, keyed by pathname
// (without byte-range params). When the content script asks for a download URL:
//   • Sort entries by byteEnd descending.
//   • Entry[0] = video stream (highest bitrate → largest segment range).
//   • Entry[1] = audio stream (second-distinct path, much smaller byteEnd).
//
// This is path-keyword-free, so it works regardless of how FB/IG name their
// DASH segment paths (they vary by CDN edge and content type).
const segmentCache = new Map(); // tabId → Map<basePath, {url, byteEnd}>

// Intercept actual video/audio CDN requests from IG/FB.
// Must be top-level so Chrome wakes the service worker for it.
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const { url, tabId } = details;
    if (tabId === -1) return;

    let parsed;
    try { parsed = new URL(url); } catch (_) { return; }

    // Only .mp4 paths — skip thumbnails, stickers, images.
    if (!parsed.pathname.includes('.mp4')) return;

    // byteend is the key DASH fingerprint — skip non-DASH requests (no byte range).
    const byteEnd = parseInt(parsed.searchParams.get('byteend') || '0', 10);
    if (byteEnd <= 0) return;

    // Use the pathname as the stable key for this stream — it does not change
    // between segment requests, only bytestart/byteend change.
    const basePath = parsed.pathname;

    let tabMap = segmentCache.get(tabId);
    if (!tabMap) { tabMap = new Map(); segmentCache.set(tabId, tabMap); }

    const existing = tabMap.get(basePath);
    // Keep only the entry with the largest byteEnd for this path (= best quality).
    if (existing && byteEnd <= existing.byteEnd) return;

    // Strip byte-range params but preserve all CDN auth tokens (_nc_ht, efg, etc.)
    // Without auth tokens the CDN returns 403.
    parsed.searchParams.delete('bytestart');
    parsed.searchParams.delete('byteend');
    parsed.search = parsed.searchParams.toString() ? `?${parsed.searchParams.toString()}` : '';

    tabMap.set(basePath, { url: parsed.toString(), byteEnd });
  },
  { urls: ['*://*.cdninstagram.com/*', '*://*.fbcdn.net/*'], types: ['media', 'xmlhttprequest'] }
);

// Clear cache when a tab closes or navigates away.
chrome.tabs.onRemoved.addListener((tabId) => {
  segmentCache.delete(tabId);
});

// ─── Site-time tracking for Instagram & Facebook ─────────────────────────────
let activeTabId = null;
let activeTabDomain = null;
let activeTabUrl = null;
let lastActiveTime = null;

function getDomain(url) {
  try {
    const h = new URL(url).hostname;
    if (h.includes('instagram.com')) return 'ig';
    if (h.includes('facebook.com') || h.includes('fb.com') || h.includes('messenger.com')) return 'fb';
    if (h.includes('youtube.com')) return 'yt';
    return null;
  } catch (_) { return null; }
}

function isChat(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('instagram.com') && u.pathname.startsWith('/direct/')) return true;
    if (u.hostname.includes('messenger.com')) return true;
    if (u.hostname.includes('facebook.com') && u.pathname.startsWith('/messages/')) return true;
    return false;
  } catch (_) { return false; }
}

/**
 * Mapping from domain code to the chrome.storage.sync limit-setting key.
 */
const LIMIT_KEY = { yt: 'ytDailyLimit', ig: 'igDailyLimit', fb: 'fbDailyLimit' };

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
  const chat = isChat(activeTabUrl || '');
  chrome.storage.local.get([key], (localData) => {
    const stats = localData[key] || { dailyData: {} };
    const day = stats.dailyData[today] || { activeTime: 0, videosWatched: 0, chatTime: 0 };
    day.activeTime = (day.activeTime || 0) + elapsed;
    if (chat) day.chatTime = (day.chatTime || 0) + elapsed;
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
  activeTabUrl = url;
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Clear cached CDN segment URLs when the tab navigates to a new page.
  if (changeInfo.status === 'loading') {
    segmentCache.delete(tabId);
  }
  if (tabId !== activeTabId || !changeInfo.url) return;
  const newDomain = getDomain(changeInfo.url);
  if (newDomain === activeTabDomain) {
    // Same platform — just update URL for chat detection, don't reset the clock
    activeTabUrl = changeInfo.url;
  } else {
    // Domain actually changed — flush + restart
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
  if (request.type === 'getLastVideoUrl') {
    // Derive video + audio URLs from the segmentCache for this tab.
    // Sort all tracked DASH segments by byteEnd descending:
    //   [0] = video stream (largest byte range = highest bitrate)
    //   [1] = audio stream (second-distinct path, much smaller byte range)
    const tabId   = sender.tab?.id;
    const tabMap  = tabId != null ? segmentCache.get(tabId) : null;
    let videoUrl  = null;
    let audioUrl  = null;

    if (tabMap && tabMap.size > 0) {
      // Sort entries by byteEnd descending.
      const sorted = Array.from(tabMap.values())
        .sort((a, b) => b.byteEnd - a.byteEnd);
      videoUrl = sorted[0]?.url || null;
      // Audio is the second entry IF its byteEnd is meaningfully smaller than video
      // (at least 4× smaller — prevents two near-identical video renditions being
      // misidentified as video+audio).
      if (sorted.length >= 2 && sorted[0].byteEnd >= sorted[1].byteEnd * 4) {
        audioUrl = sorted[1].url;
      }
    }

    sendResponse({ url: videoUrl, audioUrl });
    return false;
  }
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
  if (request.type === 'socialVideoPlay') {
    const { domain } = request;
    if (domain !== 'ig' && domain !== 'fb') return;
    const today = new Date().toDateString();
    const key = `${domain}Stats`;
    chrome.storage.local.get([key], (data) => {
      const stats = data[key] || { dailyData: {} };
      const day = stats.dailyData[today] || { activeTime: 0, videosWatched: 0 };
      day.videosWatched = (day.videosWatched || 0) + 1;
      stats.dailyData[today] = day;
      chrome.storage.local.set({ [key]: stats });
    });
  }
  if (request.type === 'socialScrollUpdate') {
    const { domain, count } = request;
    if ((domain !== 'ig' && domain !== 'fb') || !count) return;
    const today = new Date().toDateString();
    const key = `${domain}Stats`;
    chrome.storage.local.get([key], (data) => {
      const stats = data[key] || { dailyData: {} };
      const day = stats.dailyData[today] || { activeTime: 0, videosWatched: 0, chatTime: 0, scrollCount: 0 };
      day.scrollCount = (day.scrollCount || 0) + count;
      stats.dailyData[today] = day;
      chrome.storage.local.set({ [key]: stats });
    });
  }
  if (request.type === 'downloadVideo') {
    const { url, filename, saveAs = true } = request;
    // saveAs: true opens the native OS "Save As" dialog (default for the main video).
    // Pass saveAs: false for secondary files (e.g. companion audio) to auto-save.
    chrome.downloads.download({ url, filename, saveAs }, (id) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, downloadId: id });
      }
    });
    return true; // keep message channel open for async response
  }
});
