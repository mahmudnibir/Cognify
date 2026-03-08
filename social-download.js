/**
 * social-download.js
 *
 * Injects a "Download Reel" / "Download Video" button directly into
 * Instagram and Facebook's native 3-dot context menus (the bottom-sheet
 * overlay that appears when a user taps ••• on a Reel or video post).
 *
 * Flow:
 *  1. MutationObserver watches for newly-added dialog / menu nodes.
 *  2. When a node appears that contains known menu-item text (Save, Copy link…)
 *     it is identified as a video-options menu.
 *  3. A visually-matching download button is prepended to that menu.
 *  4. On click the best HTTP(S) video src is found on the page and a
 *     { type: 'downloadVideo', url, filename } message is sent to background.js,
 *     which calls chrome.downloads.download() with the CDN URL.
 */
(function () {
  'use strict';

  const isIG = location.hostname.includes('instagram.com');
  const isFB =
    location.hostname.includes('facebook.com') ||
    location.hostname.includes('fb.com');

  if (!isIG && !isFB) return;

  // ── Hide Messenger (Facebook only) ───────────────────────────────────────
  // Injects/removes a <style> based on the `hideFbMessenger` setting.
  // A MutationObserver re-applies the style after SPA navigations.
  // A storage.onChanged listener toggles it instantly when the popup toggle
  // is flipped — no page refresh required.
  if (isFB) {
    const STYLE_ID = 'yt-ext-hide-messenger';
    const MESSENGER_CSS = `
      /* Navbar Messenger / Chats icon */
      [aria-label="Messenger"],
      [aria-label="Chats"],
      a[href*="messenger.com"],
      a[href="/messages"],
      a[href^="/messages/"],
      [data-pagelet="MercuryJewelSection"],
      /* Floating chat heads / bubble */
      [data-pagelet="ChatTabsNewRegion"],
      [data-testid="mwthreadlist-thread-anchor"],
      /* Desktop right-rail chat sidebar */
      [data-pagelet="ChatSidebar"],
      /* Bottom chat tab bar */
      #ChatTabBar,
      [data-pagelet*="Jenga"] { display: none !important; }
    `;

    // Inject the style tag if not already present.
    function injectMessengerStyle() {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = MESSENGER_CSS;
      (document.head || document.documentElement).appendChild(style);
    }

    // Remove the style tag to restore Messenger elements.
    function removeMessengerStyle() {
      const el = document.getElementById(STYLE_ID);
      if (el) el.remove();
    }

    // Keeps a reference to the MutationObserver so we can disconnect it
    // when the user disables the setting without a refresh.
    let spaObserver = null;

    function enableHideMessenger() {
      injectMessengerStyle();
      if (!spaObserver) {
        // Re-inject after every FB SPA navigation that rebuilds the navbar.
        spaObserver = new MutationObserver(injectMessengerStyle);
        spaObserver.observe(document.documentElement, { childList: true, subtree: true });
      }
    }

    function disableHideMessenger() {
      removeMessengerStyle();
      if (spaObserver) {
        spaObserver.disconnect();
        spaObserver = null;
      }
    }

    // Apply on page load based on stored setting.
    chrome.storage.sync.get(['hideFbMessenger'], (data) => {
      if (data.hideFbMessenger) enableHideMessenger();
    });

    // React instantly when the popup toggle is changed.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !('hideFbMessenger' in changes)) return;
      if (changes.hideFbMessenger.newValue) {
        enableHideMessenger();
      } else {
        disableHideMessenger();
      }
    });
  }

  const ITEM_ID    = 'yt-ext-dl-item';
  const TOAST_ID   = 'yt-ext-dl-toast';
  const LABEL      = isIG ? 'Download Reel' : 'Download Video';

  // Keywords that identify post-options menus (any post type).
  // These are broad on purpose — they just confirm this DOM node is a post
  // options sheet, not a login modal or settings panel.
  // Whether the post is a video is checked separately via click tracking.
  const MENU_HINTS = isIG
    ? ['save', 'reel', 'copy link', 'report', 'not interested']
    : ['copy link', 'save video', 'report', 'hide post', 'snooze', 'share'];

  // Track the element that was tapped/clicked most recently so we can walk
  // up to the containing post and verify it has a <video>.
  let lastClickTarget = null;
  document.addEventListener('click', (e) => { lastClickTarget = e.target; }, { capture: true, passive: true });

  // ── Resilient sendMessage wrapper ────────────────────────────────────────
  /**
   * Wraps chrome.runtime.sendMessage with:
   *  - Automatic lastError consumption to silence "Unchecked runtime.lastError".
   *  - One automatic retry (after 300 ms) when the MV3 service worker is asleep
   *    ("No SW" / "Could not establish connection" errors). Chrome wakes the SW
   *    on the retry attempt.
   *
   * @param {object}   msg      - Message object to send.
   * @param {function} callback - Called with (response) on success, or (null) on
   *                              unrecoverable failure.
   */
  function sendMsg(msg, callback) {
    const cb = callback || (() => {});
    const SW_ERRORS = ['no sw', 'could not establish connection', 'message port closed', 'receiving end does not exist'];
    const isSWError = (err) => SW_ERRORS.some(s => (err?.message || '').toLowerCase().includes(s));

    // Retry schedule: 300ms, 800ms, 1600ms — covers MV3 SW cold-start (~1s worst case).
    const DELAYS = [300, 800, 1600];

    const attempt = (retryIdx) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          const err = chrome.runtime.lastError; // always consumed
          if (err) {
            if (retryIdx < DELAYS.length && isSWError(err)) {
              setTimeout(() => attempt(retryIdx + 1), DELAYS[retryIdx]);
              return;
            }
            cb(null);
            return;
          }
          cb(res);
        });
      } catch (_) {
        cb(null);
      }
    };

    attempt(0);
  }

  // ── Extract a progressive (audio+video) URL from Facebook's page JSON ───
  /**
   * Facebook embeds video metadata as JSON inside <script> tags. Progressive
   * MP4 URLs (browser_native_hd_url, playable_url, etc.) contain a muxed
   * audio+video stream — unlike DASH segments which carry only one track.
   *
   * Checks HD first, then SD, then generic playable URLs. Falls back to null
   * if the page has no embedded progressive URL (e.g. DASH-only Reels).
   *
   * @returns {string|null} HTTP(S) progressive video URL or null
   */
  function getFBProgressiveUrl() {
    // Priority order: confirmed muxed (browser_native_*) → Watch-style HD/SD → quality-tagged → generic.
    // browser_native_* keys are guaranteed to be muxed progressive MP4s.
    // hd_src / sd_src are used on FB Watch and classic video posts.
    // playable_url is a last resort — it may point to a DASH init segment on newer Reels.
    const patterns = [
      /"browser_native_hd_url"\s*:\s*"(https?[^"]+)"/,
      /"browser_native_sd_url"\s*:\s*"(https?[^"]+)"/,
      /"hd_src_no_ratelimit"\s*:\s*"(https?[^"]+)"/,
      /"sd_src_no_ratelimit"\s*:\s*"(https?[^"]+)"/,
      /"hd_src"\s*:\s*"(https?[^"]+)"/,
      /"sd_src"\s*:\s*"(https?[^"]+)"/,
      /"playable_url_quality_hd"\s*:\s*"(https?[^"]+)"/,
      /"playable_url"\s*:\s*"(https?[^"]+)"/,
    ];

    /**
     * Decode a raw matched URL string: handles JSON Unicode escapes (\u0026 → &)
     * and forward-slash escapes (\/ → /), which Facebook frequently uses.
     */
    const decodeUrl = (raw) => {
      try {
        return JSON.parse(`"${raw}"`);
      } catch (_) {
        return raw
          .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
          .replace(/\\\//g, '/');
      }
    };

    for (const script of document.querySelectorAll('script')) {
      const text = script.textContent || '';
      if (
        !text.includes('playable_url') &&
        !text.includes('browser_native') &&
        !text.includes('hd_src') &&
        !text.includes('sd_src')
      ) continue;

      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const url = decodeUrl(match[1]);
        if (!url.startsWith('http')) continue;
        // Skip DASH init segments — they are video-only and contain no audio track.
        if (url.includes('dashinit') || url.includes('dash_init')) continue;
        return url;
      }
    }
    return null;
  }

  // ── Locate the best playable video URL on the active page ───────────────
  /**
   * Iterates all <video> elements sorted by duration (longest first), so the
   * main content is preferred over avatar loops or thumbnail previews.
   * Returns the first CDN URL found, or null if none is available yet.
   *
   * @returns {string|null} HTTP(S) video URL or null
   */
  function getBestVideoSrc() {
    const videos = Array.from(document.querySelectorAll('video'));
    videos.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    for (const v of videos) {
      const src = v.currentSrc || v.src || '';
      if (src.startsWith('http')) return src;
      // Fallback: explicit <source> children
      for (const s of v.querySelectorAll('source')) {
        if ((s.src || '').startsWith('http')) return s.src;
      }
    }
    return null;
  }

  // ── Dispatch the download via background.js ──────────────────────────────
  /**
   * Resolves the video URL and triggers a local download via background.js.
   *
   * Strategy:
   *  1. (FB only) Parse the page's embedded JSON for a progressive (muxed
   *     audio+video) MP4 URL — browser_native_hd_url / playable_url etc.
   *     This is the preferred path because DASH segments are video-only.
   *  2. Ask background for the CDN URL it intercepted via webRequest — the
   *     real mp4 URL when <video>.currentSrc is a blob: (MSE player).
   *  3. Fall back to scanning the DOM for any <video> with a plain http URL
   *     (works for FB Watch and other non-MSE embeds).
   *  4. If the only URL found is still a blob, show a clear error.
   */
  function triggerDownload() {
    // Step 1 — For Facebook, try to extract a progressive (audio+video) URL
    // directly from the page's embedded JSON. Progressive MP4s contain both
    // tracks; the DASH segments captured by webRequest are video-only.
    if (isFB) {
      const progressiveUrl = getFBProgressiveUrl();
      if (progressiveUrl) {
        const filename = `facebook_${Date.now()}.mp4`;
        sendMsg({ type: 'downloadVideo', url: progressiveUrl, filename }, (res) => {
          if (!res?.success) {
            showPageToast('❌ Download failed. Try again.');
          } else {
            showPageToast('✅ Download started!');
          }
        });
        return;
      }
    }

    // Step 2 — ask the background for the CDN video (and audio) URL captured by webRequest.
    sendMsg({ type: 'getLastVideoUrl' }, (cdnRes) => {
      const cachedUrl      = cdnRes?.url      || null;
      // Audio DASH URL — only present when DASH is used and an audio segment was seen.
      const cachedAudioUrl = cdnRes?.audioUrl || null;

      // Step 3 — fall back to DOM scan for non-MSE players.
      const domSrc = getBestVideoSrc();

      // Prefer the intercepted CDN URL; fall back to DOM src.
      const src = cachedUrl || domSrc;

      if (!src) {
        showPageToast('❌ No downloadable video found. Let the reel play for a moment, then try again.');
        return;
      }
      if (src.startsWith('blob:')) {
        showPageToast('❌ Video still loading — wait a moment and try again.');
        return;
      }

      // DASH video-only: cachedUrl exists but no plain-HTTP dom source was found.
      const isDashVideoOnly = !!cachedUrl && !domSrc?.startsWith('http');

      const platform = isIG ? 'instagram' : 'facebook';
      const ts        = Date.now();
      const filename  = `${platform}_${ts}.mp4`;

      sendMsg({ type: 'downloadVideo', url: src, filename }, (res) => {
        if (!res?.success) {
          showPageToast('❌ Download failed. Try again.');
          return;
        }

        // If we only have a DASH video stream AND we also captured the audio stream,
        // trigger a second automatic download for the audio so the user has both files.
        if (isDashVideoOnly && cachedAudioUrl) {
          const audioFilename = `${platform}_${ts}_audio.mp4`;
          // saveAs: false — auto-saves silently so only the video triggers a Save dialog.
          sendMsg({ type: 'downloadVideo', url: cachedAudioUrl, filename: audioFilename, saveAs: false }, () => {});
          showPageToast('⚠️ Saved as 2 files (video + audio) — merge them in any video editor.');
        } else if (isDashVideoOnly) {
          showPageToast('⚠️ Download started — audio unavailable (DASH-only reel).');
        } else {
          showPageToast('✅ Download started!');
        }
      });
    });
  }

  // ── Minimal fixed-position toast for user feedback ───────────────────────
  /**
   * Renders a brief toast at the bottom-centre of the page and removes it
   * after 3 seconds. Only one toast is shown at a time.
   *
   * @param {string} text - Message with an optional leading ✅ or ❌ emoji.
   */
  function showPageToast(text) {
    let t = document.getElementById(TOAST_ID);
    if (t) t.remove();

    t = document.createElement('div');
    t.id = TOAST_ID;

    const ok = text.startsWith('✅');
    Object.assign(t.style, {
      position:   'fixed',
      bottom:     '80px',
      left:       '50%',
      transform:  'translateX(-50%)',
      background: ok ? 'rgba(16,185,129,0.95)' : 'rgba(239,68,68,0.95)',
      color:      '#fff',
      fontSize:   '13px',
      fontWeight: '600',
      padding:    '10px 22px',
      borderRadius: '24px',
      zIndex:     '2147483647',
      whiteSpace: 'nowrap',
      boxShadow:  '0 4px 20px rgba(0,0,0,0.5)',
      pointerEvents: 'none',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    });
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => { if (t.parentNode) t.remove(); }, 3000);
  }

  // ── Build the injected menu item element ──────────────────────────────────
  /**
   * Creates a menu row visually and structurally identical to native items.
   * Clones the reference element's tag name and class list so it inherits
   * Facebook/Instagram's own layout and stacking context — this is critical
   * because a plain <button> can sit in a different stacking layer.
   *
   * Clickability is handled separately by setupClickCapture(), which attaches
   * window-level capture listeners so the tap fires before any overlay.
   *
   * @param {Element|null} referenceItem - An existing sibling menu item.
   * @returns {HTMLElement}
   */
  function buildDownloadItem(referenceItem) {
    // Clone tag name + class list from the native item so our row is part of
    // the same CSS stacking / flex context as every other item in the sheet.
    const tagName = referenceItem ? referenceItem.tagName.toLowerCase() : 'div';
    const item    = document.createElement(tagName);
    item.id       = ITEM_ID;
    if (tagName === 'button') item.type = 'button';

    // Copy native class list so layout, spacing, and hover styles match exactly
    if (referenceItem) {
      referenceItem.classList.forEach(cls => item.classList.add(cls));
    }

    // Copy ARIA role so screen readers and FB's own event delegation treat it
    // the same as other interactive items in the sheet.
    const refRole = referenceItem?.getAttribute('role');
    item.setAttribute('role', refRole || 'menuitem');
    item.setAttribute('tabindex', '0');

    // Read computed styles from the reference item for font/spacing parity.
    // We deliberately do NOT copy padding/display from computed styles because
    // those are already provided by the cloned class list — overriding them
    // inline would break the class-driven layout.
    const ref        = referenceItem ? getComputedStyle(referenceItem) : null;
    const fontSize   = ref?.fontSize   || '15px';
    const fontFamily = ref?.fontFamily ||
      '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const minHeight  = ref?.minHeight && ref.minHeight !== '0px' ? ref.minHeight : '48px';

    // Only apply styles that the cloned classes may not cover.
    Object.assign(item.style, {
      display:                 'flex',
      alignItems:              'center',
      gap:                     '16px',
      width:                   '100%',
      minHeight,
      padding:                 ref?.padding || '12px 16px',
      background:              'transparent',
      border:                  'none',
      cursor:                  'pointer',
      fontSize,
      fontWeight:              '400',
      color:                   '#ffffff',
      textAlign:               'left',
      fontFamily,
      lineHeight:              '1.4',
      boxSizing:               'border-box',
      userSelect:              'none',
      WebkitTapHighlightColor: 'transparent',
    });

    // 24 px icon matches native IG/FB menu icon sizing
    item.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
           viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
           aria-hidden="true" style="flex-shrink:0;opacity:0.9;display:block">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <span>${LABEL}</span>`;

    item.addEventListener('mouseenter', () => {
      item.style.background = 'rgba(255,255,255,0.08)';
    });
    item.addEventListener('mouseleave', () => {
      item.style.background = 'transparent';
    });

    return item;
  }

  // ── Window-level capture handler for the download button ─────────────────
  /**
   * Facebook's Reels feed has a fullscreen overlay (for swipe-to-next handling)
   * that sits above the menu in the paint order. Because the overlay wins the
   * CSS hit-test, events dispatched to it — not to our button — regardless of
   * z-index or stopPropagation on the button itself.
   *
   * The only reliable fix is to listen at the window level in the CAPTURE phase,
   * which fires before ANY element on the page receives the event, and then
   * check whether the tap coordinates fall within our button's bounding rect.
   *
   * Registers mousedown (desktop) and touchstart (mobile/touch). Automatically
   * removes itself once the button leaves the DOM.
   *
   * @param {HTMLElement} item - The injected download button.
   */
  function setupClickCapture(item) {
    const handler = (e) => {
      // Remove listeners as soon as the item is gone
      if (!item.isConnected) {
        window.removeEventListener('mousedown',  handler, true);
        window.removeEventListener('touchstart', handler, true);
        return;
      }

      const rect = item.getBoundingClientRect();
      // If the rect is zero the item isn't painted yet — skip
      if (!rect.width || !rect.height) return;

      // Resolve tap coordinates for both mouse and touch
      const cx = e.clientX  ?? e.touches?.[0]?.clientX  ?? -1;
      const cy = e.clientY  ?? e.touches?.[0]?.clientY  ?? -1;

      if (cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom) {
        // Hit! Stop the event so the overlay doesn't also handle it.
        e.stopPropagation();
        e.stopImmediatePropagation();
        triggerDownload();
      }
    };

    window.addEventListener('mousedown',  handler, true);
    // passive: false so we can call stopImmediatePropagation on touchstart
    window.addEventListener('touchstart', handler, { capture: true, passive: false });

    // Lightweight cleanup poll — cheaper than a full MutationObserver
    const poll = setInterval(() => {
      if (!item.isConnected) {
        window.removeEventListener('mousedown',  handler, true);
        window.removeEventListener('touchstart', handler, true);
        clearInterval(poll);
      }
    }, 500);
  }

  // ── Check if the last 3-dot click came from inside a video post ──────────
  /**
   * Walks up the DOM from the last clicked element (the 3-dot button) to find
   * the containing post/article node and checks whether it has a meaningful
   * <video> element. This is the authoritative video-post guard:
   * - Text/image posts have no <video> → returns false → no button injected.
   * - Video posts have a <video> in their container → returns true.
   *
   * Falls back to true on full-screen Reel/Watch pages where the whole
   * viewport is the video context (lastClickTarget may be outside a post div).
   *
   * @returns {boolean}
   */
  function lastClickWasOnVideoPost() {
    if (!lastClickTarget) return false;
    let el = lastClickTarget;
    for (let depth = 0; depth < 25; depth++) {
      if (!el || el === document.documentElement) break;
      // Check each ancestor for an embedded <video> with real content.
      for (const v of el.querySelectorAll('video')) {
        const src = v.currentSrc || v.src || '';
        if (src.startsWith('http') || src.startsWith('blob:') || v.duration > 0) return true;
      }
      el = el.parentElement;
    }
    return false;
  }

  // ── Check whether a node looks like a post-options menu ──────────────────
  /**
   * Returns true when the node's text content contains at least one of the
   * known post-menu phrases. This confirms the node is a post options sheet,
   * not a login dialog or settings panel. Whether it is specifically a video
   * post is determined by lastClickWasOnVideoPost().
   *
   * @param {Element} node
   * @returns {boolean}
   */
  function isVideoOptionsMenu(node) {
    const text = (node.textContent || '').toLowerCase();
    return MENU_HINTS.some(hint => text.includes(hint));
  }

  // ── Inject the download button into a candidate menu node ────────────────
  /**
   * Validates the node, finds the list of interactive items, then prepends the
   * download button above the first item.  Idempotent — skips if already
   * injected.
   *
   * @param {Element} menuNode
   */
  function tryInject(menuNode) {
    // Skip if already injected into this node's subtree
    if (menuNode.querySelector('#' + ITEM_ID)) return;

    // Only inject when the menu text signals a video post
    if (!isVideoOptionsMenu(menuNode)) return;

    // Secondary guard: only inject when the 3-dot tap came from a post that
    // contains a <video> element. This is the key check that differentiates
    // text/image posts (no video in their container) from video posts.
    if (!lastClickWasOnVideoPost()) return;

    // Collect interactive items (buttons / role=button / role=menuitem)
    const items = Array.from(
      menuNode.querySelectorAll('button, [role="button"], [role="menuitem"]')
    ).filter(el => el.textContent.trim().length > 1 && !el.id);

    // Require at least 2 real items so we don't accidentally target tiny overlays
    if (items.length < 2) return;

    const firstItem = items[0];
    const dlItem    = buildDownloadItem(firstItem);

    // Insert before the first real menu item
    firstItem.parentNode.insertBefore(dlItem, firstItem);

    // Attach window-level click capture so the button works even when
    // Facebook's fullscreen overlay intercepts the hit-test.
    setupClickCapture(dlItem);
  }

  // ── MutationObserver — watch for new modal / menu nodes ──────────────────
  const observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node.nodeType !== 1) continue;

        // Collect the node itself plus any dialog/menu descendants
        const candidates = [
          node,
          ...node.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"]'),
        ];

        for (const candidate of candidates) {
          tryInject(candidate);
        }
      }
    }
  });

  // Observe the entire document — menus are often mounted at the root level
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // ── Reel / video play tracking ────────────────────────────────────────────
  /**
   * Counts a video as watched once the user has watched ≥ 3 seconds of it.
   * Uses `timeupdate` (not `play`) so we only count genuine viewing intent.
   * Deduplication is URL-path based — see comment block below.
   */
  const domain = isIG ? 'ig' : 'fb';

  // ── URL-path deduplication ───────────────────────────────────────────────
  // Facebook keeps two <video> elements per post (a hidden preloader + the
  // visible player). Both independently reach currentTime ≥ 3 s, sometimes
  // seconds apart, making a time-window global guard unreliable.
  //
  // The only guarantee: both elements load the *exact same CDN URL* for the
  // same post. So we deduplicate by URL pathname (stripped of query params /
  // CDN tokens that may differ per request). Once a path is counted, no other
  // element playing that same path can count it again.
  //
  // Why pathname only? FB CDN URLs look like:
  //   https://video.xx.fbcdn.net/v/t42.1790-2/<id>/<filename>.mp4?...
  // The path segment uniquely identifies the video; query params are tokens.
  const countedPaths = new Set();

  /** Returns the URL pathname, used as a stable video identity key. */
  function videoUrlKey(url) {
    try { return new URL(url).pathname; } catch { return url; }
  }

  /**
   * Attaches a `timeupdate` listener to a <video> element if not already
   * attached. Counts the video once the user has watched ≥ 3 s of it.
   *
   * @param {HTMLVideoElement} videoEl
   */
  function attachPlayTracker(videoEl) {
    if (videoEl._ytExtTracked) return;
    videoEl._ytExtTracked = true;

    // Last src this element has already been counted or suppressed for.
    let handledSrc = null;

    videoEl.addEventListener('timeupdate', () => {
      // Skip very short looping ambient clips (avatars, story rings, etc.)
      if (videoEl.loop && videoEl.duration > 0 && videoEl.duration <= 3) return;

      // Require at least 3 seconds of actual playback.
      if (videoEl.currentTime < 3) return;

      const src = videoEl.currentSrc || videoEl.src || '';
      // Already handled this src on this element — skip every subsequent tick.
      if (src && src === handledSrc) return;

      // Mark as handled immediately so further timeupdate ticks are cheap.
      handledSrc = src;

      if (!src) return;
      const key = videoUrlKey(src);

      // URL-path dedup: if any element already counted this video URL, skip.
      // This is the definitive guard against FB's dual-element architecture.
      if (countedPaths.has(key)) return;

      countedPaths.add(key);

      // Write directly to chrome.storage.local instead of relaying through the
      // background service worker. The SW-relay approach was intermittently
      // dropping counts: Chrome MV3 service workers can take up to ~1s to wake,
      // and the single 300ms retry in sendMsg would time out — the path was
      // already marked in countedPaths so no further retry was possible.
      // Content scripts have direct storage access, which is always synchronous
      // and never depends on the SW being awake.
      const _today = new Date().toDateString();
      const _storeKey = `${domain}Stats`;
      chrome.storage.local.get([_storeKey], (_data) => {
        const _stats = _data[_storeKey] || { dailyData: {} };
        const _day = _stats.dailyData[_today] || { activeTime: 0, videosWatched: 0, chatTime: 0 };
        _day.videosWatched = (_day.videosWatched || 0) + 1;
        _stats.dailyData[_today] = _day;
        chrome.storage.local.set({ [_storeKey]: _stats });
      });
    }, { passive: true });
  }

  // Attach to all videos already in the DOM at injection time
  document.querySelectorAll('video').forEach(attachPlayTracker);

  // Watch for video elements added dynamically (SPA navigation, lazy loading)
  const videoObserver = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'VIDEO') {
          attachPlayTracker(/** @type {HTMLVideoElement} */ (node));
        }
        node.querySelectorAll('video').forEach(attachPlayTracker);
      }
    }
  });

  videoObserver.observe(document.documentElement, { childList: true, subtree: true });

  // ── Scroll Tracking (F15) ────────────────────────────────────────────────
  // Count discrete scroll gestures and flush to background every 10 seconds.
  let scrollCount = 0;
  let scrollFlushing = false;

  const onScroll = () => { scrollCount++; };
  window.addEventListener('scroll', onScroll, { passive: true });

  setInterval(() => {
    if (scrollCount === 0 || scrollFlushing) return;
    const count = scrollCount;
    scrollCount = 0;
    scrollFlushing = true;
    sendMsg({ type: 'socialScrollUpdate', domain, count }, () => { scrollFlushing = false; });
  }, 10_000);

  // ── Screen Time Limit Block ───────────────────────────────────────────────
  // Listen for timeLimitHit from background.js and show hard-block overlay.
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'timeLimitHit') {
      showSocialTimeLimitOverlay(domain === 'ig' ? 'Instagram' : 'Facebook');
    }
  });

  /** Formats seconds → "Xh Ym" / "Zm". */
  function fmtHudTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }

  /** Formats a minute-based limit to a human string. */
  function fmtLimitMin(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }

  /**
   * Renders (or updates) the live screen-time HUD in the top-right corner.
   * @param {number} usedSec       - seconds on platform today
   * @param {number} limitMin      - daily limit in minutes
   * @param {string} platformLabel - short label shown in header (e.g. "FB")
   */
  function renderSocialTimeLimitHud(usedSec, limitMin, platformLabel) {
    const limitSec  = limitMin * 60;
    const remainSec = Math.max(0, limitSec - usedSec);
    const pct       = Math.min(100, Math.round((usedSec / limitSec) * 100));
    const barColor  = pct >= 90 ? '#e04030' : pct >= 70 ? '#f0a030' : '#4ad66d';

    let hud = document.getElementById('yt-ext-social-time-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'yt-ext-social-time-hud';
      Object.assign(hud.style, {
        position: 'fixed', top: '68px', right: '14px',
        zIndex: '2147483646',
        background: 'rgba(8,8,8,0.86)',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: '10px',
        padding: '10px 14px',
        minWidth: '162px',
        fontFamily: 'Inter,-apple-system,Helvetica,sans-serif',
        fontSize: '12px',
        color: '#f2f2f2',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.55)',
        userSelect: 'none',
        lineHeight: '1',
        pointerEvents: 'none',
      });
      hud.innerHTML = `
        <div style="display:flex;align-items:center;gap:5px;margin-bottom:7px;opacity:.55">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <span style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase">Screen Time · ${platformLabel}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
          <span class="yt-ext-hud-used" style="font-size:15px;font-weight:700;"></span>
          <span class="yt-ext-hud-remain" style="font-size:11px;color:rgba(255,255,255,0.45);"></span>
        </div>
        <div style="height:3px;background:rgba(255,255,255,0.09);border-radius:99px;overflow:hidden;">
          <div class="yt-ext-hud-bar" style="height:100%;border-radius:99px;transition:width .6s,background .6s;"></div>
        </div>
      `;
      document.documentElement.appendChild(hud);
    }

    hud.querySelector('.yt-ext-hud-used').textContent   = fmtHudTime(usedSec) + ' used';
    hud.querySelector('.yt-ext-hud-remain').textContent = remainSec > 0 ? fmtHudTime(remainSec) + ' left' : 'limit reached';
    const bar = hud.querySelector('.yt-ext-hud-bar');
    bar.style.width      = pct + '%';
    bar.style.background = barColor;
  }

  /**
   * Checks today's stats on page load, shows HUD if limit not yet hit,
   * hard-block immediately if already exceeded.
   * Subscribes to storage changes to keep HUD live (background flushes every 10 s).
   * @param {string} d             - 'fb' or 'ig'
   * @param {string} platformName  - 'Facebook' or 'Instagram'
   * @param {string} platformLabel - 'FB' or 'IG'
   */
  function initSocialTimeLimitHud(d, platformName, platformLabel) {
    const enabledKey = `${d}LimitEnabled`;
    const limitKey   = `${d}DailyLimit`;
    const statsKey   = `${d}Stats`;
    const today      = new Date().toDateString();

    chrome.storage.sync.get([enabledKey, limitKey], (syncData) => {
      if (!syncData[enabledKey]) return;
      const limitMin = parseInt(syncData[limitKey] || 60, 10);

      chrome.storage.local.get([statsKey], (localData) => {
        const usedSec = ((localData[statsKey] || {}).dailyData || {})[today]?.activeTime || 0;
        if (usedSec >= limitMin * 60) {
          showSocialTimeLimitOverlay(platformName, limitMin);
          return;
        }
        renderSocialTimeLimitHud(usedSec, limitMin, platformLabel);
      });

      // Background flushes {domain}Stats every 10 s — stay live.
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[statsKey]) return;
        const usedSec = ((changes[statsKey].newValue?.dailyData || {})[today] || {}).activeTime || 0;
        if (usedSec >= limitMin * 60) {
          document.getElementById('yt-ext-social-time-hud')?.remove();
          showSocialTimeLimitOverlay(platformName, limitMin);
        } else {
          renderSocialTimeLimitHud(usedSec, limitMin, platformLabel);
        }
      });
    });
  }

  /**
   * Full-screen hard-block when the daily FB/IG time limit is reached.
   * No bypass button — user must disable/increase the limit in extension settings.
   * @param {string} platformName - 'Facebook' or 'Instagram'
   * @param {number} [limitMin]   - if omitted, fetched from chrome.storage.sync
   */
  function showSocialTimeLimitOverlay(platformName, limitMin) {
    if (document.getElementById('yt-ext-time-limit')) return;

    // Pause all playing videos.
    document.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (_) {} });

    const render = (min) => {
      const overlay = document.createElement('div');
      overlay.id = 'yt-ext-time-limit';
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0',
        background: '#060606',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        zIndex: '2147483647',
        fontFamily: 'Inter,-apple-system,Helvetica,sans-serif',
        color: '#fff', textAlign: 'center',
        padding: '40px 24px',
      });
      overlay.innerHTML = `
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:28px">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <div style="font-size:26px;font-weight:800;letter-spacing:-.03em;margin-bottom:12px">Screen Time Reached</div>
        <div style="font-size:15px;color:rgba(255,255,255,0.45);max-width:380px;line-height:1.7;margin-bottom:10px">
          Your daily <strong style="color:rgba(255,255,255,0.72)">${platformName}</strong> limit of
          <strong style="color:rgba(255,255,255,0.72)">${fmtLimitMin(min)}</strong> has been reached.
        </div>
        <div style="font-size:13px;color:rgba(255,255,255,0.28);max-width:360px;line-height:1.85;margin-bottom:36px">
          To continue, open the <strong style="color:rgba(255,255,255,0.48)">YT Enhanced</strong> extension popup<br>
          → <strong style="color:rgba(255,255,255,0.48)">Advanced → Screen Time Limits</strong><br>
          and disable or increase your ${platformName} limit.
        </div>
        <button id="yt-ext-limit-close" style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.13);color:rgba(255,255,255,0.6);border-radius:8px;padding:11px 30px;font-size:13px;cursor:pointer;font-family:inherit">Close Tab</button>
      `;
      document.documentElement.appendChild(overlay);
      document.getElementById('yt-ext-limit-close').addEventListener('click', () => window.close());
    };

    if (typeof limitMin === 'number') {
      render(limitMin);
    } else {
      const key = domain === 'ig' ? 'igDailyLimit' : 'fbDailyLimit';
      chrome.storage.sync.get([key], (d) => render(parseInt(d[key] || 60, 10)));
    }
  }

  // Kick off HUD check once the page content has settled.
  initSocialTimeLimitHud(domain, isIG ? 'Instagram' : 'Facebook', isIG ? 'IG' : 'FB');
})();
