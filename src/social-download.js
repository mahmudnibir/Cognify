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

  // ── Hide Notifications (Facebook only) ───────────────────────────────────
  if (isFB) {
    const NOTIF_STYLE_ID = 'yt-ext-hide-fb-notifications';
    const NOTIF_CSS = `
      /* Notification bell in top nav */
      [aria-label="Notifications"],
      [data-pagelet*="NotifJewelSection"],
      [data-pagelet*="FeedNotifsJewel"],
      [id*="navNotif"],
      /* Response to notification badge overlay (numeral dot) */
      [data-testid="fbNotifJewelFlyout"],
      /* Notification pop-up panel */
      [aria-label*="notification" i][role="navigation"] { display: none !important; }
    `;

    function injectNotifStyle() {
      if (document.getElementById(NOTIF_STYLE_ID)) return;
      const s = document.createElement('style');
      s.id = NOTIF_STYLE_ID;
      s.textContent = NOTIF_CSS;
      (document.head || document.documentElement).appendChild(s);
    }
    function removeNotifStyle() {
      document.getElementById(NOTIF_STYLE_ID)?.remove();
    }

    let _notifObserver = null;
    function enableHideFbNotifications() {
      injectNotifStyle();
      if (!_notifObserver) {
        _notifObserver = new MutationObserver(injectNotifStyle);
        _notifObserver.observe(document.documentElement, { childList: true, subtree: true });
      }
    }
    function disableHideFbNotifications() {
      removeNotifStyle();
      if (_notifObserver) { _notifObserver.disconnect(); _notifObserver = null; }
    }

    chrome.storage.sync.get(['hideFbNotifications'], (d) => {
      if (d.hideFbNotifications) enableHideFbNotifications();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !('hideFbNotifications' in changes)) return;
      changes.hideFbNotifications.newValue ? enableHideFbNotifications() : disableHideFbNotifications();
    });
    // Instant toggle from HUD panel
    window.addEventListener('yt-ext-edge-toggle', (e) => {
      if (e.detail?.key !== 'hideFbNotifications') return;
      e.detail.value ? enableHideFbNotifications() : disableHideFbNotifications();
    });
  }

  // ── Hide Reels (Facebook only) ────────────────────────────────────────────
  if (isFB) {
    const REELS_STYLE_ID = 'yt-ext-hide-fb-reels';
    const REELS_CSS = `
      /* Left-sidebar Reels nav item */
      [aria-label="Reels"],
      /* Stories / Reels horizontal bar at top of feed */
      [data-pagelet="StoriesHarpy"],
      [data-pagelet="Stories"],
      [data-pagelet*="ReelsSection"],
      /* Reel posts and feed items linking to /reel/ */
      [href*="/reel/"],
      div:has(> [data-pagelet*="Reels"]),
      /* Reels tab on profile/pages */
      [data-tab-key="reels"] { display: none !important; }
    `;

    function injectReelsStyle() {
      if (document.getElementById(REELS_STYLE_ID)) return;
      const s = document.createElement('style');
      s.id = REELS_STYLE_ID;
      s.textContent = REELS_CSS;
      (document.head || document.documentElement).appendChild(s);
    }
    function removeReelsStyle() {
      document.getElementById(REELS_STYLE_ID)?.remove();
    }

    let _reelsObserver = null;
    function enableHideFbReels() {
      injectReelsStyle();
      if (!_reelsObserver) {
        _reelsObserver = new MutationObserver(injectReelsStyle);
        _reelsObserver.observe(document.documentElement, { childList: true, subtree: true });
      }
    }
    function disableHideFbReels() {
      removeReelsStyle();
      if (_reelsObserver) { _reelsObserver.disconnect(); _reelsObserver = null; }
    }

    chrome.storage.sync.get(['hideFbReels'], (d) => {
      if (d.hideFbReels) enableHideFbReels();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !('hideFbReels' in changes)) return;
      changes.hideFbReels.newValue ? enableHideFbReels() : disableHideFbReels();
    });
    // Instant toggle from HUD panel
    window.addEventListener('yt-ext-edge-toggle', (e) => {
      if (e.detail?.key !== 'hideFbReels') return;
      e.detail.value ? enableHideFbReels() : disableHideFbReels();
    });
  }

  // Session-based screen-time timer handle for FB/IG.
  let _socialSessionTimer = null;

  /**
   * Shared list of valid reasons a user may give to start a new session.
   */
  const SESSION_REASONS = [
    'Work / Professional task',
    'Learning & Study',
    'News & Current events',
    'Research & Information',
    'Creative project',
    'Official communication',
  ];

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

  // ── Instagram progressive URL extractor ──────────────────────────────────
  /**
   * Scans Instagram's embedded <script> JSON for a direct MP4 video_url or
   * playback_url — the same strategy used by getFBProgressiveUrl() for FB.
   * Returns a muxed (audio+video) MP4 URL when available, or null for
   * DASH-only Reels where no progressive stream is present in the page data.
   *
   * @returns {string|null}
   */
  function getIGProgressiveUrl() {
    const patterns = [
      /"video_url"\s*:\s*"(https?[^"]+)"/,
      /"playback_url"\s*:\s*"(https?[^"]+)"/,
    ];
    const decodeUrl = (raw) => {
      try { return JSON.parse(`"${raw}"`); }
      catch (_) {
        return raw
          .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
          .replace(/\\\//g, '/');
      }
    };
    for (const script of document.querySelectorAll('script')) {
      const text = script.textContent || '';
      if (!text.includes('video_url') && !text.includes('playback_url')) continue;
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const url = decodeUrl(match[1]);
        if (!url.startsWith('http')) continue;
        // Reject DASH init/manifest — those are video-only streams.
        if (url.includes('dashinit') || url.includes('dash_init') || url.endsWith('.mpd')) continue;
        return url;
      }
    }
    return null;
  }

  // ── Minimal ISO BMFF / fMP4 re-muxer ─────────────────────────────────────
  // Combines a video-only fMP4 and an audio-only fMP4 — both typical of
  // Instagram/Facebook DASH streams — into one valid, non-interleaved MP4
  // file without re-encoding any data.

  /** Read unsigned 32-bit big-endian integer from Uint8Array. */
  const _r32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  /** Write unsigned 32-bit big-endian integer into Uint8Array. */
  const _w32 = (b, o, v) => {
    b[o] = (v >>> 24) & 0xff; b[o + 1] = (v >>> 16) & 0xff;
    b[o + 2] = (v >>> 8) & 0xff; b[o + 3] = v & 0xff;
  };
  /** Read 4-char ISO BMFF box type. */
  const _rtype = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

  /**
   * Parse all direct-child ISO BMFF boxes within the byte range [from, to).
   * Each entry: { type, start, end, dataStart } — all offsets in the source array.
   * @returns {Array<{type:string,start:number,end:number,dataStart:number}>}
   */
  function _parseBoxes(data, from, to) {
    const boxes = [];
    let p = from;
    while (p + 8 <= to) {
      let sz = _r32(data, p);
      const type = _rtype(data, p + 4);
      let hdr = 8;
      if (sz === 1) {
        // Extended 64-bit size — only the lo-32 bits are used (files < 4 GB).
        sz = _r32(data, p + 12);
        hdr = 16;
      } else if (sz === 0) {
        sz = to - p; // box extends to the container boundary
      }
      if (sz < hdr || p + sz > to) break;
      boxes.push({ type, start: p, end: p + sz, dataStart: p + hdr });
      p += sz;
    }
    return boxes;
  }

  /** Return the first box of the given type, or null. */
  const _findBox = (arr, type) => arr.find(b => b.type === type) || null;

  /**
   * Get track_ID from a tkhd (Track Header) full box.
   * v0: version(1)+flags(3)+ctime(4)+mtime(4) → track_ID at +12
   * v1: version(1)+flags(3)+ctime(8)+mtime(8) → track_ID at +20
   */
  const _tkhdId    = (b, tkhd) => _r32(b, tkhd.dataStart + (b[tkhd.dataStart] === 1 ? 20 : 12));
  const _setTkhdId = (b, tkhd, id) => _w32(b, tkhd.dataStart + (b[tkhd.dataStart] === 1 ? 20 : 12), id);

  /**
   * Get/set track_ID from a trex or tfhd full box.
   * Both have: version(1)+flags(3)+track_ID(4) → offset +4 from dataStart.
   */
  const _tid4    = (b, box) => _r32(b, box.dataStart + 4);
  const _setTid4 = (b, box, id) => _w32(b, box.dataStart + 4, id);

  /**
   * Get baseMediaDecodeTime from a tfdt box (used to sort fragments).
   * v0: 4-byte time at +4; v1: 8-byte time — use lo-32 bits at +8 (sufficient for sorting).
   */
  const _tfdtTime = (b, tfdt) =>
    b[tfdt.dataStart] === 1 ? _r32(b, tfdt.dataStart + 8) : _r32(b, tfdt.dataStart + 4);

  /** Concatenate multiple Uint8Array segments into one. */
  function _concat(...parts) {
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let pos = 0;
    for (const p of parts) { out.set(p, pos); pos += p.length; }
    return out;
  }

  /**
   * Build an ISO BMFF box: [size(4)][type(4)][...dataParts]
   * @returns {Uint8Array}
   */
  function _box(type, ...dataParts) {
    const tc = new Uint8Array([
      type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3),
    ]);
    let len = 8;
    for (const d of dataParts) len += d.length;
    const out = new Uint8Array(len);
    _w32(out, 0, len);
    out.set(tc, 4);
    let p = 8;
    for (const d of dataParts) { out.set(d, p); p += d.length; }
    return out;
  }

  /**
   * Build a trex (Track Extends) full box.
   * All default-sample values are 0; default_sample_description_index = 1.
   */
  function _buildTrex(trackId) {
    // version(1)+flags(3)+track_ID(4)+5×uint32 = 24 bytes of full-box data
    const d = new Uint8Array(24);
    _w32(d, 4, trackId);
    _w32(d, 8, 1); // default_sample_description_index
    return _box('trex', d);
  }

  /** Build an mvex box containing two trex entries (one per track). */
  const _buildMvex = (id1, id2) => _box('mvex', _buildTrex(id1), _buildTrex(id2));

  /**
   * Merge a video-only fMP4 and an audio-only fMP4 into one combined MP4.
   *
   * Algorithm:
   *  1. Parse top-level and moov-child boxes from both files.
   *  2. Identify each file's track ID from its tkhd box.
   *  3. Assign non-conflicting IDs: keep video's ID; bump audio's if equal.
   *  4. Clone audio data and patch every track_ID reference (tkhd, trex, tfhd).
   *  5. Build a new moov = patched mvhd + video trak + audio trak + new mvex.
   *  6. Collect moof+mdat fragment pairs from both files.
   *  7. Interleave all fragments by baseMediaDecodeTime (from tfdt).
   *  8. Return: ftyp + new moov + all interleaved fragments.
   *
   * @param {Uint8Array} vData  Video-only fMP4
   * @param {Uint8Array} aData  Audio-only fMP4
   * @returns {Uint8Array}      Combined MP4
   */
  function _muxMP4(vData, aData) {
    // ── Parse top-level boxes ────────────────────────────────────────────
    const vBoxes = _parseBoxes(vData, 0, vData.length);
    const aBoxes = _parseBoxes(aData, 0, aData.length);
    const vMoov  = _findBox(vBoxes, 'moov');
    const aMoov  = _findBox(aBoxes, 'moov');
    const vFtyp  = _findBox(vBoxes, 'ftyp');
    if (!vMoov || !aMoov) throw new Error('mergeMP4: missing moov box');

    // ── Parse moov children ──────────────────────────────────────────────
    const vMoovKids = _parseBoxes(vData, vMoov.dataStart, vMoov.end);
    const aMoovKids = _parseBoxes(aData, aMoov.dataStart, aMoov.end);
    const vTrak = _findBox(vMoovKids, 'trak');
    const aTrak = _findBox(aMoovKids, 'trak');
    if (!vTrak || !aTrak) throw new Error('mergeMP4: missing trak box');

    // ── Get track IDs from tkhd ──────────────────────────────────────────
    const vTkhd = _findBox(_parseBoxes(vData, vTrak.dataStart, vTrak.end), 'tkhd');
    const aTkhd = _findBox(_parseBoxes(aData, aTrak.dataStart, aTrak.end), 'tkhd');
    if (!vTkhd || !aTkhd) throw new Error('mergeMP4: missing tkhd box');

    const vTid     = _tkhdId(vData, vTkhd);
    const aTidOrig = _tkhdId(aData, aTkhd);
    // Assign audio a track ID that doesn't collide with video's.
    const aTidNew  = (aTidOrig === vTid) ? vTid + 1 : aTidOrig;

    // ── Clone audio data and patch all track_ID references ───────────────
    const aC = aData.slice(); // mutable clone

    // Patch audio tkhd
    const aTkhdC = _findBox(_parseBoxes(aC, aTrak.dataStart, aTrak.end), 'tkhd');
    if (aTkhdC) _setTkhdId(aC, aTkhdC, aTidNew);

    // Patch audio mvex > trex
    const aMvexC = _findBox(_parseBoxes(aC, aMoov.dataStart, aMoov.end), 'mvex');
    if (aMvexC) {
      for (const trex of _parseBoxes(aC, aMvexC.dataStart, aMvexC.end).filter(b => b.type === 'trex')) {
        if (_tid4(aC, trex) === aTidOrig) _setTid4(aC, trex, aTidNew);
      }
    }

    // Patch audio moof > traf > tfhd in every fragment
    for (const box of aBoxes) {
      if (box.type !== 'moof') continue;
      for (const traf of _parseBoxes(aC, box.dataStart, box.end).filter(b => b.type === 'traf')) {
        const tfhd = _findBox(_parseBoxes(aC, traf.dataStart, traf.end), 'tfhd');
        if (tfhd && _tid4(aC, tfhd) === aTidOrig) _setTid4(aC, tfhd, aTidNew);
      }
    }

    // ── Build new moov ───────────────────────────────────────────────────
    // Clone mvhd and update next_track_ID to max(vTid, aTidNew) + 1.
    const vMvhd = _findBox(vMoovKids, 'mvhd');
    let mvhdBytes = vMvhd ? vData.slice(vMvhd.start, vMvhd.end) : new Uint8Array(0);
    if (vMvhd) {
      const rel  = vMvhd.dataStart - vMvhd.start; // dataStart offset within this slice
      const ntId = Math.max(vTid, aTidNew) + 1;
      _w32(mvhdBytes, rel + (mvhdBytes[rel] === 1 ? 108 : 96), ntId);
    }

    // Audio trak bytes from the patched clone
    const aTrakB = aC.slice(aTrak.start, aTrak.end);

    // Any non-mvhd/trak/mvex children from the video moov (e.g. udta metadata)
    const extraParts = vMoovKids
      .filter(c => c.type !== 'mvhd' && c.type !== 'trak' && c.type !== 'mvex')
      .map(c => vData.slice(c.start, c.end));

    const newMoov = _box('moov',
      mvhdBytes,
      vData.slice(vTrak.start, vTrak.end), // video trak — unchanged
      aTrakB,                               // audio trak — patched track ID
      _buildMvex(vTid, aTidNew),            // fresh mvex with trex for both tracks
      ...extraParts,
    );

    // ── Collect moof+mdat fragment pairs ─────────────────────────────────
    /**
     * Walk a box list and collect consecutive (moof, mdat) pairs.
     * Sort key is the baseMediaDecodeTime from the inner tfdt box.
     */
    function collectFrags(boxes, src) {
      const frags = [];
      for (let i = 0; i < boxes.length - 1; i++) {
        if (boxes[i].type !== 'moof' || boxes[i + 1].type !== 'mdat') continue;
        const moof = boxes[i];
        const mdat = boxes[i + 1];
        let time = 0;
        const traf = _findBox(_parseBoxes(src, moof.dataStart, moof.end), 'traf');
        if (traf) {
          const tfdt = _findBox(_parseBoxes(src, traf.dataStart, traf.end), 'tfdt');
          if (tfdt) time = _tfdtTime(src, tfdt);
        }
        frags.push({
          time,
          bytes: _concat(src.slice(moof.start, moof.end), src.slice(mdat.start, mdat.end)),
        });
        i++; // skip the mdat we just consumed
      }
      return frags;
    }

    const vFrags = collectFrags(vBoxes, vData);
    const aFrags = collectFrags(aBoxes, aC);

    // ── Interleave and assemble output ───────────────────────────────────
    const allFrags = [...vFrags, ...aFrags].sort((a, b) => a.time - b.time);
    const parts = [];
    if (vFtyp) parts.push(vData.slice(vFtyp.start, vFtyp.end));
    parts.push(newMoov);
    for (const f of allFrags) parts.push(f.bytes);
    return _concat(...parts);
  }

  /**
   * Fetch the video-only and audio-only DASH streams and merge them into a
   * single combined MP4 Blob. Returns a revocable object URL for download.
   *
   * The extension's "<all_urls>" host_permission means content-script fetch()
   * calls bypass the CDN's CORS policy, so no background relay is needed.
   *
   * @param {string}    videoUrl
   * @param {string}    audioUrl
   * @param {function} [onProgress] - Called with intermediate status messages
   * @returns {Promise<string>} Revocable object URL pointing to the merged MP4
   */
  async function fetchAndMerge(videoUrl, audioUrl, onProgress) {
    onProgress?.('⏳ Downloading video + audio streams...');
    const [vBuf, aBuf] = await Promise.all([
      fetch(videoUrl, { credentials: 'omit' }).then(r => {
        if (!r.ok) throw new Error(`Video stream error ${r.status}`);
        return r.arrayBuffer();
      }),
      fetch(audioUrl, { credentials: 'omit' }).then(r => {
        if (!r.ok) throw new Error(`Audio stream error ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);
    onProgress?.('⏳ Merging streams into one file...');
    const merged = _muxMP4(new Uint8Array(vBuf), new Uint8Array(aBuf));
    const blob   = new Blob([merged], { type: 'video/mp4' });
    return URL.createObjectURL(blob);
  }

  // ── Dispatch the download via background.js ──────────────────────────────
  /**
   * Resolves the video URL and triggers a local download via background.js.
   *
   * Strategy:
   *  1. (FB only) Parse the page's embedded JSON for a progressive (muxed
   *     audio+video) MP4 URL — browser_native_hd_url / playable_url etc.
   *     This is the preferred path because DASH segments are video-only.
   *  1b. (IG only) Same scan for Instagram's video_url / playback_url keys.
   *  2. Ask background for the CDN URL it intercepted via webRequest — the
   *     real mp4 URL when <video>.currentSrc is a blob: (MSE player).
   *  3. Fall back to scanning the DOM for any <video> with a plain http URL
   *     (works for FB Watch and other non-MSE embeds).
   *  4. If the only URL found is still a blob, show a clear error.
   *  5. When DASH video+audio are both available, merge client-side (no
   *     re-encoding) and download a single combined MP4.
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

    // Step 1b — For Instagram, try to extract a muxed (audio+video) MP4 URL
    // directly from the page's embedded JSON before falling back to DASH.
    if (isIG) {
      const progressiveUrl = getIGProgressiveUrl();
      if (progressiveUrl) {
        const filename = `instagram_${Date.now()}.mp4`;
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

      // When both DASH video and audio streams are available, merge them
      // client-side into a single combined MP4 (no re-encoding, no extra files).
      if (isDashVideoOnly && cachedAudioUrl) {
        fetchAndMerge(src, cachedAudioUrl, (msg) => showPageToast(msg))
          .then((blobUrl) => {
            // Trigger download via a temporary <a> element so the merged Blob
            // is saved directly — no round-trip back through background.js.
            const a = document.createElement('a');
            a.href     = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            // Release the object URL after the download has had time to start.
            setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
            showPageToast('✅ Download started!');
          })
          .catch((err) => {
            console.error('[YT-Ext] Stream merge failed:', err);
            // Fallback: download video + audio as separate files.
            sendMsg({ type: 'downloadVideo', url: src, filename }, () => {});
            sendMsg({
              type: 'downloadVideo',
              url: cachedAudioUrl,
              filename: `${platform}_${ts}_audio.mp4`,
              saveAs: false,
            }, () => {});
            showPageToast('⚠️ Merge failed — saved as 2 separate files (video + audio).');
          });
        return; // async path — do not fall through to the sync sendMsg below
      }

      sendMsg({ type: 'downloadVideo', url: src, filename }, (res) => {
        if (!res?.success) {
          showPageToast('❌ Download failed. Try again.');
          return;
        }
        if (isDashVideoOnly) {
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
   * Renders (or updates) the live screen-time HUD.
   *
   * Facebook — injected as an inline pill into the FB right-nav header,
   *            matching the same pattern used on YouTube (`ytd-masthead #end`).
   * Instagram — rendered as a floating card (position:fixed) since IG's header
   *             layout is a left sidebar and has no horizontal right-nav to anchor to.
   *
   * @param {number} usedSec       - seconds elapsed this session
   * @param {number} limitMin      - session limit in minutes
   * @param {string} platformLabel - platform label (e.g. "FB", "IG")
   */
  function renderSocialTimeLimitHud(usedSec, limitMin, platformLabel) {
    window.__ytExtEdgeHud?.render(usedSec, limitMin, platformLabel);
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
    const sessionStartKey   = `${d}SessionStart`;
    const sessionBlockedKey = `${d}SessionBlocked`;
    let _currentLimitMin = 0;  // mutable so add-session can extend it

    /**
     * Starts (or restarts) the per-second session countdown timer for FB/IG.
     */
    function _startTimer(lim) {
      if (_socialSessionTimer) clearInterval(_socialSessionTimer);
      _currentLimitMin = lim;
      const limitSec = lim * 60;
      _socialSessionTimer = setInterval(() => {
        chrome.storage.local.get([sessionStartKey, sessionBlockedKey], (local) => {
          if (local[sessionBlockedKey]) { clearInterval(_socialSessionTimer); return; }
          if (!local[sessionStartKey]) return;
          const usedSec = Math.round((Date.now() - local[sessionStartKey]) / 1000);
          // Update rolling daily stat (every ~10 s to reduce write frequency)
          if (usedSec % 10 === 0) window.__ytExtEdgeHud?.recordStat(usedSec);
          if (usedSec >= limitSec) {
            clearInterval(_socialSessionTimer);
            window.__ytExtEdgeHud?.remove();
            chrome.storage.local.set({ [sessionBlockedKey]: true });
            showSocialTimeLimitOverlay(platformName, platformLabel, d, _currentLimitMin);
          } else {
            renderSocialTimeLimitHud(usedSec, _currentLimitMin, platformLabel);
          }
        });
      }, 1000);
    }

    function evalHud() {
      chrome.storage.sync.get([enabledKey, limitKey], (syncData) => {
        if (!syncData[enabledKey]) {
          if (_socialSessionTimer) { clearInterval(_socialSessionTimer); _socialSessionTimer = null; }
          window.__ytExtEdgeHud?.remove();
          return;
        }
        const lim = parseInt(syncData[limitKey] || 60, 10);
        chrome.storage.local.get([sessionBlockedKey, sessionStartKey], (local) => {
          if (local[sessionBlockedKey]) {
            window.__ytExtEdgeHud?.remove();
            showSocialTimeLimitOverlay(platformName, platformLabel, d, lim);
            return;
          }
          if (!local[sessionStartKey]) {
            chrome.storage.local.set({ [sessionStartKey]: Date.now() }, () => {
              window.__ytExtEdgeHud?.incrementSession();
              _startTimer(lim);
            });
          } else {
            _startTimer(lim);
          }
        });
      });
    }

    evalHud();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && (changes[enabledKey] !== undefined || changes[limitKey] !== undefined)) {
        evalHud();
      }
      if (area === 'local' && changes[sessionBlockedKey]?.newValue === false) {
        document.getElementById('yt-ext-time-limit')?.remove();
        evalHud();
      }
    });

    // Extend current session by N minutes when the user taps "+ Add 5 minutes"
    window.addEventListener('yt-ext-add-session', (e) => {
      if (!_currentLimitMin) return;
      _startTimer(_currentLimitMin + (e.detail?.minutes || 5));
    });
  }

  /**
   * Full-screen session-ended overlay for FB/IG.
   * Offers a reason-picker to start a new session, or "Close Tab".
   * @param {string} platformName  - 'Facebook' or 'Instagram'
   * @param {string} platformLabel - 'FB' or 'IG'
   * @param {string} d             - 'fb' or 'ig'
   * @param {number} limitMin      - session length in minutes
   */
  function showSocialTimeLimitOverlay(platformName, platformLabel, d, limitMin) {
    if (document.getElementById('yt-ext-time-limit')) return;

    document.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (_) {} });

    const sessionBlockedKey = `${d}SessionBlocked`;
    const sessionStartKey   = `${d}SessionStart`;

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

    const reasonBtnsHtml = SESSION_REASONS.map(r =>
      `<button class="yt-session-reason" data-r="${r}" style="
        background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
        color:rgba(255,255,255,0.6);border-radius:8px;padding:9px 18px;
        font-size:12px;font-family:inherit;cursor:pointer;transition:all .15s;
        white-space:nowrap;">${r}</button>`
    ).join('');

    overlay.innerHTML = `
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.18)"
        stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:24px">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      <div style="font-size:26px;font-weight:800;letter-spacing:-.03em;margin-bottom:10px">Session Ended</div>
      <div style="font-size:15px;color:rgba(255,255,255,0.45);max-width:380px;line-height:1.7;margin-bottom:6px">
        Your <strong style="color:rgba(255,255,255,0.72)">${platformName}</strong> session of
        <strong style="color:rgba(255,255,255,0.72)">${fmtLimitMin(limitMin)}</strong> has ended.
      </div>
      <div style="font-size:13px;color:rgba(255,255,255,0.3);margin-bottom:24px">
        Select a valid reason to start a new session.
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:480px;margin-bottom:28px">
        ${reasonBtnsHtml}
      </div>
      <div style="display:flex;gap:12px;align-items:center">
        <button id="yt-ext-new-session-btn" disabled style="
          background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.13);
          color:rgba(255,255,255,0.3);border-radius:8px;padding:11px 28px;
          font-size:13px;font-family:inherit;cursor:not-allowed;transition:all .2s;opacity:.45">
          New Session
        </button>
        <button id="yt-ext-limit-close" style="
          background:transparent;border:1px solid rgba(255,255,255,0.1);
          color:rgba(255,255,255,0.4);border-radius:8px;padding:11px 28px;
          font-size:13px;font-family:inherit;cursor:pointer;transition:all .2s">
          Close Tab
        </button>
      </div>
    `;
    document.body.appendChild(overlay);

    let selectedReason = null;
    overlay.querySelectorAll('.yt-session-reason').forEach(btn => {
      btn.addEventListener('mouseover', () => {
        if (btn.dataset.r !== selectedReason) btn.style.background = 'rgba(255,255,255,0.09)';
      });
      btn.addEventListener('mouseout', () => {
        if (btn.dataset.r !== selectedReason) btn.style.background = 'rgba(255,255,255,0.05)';
      });
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.yt-session-reason').forEach(b => {
          b.style.background = 'rgba(255,255,255,0.05)';
          b.style.borderColor = 'rgba(255,255,255,0.1)';
          b.style.color = 'rgba(255,255,255,0.6)';
        });
        btn.style.background = 'rgba(255,255,255,0.15)';
        btn.style.borderColor = 'rgba(255,255,255,0.3)';
        btn.style.color = '#fff';
        selectedReason = btn.dataset.r;
        const newBtn = document.getElementById('yt-ext-new-session-btn');
        newBtn.disabled = false;
        newBtn.style.opacity = '1';
        newBtn.style.cursor = 'pointer';
        newBtn.style.color = '#fff';
        newBtn.style.borderColor = 'rgba(255,255,255,0.28)';
      });
    });

    document.getElementById('yt-ext-new-session-btn').addEventListener('click', () => {
      if (!selectedReason) return;
      // Remove the overlay immediately so the UI responds at once, rather than
      // waiting for the storage.onChanged round-trip (which also handles timer restart).
      overlay.remove();
      try {
        chrome.storage.local.set(
          { [sessionBlockedKey]: false, [sessionStartKey]: Date.now() },
          () => { void chrome.runtime.lastError; }
        );
      } catch (_) {
        // Extension context invalidated — overlay is already removed; nothing more to do.
      }
    });

    document.getElementById('yt-ext-limit-close').addEventListener('click', () => window.close());
  }

  // Kick off HUD check once the page content has settled.
  initSocialTimeLimitHud(domain, isIG ? 'Instagram' : 'Facebook', isIG ? 'IG' : 'FB');
})();
