(function () {
  let bookmarks = [];
  let currentIndex = -1;
  let video = null;
  let storageKey = null;

  let manualOverride = false;
  let overrideTimeout;
  let deletedBookmarks = [];

  // Per-video one-shot flags — reset each time init() finds a new video
  let theaterApplied = false;
  let subtitlesApplied = false;
  let autoFullscreenApplied = false;
  
  // Sleep timer — handle cleared when timer fires or is reset
  let sleepTimerHandle = null;

  // SponsorBlock — segments fetched per video
  let sponsorSegments = [];
  let sponsorBlockEnabled = false;

  // A→B Loop Segment — loop a section of the video
  let loopAPoint = null;
  let loopBPoint = null;

  // Time saved tracking
  let totalTimeSaved = 0;
  let lastUpdateTime = 0;

  // Session-based screen-time timer handle — cleared when HUD is torn down.
  let _ytSessionTimer = null;

  /**
   * Returns false once the extension has been reloaded/updated while this tab
   * is still open. Checked inside all recurring callbacks (setInterval,
   * MutationObserver, onChanged) to prevent "Extension context invalidated" throws.
   */
  function isCtxValid() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }

  // Statistics tracking
  let sessionStartTime = Date.now();
  let currentVideoId = null;
  let videoStartTime = 0;
  let lastStatsUpdate = Date.now();
  
  // Custom shortcuts with defaults
  let shortcuts = {
    addBookmark: 'P',
    prevBookmark: 'Shift+PageDown',
    nextBookmark: 'Shift+PageUp',
    labelBookmark: 'L',
    removeBookmark: 'Shift+R',
    clearBookmarks: 'Shift+C',
    increaseSpeed: '+',
    decreaseSpeed: '-',
    showHelp: 'Shift+?',
    toggleTime: 'Alt+R',
    setLoopA: '[',
    setLoopB: ']',
    clearLoop: '\\'
  };
  
  // Load custom shortcuts
  chrome.runtime.sendMessage({ type: 'getShortcuts' }, (data) => {
    void chrome.runtime.lastError; // consumed — SW may not be awake yet
    if (data && data.shortcuts) {
      shortcuts = { ...shortcuts, ...data.shortcuts };
    }
  });
  
  // Get storage object based on cloudSync setting
  function getBookmarkStorage(callback) {
    chrome.runtime.sendMessage({ type: 'getCloudSync' }, (data) => {
      void chrome.runtime.lastError; // consumed — SW may not be awake yet
      const useCloudSync = data && data.cloudSync !== false; // Default true
      callback(useCloudSync ? chrome.storage.sync : chrome.storage.local);
    });
  }

  const init = () => {
    video = document.querySelector("video");
    const progressBar = document.querySelector(".ytp-progress-bar");
    if (!video || !progressBar) {
      setTimeout(init, 1000);
      return;
    }

    const videoId = new URLSearchParams(window.location.search).get("v");
    if (!videoId) return;
    storageKey = `yt_bm_${videoId}`;

    // Reset one-shot flags for this video
    theaterApplied = false;
    subtitlesApplied = false;
    autoFullscreenApplied = false;

    getBookmarkStorage((storage) => {
      storage.get([storageKey], (res) => {
        bookmarks = Array.isArray(res[storageKey]) ? res[storageKey] : [];
        bookmarks.sort((a, b) => a.time - b.time);
        bookmarks.forEach(bm => addBookmarkMarker(bm.time, bm.label));
      });
    });

    // Apply default volume once on initial video load
    chrome.storage.sync.get(['defaultVolume', 'defaultVolumeEnabled'], (data) => {
      if (data.defaultVolumeEnabled && video) {
        video.volume = Math.max(0, Math.min(1, (data.defaultVolume || 80) / 100));
      }
    });

    document.addEventListener("keydown", handleKeyPress);
    setInterval(() => { if (!isCtxValid()) return; applySettings(); }, 1000); // Adjust speed periodically
    setInterval(() => { if (!isCtxValid()) return; updateTimeSaved(); }, 1000); // Track time saved
    setInterval(() => { if (!isCtxValid()) return; updateStatistics(); }, 10000); // Update statistics every 10 seconds
    setInterval(() => { if (!isCtxValid()) return; saveWatchedProgress(); }, 5000); // Save watched-progress percentage for thumbnail tags

    // Fetch SponsorBlock segments for this video
    fetchSponsorSegments(videoId);

    addRemainingTimeOverlay(); // Add the remaining time overlay
    addBookmarkButton(); // Add bookmark button to player controls
    
    // Load saved time from storage
    chrome.storage.local.get(['totalTimeSaved'], (res) => {
      totalTimeSaved = res.totalTimeSaved || 0;
    });
    
    // Apply content control settings
    applyContentControls();
    
    // Reapply content controls periodically for dynamic content
    setInterval(() => { if (!isCtxValid()) return; applyContentControls(); }, 2000);
    
    // Initialize statistics tracking
    initializeStatistics(videoId);
    
    // Track video events
    video.addEventListener('play', () => {
      videoStartTime = Date.now();
      trackVideoStart(videoId);
      // Re-apply voice mode on every play so the AudioContext resumes
      // (Chrome suspends AudioContext until a user gesture; play counts as one)
      chrome.storage.sync.get(['voiceMode', 'pitchCorrection', 'autoFullscreen'], ({ voiceMode, pitchCorrection, autoFullscreen }) => {
        const mode = voiceMode || (pitchCorrection === false ? 'chipmunk' : 'normal');
        applyVoiceMode(video, mode);
        // Auto Fullscreen — trigger once per video on first play
        if (autoFullscreen && !autoFullscreenApplied && !document.fullscreenElement) {
          // Use YouTube's own fullscreen button so player controls remain visible
          const ytFullscreenBtn = document.querySelector('.ytp-fullscreen-button');
          if (ytFullscreenBtn) {
            ytFullscreenBtn.click();
          } else {
            // Fallback: request fullscreen on the YouTube player container, not raw video
            const playerEl = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
            (playerEl || video).requestFullscreen().catch(() => {});
          }
          autoFullscreenApplied = true;
        }
      });
    });
    
    video.addEventListener('pause', () => {
      if (videoStartTime > 0) {
        trackWatchTime(videoId);
      }
    });
    
    video.addEventListener('ended', () => {
      trackWatchTime(videoId);
      trackVideoComplete(videoId);
    });

    // A→B loop enforcement — seek back to A whenever playback reaches B
    video.addEventListener('timeupdate', () => {
      if (loopAPoint !== null && loopBPoint !== null && loopAPoint < loopBPoint) {
        if (video.currentTime >= loopBPoint) {
          video.currentTime = loopAPoint;
        }
      }
    });
  };
  
  // Function to hide/show content based on settings
  function applyContentControls() {
    chrome.storage.sync.get(['hideComments', 'hideShorts', 'hideDescription', 'hideSuggestions', 'loopVideo'], (data) => {
      // Hide comments
      if (data.hideComments) {
        hideComments();
      } else {
        showComments();
      }
      // Hide shorts
      if (data.hideShorts) {
        hideShorts();
      } else {
        showShorts();
      }
      // Hide description
      if (data.hideDescription) {
        hideDescription();
      } else {
        showDescription();
      }
      // Hide suggestions
      if (data.hideSuggestions) {
        hideSuggestions();
      } else {
        showSuggestions();
      }
      // Loop video
      const video = document.querySelector('video');
      if (video) {
        video.loop = !!data.loopVideo;
      }
    });
  }
  
  function hideComments() {
    const style = document.getElementById('yt-hide-comments-style') || document.createElement('style');
    style.id = 'yt-hide-comments-style';
    style.textContent = `
      ytd-comments#comments,
      ytd-comments-header-renderer,
      ytd-comment-thread-renderer,
      #comments.ytd-watch-flexy,
      ytd-item-section-renderer#sections > #contents > ytd-comments {
        display: none !important;
      }
    `;
    if (!document.getElementById('yt-hide-comments-style')) {
      document.head.appendChild(style);
    }
  }
  
  function showComments() {
    const style = document.getElementById('yt-hide-comments-style');
    if (style) {
      style.remove();
    }
  }
  
  function hideShorts() {
    const style = document.getElementById('yt-hide-shorts-style') || document.createElement('style');
    style.id = 'yt-hide-shorts-style';
    style.textContent = `
      ytd-reel-shelf-renderer,
      ytd-rich-section-renderer:has(ytd-reel-shelf-renderer),
      ytd-guide-entry-renderer[title="Shorts"],
      ytd-guide-entry-renderer:has([title="Shorts"]),
      ytd-mini-guide-entry-renderer:has([aria-label="Shorts"]),
      a[href^="/shorts/"],
      ytd-rich-item-renderer:has(a[href^="/shorts/"]),
      ytd-video-renderer:has(a[href*="/shorts/"]),
      [is-shorts] {
        display: none !important;
      }
    `;
    if (!document.getElementById('yt-hide-shorts-style')) {
      document.head.appendChild(style);
    }
  }
  
  function showShorts() {
    const style = document.getElementById('yt-hide-shorts-style');
    if (style) {
      style.remove();
    }
  }
  
  function hideDescription() {
    const style = document.getElementById('yt-hide-description-style') || document.createElement('style');
    style.id = 'yt-hide-description-style';
    style.textContent = `
      ytd-watch-metadata #description,
      ytd-video-description-transcript-section-renderer,
      ytd-expandable-video-description-body-renderer,
      ytd-video-description-header-renderer,
      #description.ytd-video-secondary-info-renderer,
      #description.style-scope.ytd-watch-metadata,
      tp-yt-paper-tooltip.ytd-video-description-header-renderer {
        display: none !important;
      }
    `;
    if (!document.getElementById('yt-hide-description-style')) {
      document.head.appendChild(style);
    }
  }
  
  function showDescription() {
    const style = document.getElementById('yt-hide-description-style');
    if (style) {
      style.remove();
    }
  }
  
  function hideSuggestions() {
    const style = document.getElementById('yt-hide-suggestions-style') || document.createElement('style');
    style.id = 'yt-hide-suggestions-style';
    style.textContent = `
      #related,
      #secondary,
      #secondary-inner,
      ytd-watch-next-secondary-results-renderer,
      ytd-compact-video-renderer,
      ytd-item-section-renderer.ytd-watch-next-secondary-results-renderer,
      .ytp-ce-element,
      .ytp-endscreen-content,
      .ytp-ce-covering-overlay,
      .ytp-ce-element-show,
      ytd-compact-autoplay-renderer {
        display: none !important;
      }
    `;
    if (!document.getElementById('yt-hide-suggestions-style')) {
      document.head.appendChild(style);
    }
  }
  
  function showSuggestions() {
    const style = document.getElementById('yt-hide-suggestions-style');
    if (style) {
      style.remove();
    }
  }
  
  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateSettings') {
      const videoEl = document.querySelector('video');
      // Apply pitch correction immediately if present
      if (request.settings) {
        const { voiceMode, pitchCorrection } = request.settings;
        const mode = voiceMode || (pitchCorrection === false ? 'chipmunk' : 'normal');
        applyVoiceMode(videoEl, mode);
      }
      // If loopVideo is present in settings, apply immediately
      if (request.settings && typeof request.settings.loopVideo !== 'undefined') {
        if (videoEl) videoEl.loop = !!request.settings.loopVideo;
      }
      // Apply focusMode immediately so the CSS injection is instant on toggle
      if (request.settings && typeof request.settings.focusMode !== 'undefined') {
        if (request.settings.focusMode) {
          applyFocusMode();
        } else {
          removeFocusMode();
        }
      }
      applyContentControls();
      if (typeof request.speed !== 'undefined') {
        if (videoEl && !isNaN(request.speed)) {
          const prevRate = parseFloat(videoEl.playbackRate.toFixed(2));
          const newRate = parseFloat(parseFloat(request.speed).toFixed(2));
          videoEl.playbackRate = newRate;
          // Only show overlay when the speed actually changed (suppress on non-speed toggles)
          if (prevRate !== newRate) {
            showSpeedOverlay(request.speed);
          }
          saveSpeed(request.speed);
        }
      }
      sendResponse({success: true});
    }
    if (request.action === 'updateShortcuts') {
      shortcuts = { ...shortcuts, ...request.shortcuts };
      sendResponse({success: true});
    }
    // Sleep timer: pause video after N minutes
    if (request.action === 'setSleepTimer') {
      clearTimeout(sleepTimerHandle);
      sleepTimerHandle = null;
      if (request.minutes > 0) {
        sleepTimerHandle = setTimeout(() => {
          const v = document.querySelector('video');
          if (v) v.pause();
          showBookmarkOverlay('Sleep timer: playback paused');
        }, request.minutes * 60 * 1000);
        showBookmarkOverlay(`Sleep timer set for ${request.minutes} min`);
      } else {
        showBookmarkOverlay('Sleep timer cleared');
      }
      sendResponse({success: true});
    }
    // Screen time limit hit: show hard-block overlay
    if (request.action === 'timeLimitHit') {
      showTimeLimitOverlay();
      sendResponse({success: true});
    }

    // A→B loop segment controls from popup
    if (request.action === 'setLoopA') {
      const v = document.querySelector('video');
      if (v) {
        loopAPoint = v.currentTime;
        showBookmarkOverlay(`⟳ Loop A → ${formatTime(Math.floor(loopAPoint))}`);
        updateLoopOverlay();
        sendResponse({ success: true, loopAPoint });
      } else {
        sendResponse({ success: false });
      }
    }
    if (request.action === 'setLoopB') {
      const v = document.querySelector('video');
      if (v) {
        loopBPoint = v.currentTime;
        showBookmarkOverlay(`⟳ Loop B → ${formatTime(Math.floor(loopBPoint))}`);
        updateLoopOverlay();
        sendResponse({ success: true, loopBPoint });
      } else {
        sendResponse({ success: false });
      }
    }
    if (request.action === 'clearLoop') {
      loopAPoint = null;
      loopBPoint = null;
      updateLoopOverlay();
      showBookmarkOverlay('Loop cleared');
      sendResponse({ success: true });
    }
    if (request.action === 'getLoopState') {
      const v = document.querySelector('video');
      sendResponse({ loopAPoint, loopBPoint, duration: v ? v.duration : null });
    }

    return true;
  });

  // Helper function to match key press with shortcut
  function matchesShortcut(e, shortcut) {
    const parts = shortcut.split('+');
    const mainKey = parts[parts.length - 1];
    const needsCtrl = parts.includes('Ctrl');
    const needsAlt = parts.includes('Alt');
    const needsShift = parts.includes('Shift');
    
    // Check modifiers
    if (needsCtrl !== e.ctrlKey) return false;
    if (needsAlt !== e.altKey) return false;
    if (needsShift !== e.shiftKey) return false;
    
    // Check main key
    if (mainKey.length === 1) {
      return e.key.toUpperCase() === mainKey.toUpperCase();
    } else {
      return e.key === mainKey;
    }
  }

  const handleKeyPress = (e) => {
    if (!video || !storageKey) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    const shift = e.shiftKey;

    // Add bookmark shortcut
    if (matchesShortcut(e, shortcuts.addBookmark)) {
      const time = Math.floor(video.currentTime);
      if (!bookmarks.some(bm => bm.time === time)) {
        const newBookmark = { time, label: "" };
        bookmarks.push(newBookmark);
        bookmarks.sort((a, b) => a.time - b.time);
        getBookmarkStorage((storage) => {
          storage.set({ [storageKey]: bookmarks }, () => {
            if (chrome.runtime.lastError) {
              bookmarks.pop();
              showBookmarkOverlay('Cloud sync limit reached. Switch to Local Storage in Advanced settings.');
            } else {
              addBookmarkMarker(time);
              currentIndex = bookmarks.findIndex(b => b.time === time);
            }
          });
        });
      }
      return;
    }

    // Next bookmark shortcut
    if (matchesShortcut(e, shortcuts.nextBookmark)) {
      if (bookmarks.length === 0) return;
      currentIndex = Math.min(currentIndex + 1, bookmarks.length - 1);
      video.currentTime = bookmarks[currentIndex].time;
      return;
    }

    // Previous bookmark shortcut
    if (matchesShortcut(e, shortcuts.prevBookmark)) {
      if (bookmarks.length === 0) return;
      currentIndex = Math.max(currentIndex - 1, 0);
      video.currentTime = bookmarks[currentIndex].time;
      return;
    }

    // Label bookmark shortcut
    if (matchesShortcut(e, shortcuts.labelBookmark)) {
      const time = Math.floor(video.currentTime);
      const existing = bookmarks.find(bm => bm.time === time);
      if (!existing) { showBookmarkOverlay('No bookmark at current time'); return; }
      showInputOverlay('Enter bookmark label:', (label) => {
        if (!label) return;
        const oldLabel = existing.label;
        existing.label = label;
        getBookmarkStorage((storage) => {
          storage.set({ [storageKey]: bookmarks }, () => {
            if (chrome.runtime.lastError) {
              existing.label = oldLabel;
              showBookmarkOverlay('Cloud sync limit reached. Switch to Local Storage.');
            } else {
              refreshMarkers();
            }
          });
        });
      });
      return;
    }

    // Remove bookmark shortcut
    if (matchesShortcut(e, shortcuts.removeBookmark)) {
      const time = Math.floor(video.currentTime);
      bookmarks = bookmarks.filter(bm => bm.time !== time);
      getBookmarkStorage((storage) => {
        storage.set({ [storageKey]: bookmarks }, () => refreshMarkers());
      });
      return;
    }

    // Clear all bookmarks shortcut
    if (matchesShortcut(e, shortcuts.clearBookmarks)) {
      bookmarks = [];
      getBookmarkStorage((storage) => {
        storage.remove(storageKey, refreshMarkers);
      });
      return;
    }

    // Show help shortcut
    if (matchesShortcut(e, shortcuts.showHelp)) {
      showHelpPanel();
      return;
    }

    // Manual speed override (Alt + 1-9)
    if (e.altKey && /^[1-9]$/.test(e.key)) {
      const speed = parseFloat(e.key);
      video.playbackRate = speed;
      showSpeedOverlay(speed);
      saveSpeed(speed);

      manualOverride = true;
      clearTimeout(overrideTimeout);
      overrideTimeout = setTimeout(() => {
        manualOverride = false;
      }, 5000);
      return;
    }

    // Increase speed shortcut
    if (matchesShortcut(e, shortcuts.increaseSpeed) || e.key === '=') {
      let currentSpeed = parseFloat(video.playbackRate.toFixed(2));
      let newSpeed = Math.min(20, currentSpeed + 0.25);
      newSpeed = parseFloat(newSpeed.toFixed(2));
      video.playbackRate = newSpeed;
      showSpeedOverlay(newSpeed);
      saveSpeed(newSpeed);
      return;
    }

    // Decrease speed shortcut
    if (matchesShortcut(e, shortcuts.decreaseSpeed) || e.key === '_') {
      let currentSpeed = parseFloat(video.playbackRate.toFixed(2));
      let newSpeed = Math.max(0.25, currentSpeed - 0.25);
      newSpeed = parseFloat(newSpeed.toFixed(2));
      video.playbackRate = newSpeed;
      showSpeedOverlay(newSpeed);
      saveSpeed(newSpeed);
      return;
    }

    // Toggle remaining time overlay shortcut
    if (matchesShortcut(e, shortcuts.toggleTime)) {
      const overlay = document.getElementById('yt-remaining-time');
      if (overlay) {
        overlay.style.display = overlay.style.display === 'none' ? 'block' : 'none';
      }
      return;
    }

    // Set loop A point
    if (matchesShortcut(e, shortcuts.setLoopA)) {
      loopAPoint = video.currentTime;
      showBookmarkOverlay(`⟳ Loop A → ${formatTime(Math.floor(loopAPoint))}`);
      updateLoopOverlay();
      return;
    }

    // Set loop B point
    if (matchesShortcut(e, shortcuts.setLoopB)) {
      loopBPoint = video.currentTime;
      showBookmarkOverlay(`⟳ Loop B → ${formatTime(Math.floor(loopBPoint))}`);
      updateLoopOverlay();
      return;
    }

    // Clear A→B loop
    if (matchesShortcut(e, shortcuts.clearLoop)) {
      loopAPoint = null;
      loopBPoint = null;
      updateLoopOverlay();
      showBookmarkOverlay('Loop cleared');
      return;
    }
  };

  // Apply speed settings

  // ─── Voice Mode Audio Engine ─────────────────────────────────────────────────────

  /**
   * Stores one AudioContext + MediaElementSource per <video> element.
   * WeakMap ensures old video elements are garbage-collected naturally.
   */
  const _audioChains = new WeakMap();

  /**
   * Returns (or lazily creates) the AudioContext chain for a video element.
   * createMediaElementSource may only be called ONCE per element — this
   * ensures we never call it a second time.
   * @param {HTMLVideoElement} videoEl
   * @returns {{ ctx: AudioContext, source: MediaElementAudioSourceNode, activeNodes: AudioNode[], oscNodes: OscillatorNode[] }|null}
   */
  function getOrCreateAudioChain(videoEl) {
    if (_audioChains.has(videoEl)) return _audioChains.get(videoEl);
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(videoEl);
      // currentMode: track last applied mode to avoid needless chain rebuilds every second
      const chain = { ctx, source, activeNodes: [], oscNodes: [], currentMode: null };
      _audioChains.set(videoEl, chain);
      // Resume on any meaningful page interaction — popup clicks don't satisfy
      // Chrome's AudioContext user-gesture requirement for the page context.
      const resume = () => { if (ctx.state === 'suspended') ctx.resume(); };
      videoEl.addEventListener('play',    resume, { once: false });
      videoEl.addEventListener('playing', resume, { once: false });
      document.addEventListener('click',  resume, { once: false });
      document.addEventListener('keydown', resume, { once: false });
      return chain;
    } catch (e) {
      console.warn('[VoiceMode] AudioContext init failed:', e);
      return null;
    }
  }

  /**
   * Disconnects all active effect nodes and stops any oscillators,
   * leaving the source disconnected so the caller can rewire it.
   * @param {{ ctx: AudioContext, source: MediaElementAudioSourceNode, activeNodes: AudioNode[], oscNodes: OscillatorNode[] }} chain
   */
  function clearChainNodes(chain) {
    try { chain.source.disconnect(); } catch (_) {}
    chain.oscNodes.forEach(osc => { try { osc.stop(); } catch (_) {} try { osc.disconnect(); } catch (_) {} });
    chain.activeNodes.forEach(n => { try { n.disconnect(); } catch (_) {} });
    chain.activeNodes = [];
    chain.oscNodes = [];
  }

  /**
   * Applies a voice mode to a video element using the Web Audio API and
   * the browser's native preservesPitch field.
   *
   * Modes:
   *   'normal'    — pitch locked, no DSP effects
   *   'chipmunk'  — pitch follows playback rate (cartoon high / demon low)
   *   'bassboost' — low-shelf +10 dB at 200 Hz
   *   'robot'     — amplitude ring-modulation (30 Hz square oscillator)
   *   'echo'      — 250 ms delay with 45% feedback
   *
   * @param {HTMLVideoElement} videoEl
   * @param {string} mode
   */
  function applyVoiceMode(videoEl, mode) {
    if (!videoEl) return;

    // — preservesPitch: let pitch track speed for modes that benefit from it —
    const preservePitch = !['chipmunk', 'pikachu', 'doraemon'].includes(mode);
    if (typeof videoEl.preservesPitch    !== 'undefined') videoEl.preservesPitch    = preservePitch;
    if (typeof videoEl.mozPreservesPitch !== 'undefined') videoEl.mozPreservesPitch = preservePitch;

    // Normal — bypass Web Audio entirely; restore default path if chain was built
    if (mode === 'normal') {
      if (_audioChains.has(videoEl)) {
        const chain = _audioChains.get(videoEl);
        if (chain.currentMode === 'normal') return; // already bypassed, nothing to do
        clearChainNodes(chain);
        chain.source.connect(chain.ctx.destination);
        chain.currentMode = 'normal';
      }
      return;
    }

    // Web Audio modes — create chain on first use
    const chain = getOrCreateAudioChain(videoEl);
    if (!chain) return;
    const { ctx, source } = chain;

    // Ensure the AudioContext is running. Chrome suspends it until a page-level
    // user gesture; calling resume() here covers the case where the video.play
    // event already fired before the chain was wired.
    if (ctx.state === 'suspended') ctx.resume();

    // Skip full teardown + rewire when the mode hasn't changed — this prevents
    // the chain from going silent every second when applySettings() runs.
    if (chain.currentMode === mode) return;

    clearChainNodes(chain);
    chain.currentMode = mode;

    // Chipmunk — preservesPitch=false lets pitch track speed.
    // 3-band EQ gives a perceptible squeaky character even at 1× speed:
    //   • Cut bass (-8 dB @ 280 Hz)  — removes voice body/weight
    //   • Boost formant (+8 dB @ 1400 Hz) — lifts nasal/vowel region
    //   • Boost treble (+10 dB @ 3000 Hz) — adds squeak
    if (mode === 'chipmunk') {
      const lowCut   = ctx.createBiquadFilter();
      lowCut.type    = 'lowshelf';
      lowCut.frequency.value = 280;
      lowCut.gain.value      = -8;
      const midPeak  = ctx.createBiquadFilter();
      midPeak.type   = 'peaking';
      midPeak.frequency.value = 1400;
      midPeak.Q.value         = 0.9;
      midPeak.gain.value      = 8;
      const highShelf = ctx.createBiquadFilter();
      highShelf.type  = 'highshelf';
      highShelf.frequency.value = 3000;
      highShelf.gain.value      = 10;
      source.connect(lowCut);
      lowCut.connect(midPeak);
      midPeak.connect(highShelf);
      highShelf.connect(ctx.destination);
      chain.activeNodes = [lowCut, midPeak, highShelf];
      return;
    }

    // Pikachu — electric, bright, squeaky character even at 1× speed:
    //   • Hard highpass @ 320 Hz — strips all bass/body
    //   • +11 dB peak @ 1800 Hz  — "pika" bright vowel formant
    //   • +13 dB highshelf @ 4500 Hz — electric air/sparkle
    if (mode === 'pikachu') {
      const hpf = ctx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.value = 320;
      hpf.Q.value = 0.7;
      const formant = ctx.createBiquadFilter();
      formant.type = 'peaking';
      formant.frequency.value = 1800;
      formant.Q.value = 0.8;
      formant.gain.value = 11;
      const air = ctx.createBiquadFilter();
      air.type = 'highshelf';
      air.frequency.value = 4500;
      air.gain.value = 13;
      source.connect(hpf);
      hpf.connect(formant);
      formant.connect(air);
      air.connect(ctx.destination);
      chain.activeNodes = [hpf, formant, air];
      return;
    }

    // Naruto — energetic, shouty, slightly gritty:
    //   • Soft-clip WaveShaper (amount=15) — adds harmonic grit/energy
    //   • −5 dB lowshelf @ 150 Hz — less mud
    //   • +8 dB peak @ 2800 Hz, Q=1.2 — vocal presence / shout
    //   • +5 dB highshelf @ 6000 Hz — open air
    if (mode === 'naruto') {
      const makeClipCurve = (amount) => {
        const n = 256, curve = new Float32Array(n), deg = Math.PI / 180;
        for (let i = 0; i < n; i++) {
          const x = (i * 2) / n - 1;
          curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
        }
        return curve;
      };
      const shaper = ctx.createWaveShaper();
      shaper.curve = makeClipCurve(15);
      shaper.oversample = '2x';
      const lowCut = ctx.createBiquadFilter();
      lowCut.type = 'lowshelf';
      lowCut.frequency.value = 150;
      lowCut.gain.value = -5;
      const presence = ctx.createBiquadFilter();
      presence.type = 'peaking';
      presence.frequency.value = 2800;
      presence.Q.value = 1.2;
      presence.gain.value = 8;
      const airShelf = ctx.createBiquadFilter();
      airShelf.type = 'highshelf';
      airShelf.frequency.value = 6000;
      airShelf.gain.value = 5;
      source.connect(shaper);
      shaper.connect(lowCut);
      lowCut.connect(presence);
      presence.connect(airShelf);
      airShelf.connect(ctx.destination);
      chain.activeNodes = [shaper, lowCut, presence, airShelf];
      return;
    }

    // Doraemon — nasal toy-robot with warm flutter:
    //   • Highpass @ 400 Hz — removes bass weight
    //   • +12 dB peak @ 1100 Hz, Q=1.5 — nasal resonance (signature quality)
    //   • +7 dB highshelf @ 3200 Hz — bright toy-robot tone
    //   • 80 Hz ring-mod (slower than Robot's 30 Hz) — warm, cartoon flutter
    if (mode === 'doraemon') {
      const hpf = ctx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.value = 400;
      hpf.Q.value = 0.7;
      const nasal = ctx.createBiquadFilter();
      nasal.type = 'peaking';
      nasal.frequency.value = 1100;
      nasal.Q.value = 1.5;
      nasal.gain.value = 12;
      const bright = ctx.createBiquadFilter();
      bright.type = 'highshelf';
      bright.frequency.value = 3200;
      bright.gain.value = 7;
      // Ring modulation at 80 Hz — produces characteristic "dora" warble
      const ringGain = ctx.createGain();
      ringGain.gain.value = 0;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 80;
      // EQ chain feeds into ring-mod gain node
      hpf.connect(nasal);
      nasal.connect(bright);
      bright.connect(ringGain);
      source.connect(hpf);
      osc.connect(ringGain.gain);
      ringGain.connect(ctx.destination);
      osc.start();
      chain.activeNodes = [hpf, nasal, bright, ringGain];
      chain.oscNodes = [osc];
      return;
    }

    if (mode === 'bassboost') {
      // Low-shelf boosts bass frequencies
      const shelf = ctx.createBiquadFilter();
      shelf.type = 'lowshelf';
      shelf.frequency.value = 200;
      shelf.gain.value = 10;
      source.connect(shelf);
      shelf.connect(ctx.destination);
      chain.activeNodes = [shelf];

    } else if (mode === 'robot') {
      // Ring modulation: a square-wave oscillator amplitude-modulates the source
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 30;
      const gainNode = ctx.createGain();
      gainNode.gain.value = 0;      // base gain = 0; osc drives it to ±1
      source.connect(gainNode);
      osc.connect(gainNode.gain);   // audio-rate modulation of gain
      gainNode.connect(ctx.destination);
      osc.start();
      chain.activeNodes = [gainNode];
      chain.oscNodes   = [osc];

    } else if (mode === 'echo') {
      // Delay + feedback loop, mixed with dry signal
      const delay    = ctx.createDelay(3.0);
      delay.delayTime.value = 0.25;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.45;
      const wetGain  = ctx.createGain();
      wetGain.gain.value = 0.55;
      // dry
      source.connect(ctx.destination);
      // wet with feedback
      source.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);          // feedback loop
      delay.connect(wetGain);
      wetGain.connect(ctx.destination);
      chain.activeNodes = [delay, feedback, wetGain];
    }
  }

  /**
   * Fetches sponsor segments from SponsorBlock API for a given video ID.
   * Silently fails if offline or API unavailable — never blocks playback.
   * @param {string} videoId
   */
  async function fetchSponsorSegments(videoId) {
    sponsorSegments = [];
    chrome.storage.sync.get(['sponsorBlock'], async ({ sponsorBlock }) => {
      if (!sponsorBlock) return;
      try {
        const url = `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(videoId)}&categories=["sponsor"]`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        sponsorSegments = data.map(s => ({ start: s.segment[0], end: s.segment[1] }));
      } catch (_) {
        // Silently ignore — SponsorBlock is a best-effort feature
      }
    });
  }

  function applySettings() {
    if (manualOverride) return; // Prevent auto-speed adjustment during manual override

    chrome.storage.sync.get(["speed", "rememberSpeed", "voiceMode", "pitchCorrection", "skipAds", "sponsorBlock", "autoTheater", "autoSubtitles", "focusMode"], ({ speed, rememberSpeed, voiceMode, pitchCorrection, skipAds, sponsorBlock, autoTheater, autoSubtitles, focusMode }) => {
      const video = document.querySelector('video');
      if (!video || !speed) return;

      // ── Ad skipping ────────────────────────────────────────────────────────
      if (skipAds) {
        // Click the skip button if it is visible
        const skipBtn = document.querySelector(
          '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-slot'
        );
        if (skipBtn) {
          skipBtn.click();
        } else {
          // If an unskippable ad is playing, fast-forward the ad video to trigger
          // the skip button or finish the ad as quickly as possible
          const adShowing = document.querySelector('.ad-showing');
          if (adShowing && !video.paused) {
            video.playbackRate = 16;
          }
        }
      }

      // ── SponsorBlock ──────────────────────────────────────────────────────
      sponsorBlockEnabled = !!sponsorBlock;
      if (sponsorBlock && sponsorSegments.length > 0) {
        const t = video.currentTime;
        for (const seg of sponsorSegments) {
          if (t >= seg.start && t < seg.end - 0.5) {
            video.currentTime = seg.end;
            showBookmarkOverlay('⏭ Sponsor skipped');
            break;
          }
        }
      }

      // Resolve voiceMode (migrate legacy pitchCorrection boolean)
      const mode = voiceMode || (pitchCorrection === false ? 'chipmunk' : 'normal');
      applyVoiceMode(video, mode);

      // ── Auto Theater Mode ─────────────────────────────────────────────────
      // Clicks the theater button once per video load if not already in theater
      if (autoTheater && !theaterApplied) {
        const theaterBtn = document.querySelector('.ytp-size-button');
        const isAlreadyTheater = !!document.querySelector('ytd-watch-flexy[theater]');
        if (theaterBtn && !isAlreadyTheater) {
          theaterBtn.click();
          theaterApplied = true;
        } else if (isAlreadyTheater) {
          theaterApplied = true; // already in theater — no click needed
        }
      }

      // ── Subtitle Auto-Enable ─────────────────────────────────────────────
      // Clicks the captions button once per video load if captions are off
      if (autoSubtitles && !subtitlesApplied) {
        const ccBtn = document.querySelector('.ytp-subtitles-button');
        if (ccBtn) {
          if (ccBtn.getAttribute('aria-pressed') === 'false') {
            ccBtn.click();
          }
          subtitlesApplied = true;
        }
      }

      // ── Focus Mode ───────────────────────────────────────────────────────
      if (focusMode) {
        applyFocusMode();
      } else {
        removeFocusMode();
      }

      // If remember speed per video is enabled, check for video-specific speed
      if (rememberSpeed && storageKey) {
        const videoSpeedKey = `${storageKey}_speed`;
        chrome.storage.local.get([videoSpeedKey], (res) => {
          if (res[videoSpeedKey]) {
            video.playbackRate = parseFloat(res[videoSpeedKey]);
          } else {
            video.playbackRate = parseFloat(speed);
          }
        });
      } else {
        video.playbackRate = parseFloat(speed);
      }
    }); 
  }

  // Focus Mode: hides the YouTube sidebar navigation while watching
  function applyFocusMode() {
    if (document.getElementById('yt-focus-mode-style')) return;
    const style = document.createElement('style');
    style.id = 'yt-focus-mode-style';
    style.textContent = `
      #guide-inner-content,
      ytd-guide-renderer,
      tp-yt-app-drawer#guide,
      ytd-mini-guide-renderer {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  function removeFocusMode() {
    const style = document.getElementById('yt-focus-mode-style');
    if (style) style.remove();
  }

  // Save speed (either globally or per video)
  function saveSpeed(speed) {
    chrome.storage.sync.get(["rememberSpeed"], ({ rememberSpeed }) => {
      // Always save global speed
      chrome.storage.sync.set({ speed: speed.toString() });
      
      // If remember speed per video is enabled, also save video-specific speed
      if (rememberSpeed && storageKey) {
        const videoSpeedKey = `${storageKey}_speed`;
        chrome.storage.local.set({ [videoSpeedKey]: speed.toString() });
      }
    });
  }

  // Add bookmark marker to the progress bar
  const addBookmarkMarker = (time, label = "") => {
    const progressBar = document.querySelector(".ytp-progress-bar");
    if (!progressBar || !video) return;

    const marker = document.createElement("div");
    marker.className = "yt-bookmark-marker";
    marker.style.left = `${(time / video.duration) * 100}%`;
    marker.style.position = "absolute";
    marker.style.width = "0";
    marker.style.height = "0";
    marker.style.cursor = "pointer";
    marker.style.zIndex = "100";
    marker.style.transform = "translateX(-50%)";
    marker.title = label ? `📌 ${label} (${formatTime(time)})` : `📌 Bookmark at ${formatTime(time)}`;
    marker.dataset.time = time;

    // Add bookmark ribbon icon in circle (aligned with timeline)
    marker.innerHTML = `
      <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 16px; height: 16px; background: #ff4444; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">
        <svg viewBox="0 0 24 24" width="10" height="10" style="fill: white;">
          <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"></path>
        </svg>
      </div>
    `;

    marker.addEventListener("click", () => {
      video.currentTime = time;
    });

    progressBar.appendChild(marker);
  };

  const refreshMarkers = () => {
    document.querySelectorAll(".yt-bookmark-marker").forEach(el => el.remove());
    bookmarks.forEach(bm => addBookmarkMarker(bm.time, bm.label));
  };

  const formatTime = (secs) => {
    const hours = Math.floor(secs / 3600);
    const minutes = Math.floor((secs % 3600) / 60);
    const seconds = secs % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  };
  
  // Show overlay with bookmark confirmation
  const showBookmarkOverlay = (text) => {
    let overlay = document.getElementById("yt-bookmark-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "fixed",
        top: "10%",
        right: "10%",
        padding: "10px 20px",
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        color: "#fff",
        fontSize: "22px",
        zIndex: "9999",
        borderRadius: "8px",
        transition: "opacity 0.5s",
      });
      overlay.id = "yt-bookmark-overlay";
      document.body.appendChild(overlay);
    }
    overlay.textContent = text;
    overlay.style.opacity = "1";
    setTimeout(() => {
      overlay.style.opacity = "0";
    }, 1200);
  };

  // ─── Screen Time HUD & Hard Block ──────────────────────────────────────────

  /** Formats seconds → "Xh Ym" or "Zm". */
  function fmtHudTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }

  /** Formats a minute-based limit to a human string ("2h", "1h 30m", "45m"). */
  function fmtLimitMin(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }

  /**
   * Renders (or updates) the screen-time HUD pill inside the YouTube header.
   * On first call the element is created and injected before the #end buttons
   * (right after the voice-search area). Subsequent calls update text + bar only.
   * @param {number} usedSec  - seconds elapsed this session
   * @param {number} limitMin - session limit in minutes
   */
  function renderTimeLimitHud(usedSec, limitMin) {
    const limitSec  = limitMin * 60;
    const remainSec = Math.max(0, limitSec - usedSec);
    const pct       = Math.min(100, Math.round((usedSec / limitSec) * 100));
    const barColor  = pct >= 90 ? '#e04030' : pct >= 70 ? '#f0a030' : '#4ad66d';

    let hud = document.getElementById('yt-ext-time-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'yt-ext-time-hud';
      Object.assign(hud.style, {
        display: 'inline-flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '4px',
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: '20px',
        padding: '5px 13px',
        fontFamily: 'Inter,-apple-system,Helvetica,sans-serif',
        fontSize: '12px',
        color: '#f2f2f2',
        userSelect: 'none',
        cursor: 'default',
        alignSelf: 'center',
        flexShrink: '0',
        marginRight: '4px',
        whiteSpace: 'nowrap',
      });
      hud.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)"
            stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <span id="yt-ext-hud-used" style="font-size:12px;font-weight:600;"></span>
          <span style="color:rgba(255,255,255,0.2);font-size:10px;">|</span>
          <span id="yt-ext-hud-remain" style="font-size:11px;color:rgba(255,255,255,0.45);"></span>
        </div>
        <div style="height:2px;background:rgba(255,255,255,0.08);border-radius:99px;overflow:hidden;">
          <div id="yt-ext-hud-bar" style="height:100%;border-radius:99px;transition:width .6s,background .6s;"></div>
        </div>
      `;

      // Inject into the YT header's #end section (right of search+voice area).
      // Retries until the header is ready (SPA navigation may delay it).
      const attach = () => {
        const end = document.querySelector('ytd-masthead #end');
        if (end) {
          end.insertBefore(hud, end.firstChild);
        } else {
          setTimeout(attach, 400);
        }
      };
      attach();
    }

    document.getElementById('yt-ext-hud-used').textContent   = fmtHudTime(usedSec) + ' used';
    document.getElementById('yt-ext-hud-remain').textContent = remainSec > 0
      ? fmtHudTime(remainSec) + ' left'
      : 'limit reached';
    const bar = document.getElementById('yt-ext-hud-bar');
    if (bar) { bar.style.width = pct + '%'; bar.style.background = barColor; }
  }

  function removeTimeLimitHud() {
    document.getElementById('yt-ext-time-hud')?.remove();
  }

  /**
   * Shared list of valid reasons a user may give to start a new session.
   * Shown as pill buttons on the hard-block overlay.
   */
  const SESSION_REASONS = [
    'Work / Professional task',
    'Learning & Study',
    'News & Current events',
    'Research & Information',
    'Creative project',
    'Official communication',
  ];

  /**
   * Starts (or restarts) the per-second session countdown timer for YouTube.
   * Writes usedSec to renderTimeLimitHud on every tick; triggers hard-block
   * and sets ytSessionBlocked:true when the session expires.
   * @param {number} limitMin - session length in minutes
   */
  function _startYtSessionTimer(limitMin) {
    if (_ytSessionTimer) clearInterval(_ytSessionTimer);
    const limitSec = limitMin * 60;
    _ytSessionTimer = setInterval(() => {
      if (!isCtxValid()) { clearInterval(_ytSessionTimer); return; }
      chrome.storage.local.get(['ytSessionStart', 'ytSessionBlocked'], (local) => {
        if (local.ytSessionBlocked) { clearInterval(_ytSessionTimer); return; }
        if (!local.ytSessionStart) return;
        const usedSec = Math.round((Date.now() - local.ytSessionStart) / 1000);
        if (usedSec >= limitSec) {
          clearInterval(_ytSessionTimer);
          removeTimeLimitHud();
          chrome.storage.local.set({ ytSessionBlocked: true });
          showTimeLimitOverlay(limitMin);
        } else {
          renderTimeLimitHud(usedSec, limitMin);
        }
      });
    }, 1000);
  }

  /**
   * Session-based screen time HUD controller for YouTube.
   * Tracks time since the session started (ytSessionStart in local storage).
   * Reacts live when the limit is toggled in the popup or a new session begins.
   */
  function initTimeLimitHud() {
    function evalHud() {
      if (!isCtxValid()) return;
      chrome.storage.sync.get(['ytLimitEnabled', 'ytDailyLimit'], (syncData) => {
        if (!isCtxValid()) return;
        if (!syncData.ytLimitEnabled) {
          if (_ytSessionTimer) { clearInterval(_ytSessionTimer); _ytSessionTimer = null; }
          removeTimeLimitHud();
          return;
        }
        const limitMin = parseInt(syncData.ytDailyLimit || 120, 10);
        chrome.storage.local.get(['ytSessionBlocked', 'ytSessionStart'], (local) => {
          if (!isCtxValid()) return;
          if (local.ytSessionBlocked) {
            removeTimeLimitHud();
            showTimeLimitOverlay(limitMin);
            return;
          }
          if (!local.ytSessionStart) {
            // First visit — start the session clock now.
            chrome.storage.local.set({ ytSessionStart: Date.now() }, () => _startYtSessionTimer(limitMin));
          } else {
            _startYtSessionTimer(limitMin);
          }
        });
      });
    }

    evalHud();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (!isCtxValid()) return;
      // Limit toggled/changed in popup → re-eval immediately.
      if (area === 'sync' && (changes.ytLimitEnabled !== undefined || changes.ytDailyLimit !== undefined)) {
        evalHud();
      }
      // New session started from the block overlay → remove overlay + restart HUD.
      if (area === 'local' && changes.ytSessionBlocked?.newValue === false) {
        document.getElementById('yt-time-limit-overlay')?.remove();
        evalHud();
      }
    });
  }

  /**
   * Full-screen session-ended overlay for YouTube.
   * Offers a reason-picker to start a new session, or "Close Tab".
   * @param {number} limitMin - session length in minutes
   */
  function showTimeLimitOverlay(limitMin) {
    if (document.getElementById('yt-time-limit-overlay')) return;

    const v = document.querySelector('video');
    if (v) v.pause();

    const overlay = document.createElement('div');
    overlay.id = 'yt-time-limit-overlay';
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
        Your <strong style="color:rgba(255,255,255,0.72)">YouTube</strong> session of
        <strong style="color:rgba(255,255,255,0.72)">${fmtLimitMin(limitMin)}</strong> has ended.
      </div>
      <div style="font-size:13px;color:rgba(255,255,255,0.3);margin-bottom:24px">
        Select a valid reason to start a new session.
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:480px;margin-bottom:28px">
        ${reasonBtnsHtml}
      </div>
      <div style="display:flex;gap:12px;align-items:center">
        <button id="yt-new-session-btn" disabled style="
          background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.13);
          color:rgba(255,255,255,0.3);border-radius:8px;padding:11px 28px;
          font-size:13px;font-family:inherit;cursor:not-allowed;transition:all .2s;opacity:.45">
          New Session
        </button>
        <button id="yt-time-limit-close" style="
          background:transparent;border:1px solid rgba(255,255,255,0.1);
          color:rgba(255,255,255,0.4);border-radius:8px;padding:11px 28px;
          font-size:13px;font-family:inherit;cursor:pointer;transition:all .2s">
          Close Tab
        </button>
      </div>
    `;
    document.body.appendChild(overlay);

    // Reason pill selection
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
        const newBtn = document.getElementById('yt-new-session-btn');
        newBtn.disabled = false;
        newBtn.style.opacity = '1';
        newBtn.style.cursor = 'pointer';
        newBtn.style.color = '#fff';
        newBtn.style.borderColor = 'rgba(255,255,255,0.28)';
      });
    });

    // New Session: only enabled after a reason is picked
    document.getElementById('yt-new-session-btn').addEventListener('click', () => {
      if (!selectedReason) return;
      chrome.storage.local.set({ ytSessionBlocked: false, ytSessionStart: Date.now() });
      // Overlay removed via storage.onChanged → ytSessionBlocked = false in initTimeLimitHud
    });

    document.getElementById('yt-time-limit-close').addEventListener('click', () => window.close());
  }

  /**
   * Inline text input overlay — replaces browser prompt() in the content script.   * @param {string} labelText - Description shown above the input
   * @param {function} callback - Called with the entered string or null on cancel
   */
  const showInputOverlay = (labelText, callback) => {
    const existing = document.getElementById('yt-input-overlay');
    if (existing) existing.remove();

    const wrap = document.createElement('div');
    wrap.id = 'yt-input-overlay';
    Object.assign(wrap.style, {
      position: 'fixed', top: '50%', left: '50%',
      transform: 'translate(-50%, -50%)',
      background: '#1a1a1a', color: '#fff',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '12px', padding: '18px 20px',
      zIndex: '99999', minWidth: '280px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
      fontFamily: 'Inter, sans-serif',
    });

    const desc = document.createElement('div');
    desc.textContent = labelText;
    desc.style.cssText = 'font-size:13px; color:rgba(255,255,255,0.6); margin-bottom:10px;';

    const input = document.createElement('input');
    Object.assign(input.style, {
      width: '100%', boxSizing: 'border-box',
      background: 'rgba(255,255,255,0.08)',
      border: '1px solid rgba(255,255,255,0.2)',
      borderRadius: '8px', color: '#fff',
      padding: '8px 12px', fontSize: '14px', outline: 'none',
    });

    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:8px; margin-top:12px; justify-content:flex-end;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    Object.assign(cancelBtn.style, {
      background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
      color: '#fff', borderRadius: '7px', padding: '6px 14px',
      cursor: 'pointer', fontSize: '13px',
    });

    const okBtn = document.createElement('button');
    okBtn.textContent = 'Save';
    Object.assign(okBtn.style, {
      background: '#ff0000', border: 'none', color: '#fff',
      borderRadius: '7px', padding: '6px 14px',
      cursor: 'pointer', fontSize: '13px',
    });

    const finish = (val) => { wrap.remove(); callback(val); };
    cancelBtn.onclick = () => finish(null);
    okBtn.onclick     = () => finish(input.value.trim() || null);
    input.onkeydown   = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter')  finish(input.value.trim() || null);
      if (e.key === 'Escape') finish(null);
    };

    row.append(cancelBtn, okBtn);
    wrap.append(desc, input, row);
    document.body.appendChild(wrap);
    input.focus();
  };

  // Show overlay with speed change confirmation
  function showSpeedOverlay(speed) {
    let overlay = document.getElementById("yt-speed-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "fixed",
        top: "10%",
        right: "10%",
        padding: "10px 20px",
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        color: "#fff",
        fontSize: "24px",
        zIndex: "9999",
        borderRadius: "8px",
        transition: "opacity 0.5s",
      });
      overlay.id = "yt-speed-overlay";
      document.body.appendChild(overlay);
    }
    overlay.textContent = `Speed: ${speed}x`;
    overlay.style.opacity = "1";
    setTimeout(() => {
      overlay.style.opacity = "0";
    }, 1000);
  }

  // Add remaining time overlay
  function addRemainingTimeOverlay() {
    const video = document.querySelector('video');
    if (!video || document.getElementById('yt-remaining-time')) return;
  
    // Find the video container
    const videoContainer = document.querySelector('.html5-video-player');
    if (!videoContainer) {
      setTimeout(addRemainingTimeOverlay, 1000);
      return;
    }

    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'absolute',
      top: '10px',
      left: '10px',
      padding: '6px 12px',
      background: 'rgba(0,0,0,0.7)',
      color: '#fff',
      fontSize: '14px',
      borderRadius: '6px',
      zIndex: '9999',
      cursor: 'move',
      pointerEvents: 'auto'
    });
    overlay.id = 'yt-remaining-time';
    videoContainer.appendChild(overlay);
  
    function formatTime(seconds) {
      const hrs = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      return `${hrs} hour : ${mins} min : ${secs} sec`;
    }
  
    // Dragging logic - constrained to video container
    let isDragging = false, offsetX, offsetY;
    overlay.addEventListener('mousedown', (e) => {
      isDragging = true;
      offsetX = e.clientX - overlay.getBoundingClientRect().left;
      offsetY = e.clientY - overlay.getBoundingClientRect().top;
      e.stopPropagation();
    });
    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        const containerRect = videoContainer.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        
        let newLeft = e.clientX - offsetX - containerRect.left;
        let newTop = e.clientY - offsetY - containerRect.top;
        
        // Constrain within video container bounds
        newLeft = Math.max(0, Math.min(newLeft, containerRect.width - overlayRect.width));
        newTop = Math.max(0, Math.min(newTop, containerRect.height - overlayRect.height));
        
        overlay.style.left = `${newLeft}px`;
        overlay.style.top = `${newTop}px`;
      }
    });
    document.addEventListener('mouseup', () => isDragging = false);
  
    // Update loop
    setInterval(() => {
      if (!video.duration || isNaN(video.duration)) return;
      const remaining = video.duration - video.currentTime;
      const percent = ((remaining / video.duration) * 100).toFixed(1);
      overlay.textContent = `⏳ ${formatTime(remaining)}  |  ${percent}% left`;
    }, 1000);
  }
  
  // ⏳ Wait for video to load, then add overlay
  const checkForVideo = setInterval(() => {
    const video = document.querySelector("video");
    if (video) {
      clearInterval(checkForVideo);
      addRemainingTimeOverlay();
    }
  }, 1000);
  
  // Note: Toggle Overlay with Alt + R is now handled in handleKeyPress with configurable shortcuts
  
  // Toggle bookmark organizer panel
  function toggleBookmarkPanel() {
    let panel = document.getElementById('yt-bookmark-panel');
    
    if (panel) {
      panel.remove();
      return;
    }

    const videoContainer = document.querySelector('.html5-video-player');
    if (!videoContainer) return;

    panel = document.createElement('div');
    panel.id = 'yt-bookmark-panel';
    Object.assign(panel.style, {
      position: 'absolute',
      top: '20px',
      right: '20px',
      width: '420px',
      maxHeight: '500px',
      background: 'rgba(18, 18, 18, 0.95)',
      backdropFilter: 'blur(10px)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
      zIndex: '10000',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    });

    // Add custom scrollbar styles
    const style = document.createElement('style');
    style.textContent = `
      #yt-bookmark-list {
        overflow-y: scroll;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.3) transparent;
      }
      #yt-bookmark-list::-webkit-scrollbar {
        width: 6px;
      }
      #yt-bookmark-list::-webkit-scrollbar-track {
        background: transparent;
      }
      #yt-bookmark-list::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.3);
        border-radius: 3px;
        min-height: 30px;
      }
      #yt-bookmark-list::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.5);
      }
      #yt-bookmark-list::-webkit-scrollbar-button {
        display: none;
        height: 0;
        width: 0;
      }
    `;
    document.head.appendChild(style);

    // Header
    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '16px 20px',
      borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      background: 'rgba(0, 0, 0, 0.3)'
    });

    const headerTop = document.createElement('div');
    Object.assign(headerTop.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    });

    const title = document.createElement('div');
    title.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" style="fill: white; vertical-align: middle; margin-right: 8px;">
        <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z"></path>
      </svg>
      <span style="color: white; font-size: 16px; font-weight: 600; vertical-align: middle;">Bookmarks</span>
    `;
    
    const timeSavedDiv = document.createElement('div');
    Object.assign(timeSavedDiv.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '10px 14px',
      background: 'rgba(16, 185, 129, 0.1)',
      border: '1px solid rgba(16, 185, 129, 0.2)',
      borderRadius: '8px',
      fontSize: '13px',
      color: 'rgba(16, 185, 129, 0.95)'
    });
    timeSavedDiv.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
      <span style="font-weight: 500;">Time Saved: <span id="time-saved-display">${formatTimeSaved(totalTimeSaved)}</span></span>
    `;

    const addBtn = document.createElement('button');
    addBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" style="fill: white;">
        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"></path>
      </svg>
    `;
    Object.assign(addBtn.style, {
      background: 'rgba(255, 255, 255, 0.1)',
      border: 'none',
      borderRadius: '6px',
      padding: '8px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'background 0.2s'
    });
    addBtn.title = 'Add bookmark at current time';
    addBtn.onmouseover = () => addBtn.style.background = 'rgba(255, 255, 255, 0.2)';
    addBtn.onmouseout = () => addBtn.style.background = 'rgba(255, 255, 255, 0.1)';
    addBtn.onclick = () => addBookmarkAtCurrentTime();

    const exportBtn = document.createElement('button');
    exportBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="17 8 12 3 7 8"></polyline>
        <line x1="12" y1="3" x2="12" y2="15"></line>
      </svg>
    `;
    Object.assign(exportBtn.style, {
      background: 'rgba(255, 255, 255, 0.1)',
      border: 'none',
      borderRadius: '6px',
      padding: '8px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'background 0.2s'
    });
    exportBtn.title = 'Export bookmarks';
    exportBtn.onmouseover = () => exportBtn.style.background = 'rgba(255, 255, 255, 0.2)';
    exportBtn.onmouseout = () => exportBtn.style.background = 'rgba(255, 255, 255, 0.1)';
    exportBtn.onclick = () => exportBookmarks();

    const importBtn = document.createElement('button');
    importBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
    `;
    Object.assign(importBtn.style, {
      background: 'rgba(255, 255, 255, 0.1)',
      border: 'none',
      borderRadius: '6px',
      padding: '8px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'background 0.2s'
    });
    importBtn.title = 'Import bookmarks';
    importBtn.onmouseover = () => importBtn.style.background = 'rgba(255, 255, 255, 0.2)';
    importBtn.onmouseout = () => importBtn.style.background = 'rgba(255, 255, 255, 0.1)';
    importBtn.onclick = () => importBookmarks();

    const helpBtn = document.createElement('button');
    helpBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" style="fill: white;">
        <path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"></path>
      </svg>
    `;
    Object.assign(helpBtn.style, {
      background: 'rgba(255, 255, 255, 0.1)',
      border: 'none',
      borderRadius: '6px',
      padding: '8px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'background 0.2s'
    });
    helpBtn.title = 'Help & Shortcuts';
    helpBtn.onmouseover = () => helpBtn.style.background = 'rgba(255, 255, 255, 0.2)';
    helpBtn.onmouseout = () => helpBtn.style.background = 'rgba(255, 255, 255, 0.1)';
    helpBtn.onclick = () => showHelpPanel();

    const undoBtn = document.createElement('button');
    undoBtn.id = 'yt-undo-btn';
    undoBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" style="fill: white;">
        <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"></path>
      </svg>
    `;
    Object.assign(undoBtn.style, {
      background: 'rgba(255, 255, 255, 0.1)',
      border: 'none',
      borderRadius: '6px',
      padding: '8px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'background 0.2s',
      opacity: '0.3'
    });
    undoBtn.title = 'Undo last deletion';
    undoBtn.disabled = true;
    undoBtn.onmouseover = () => {
      if (deletedBookmarks.length > 0) undoBtn.style.background = 'rgba(255, 255, 255, 0.2)';
    };
    undoBtn.onmouseout = () => undoBtn.style.background = 'rgba(255, 255, 255, 0.1)';
    undoBtn.onclick = () => undoLastDeletion();

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" style="fill: white;">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"></path>
      </svg>
    `;
    Object.assign(closeBtn.style, {
      background: 'transparent',
      border: 'none',
      borderRadius: '6px',
      padding: '8px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'background 0.2s',
      marginLeft: '8px'
    });
    closeBtn.onmouseover = () => closeBtn.style.background = 'rgba(255, 255, 255, 0.1)';
    closeBtn.onmouseout = () => closeBtn.style.background = 'transparent';
    closeBtn.onclick = () => panel.remove();

    const headerRight = document.createElement('div');
    headerRight.style.display = 'flex';
    headerRight.style.gap = '12px';
    headerRight.appendChild(addBtn);
    headerRight.appendChild(exportBtn);
    headerRight.appendChild(importBtn);
    headerRight.appendChild(helpBtn);
    headerRight.appendChild(undoBtn);
    headerRight.appendChild(closeBtn);

    headerTop.appendChild(title);
    headerTop.appendChild(headerRight);
    
    header.appendChild(headerTop);
    header.appendChild(timeSavedDiv);

    // Bookmark list container
    const listContainer = document.createElement('div');
    Object.assign(listContainer.style, {
      padding: '12px',
      overflowY: 'auto',
      height: '240px',
      minHeight: '240px'
    });
    listContainer.id = 'yt-bookmark-list';
    
    // Prevent YouTube scroll when scrolling in panel
    listContainer.addEventListener('wheel', (e) => {
      e.stopPropagation();
    }, { passive: true });

    panel.appendChild(header);
    panel.appendChild(listContainer);
    videoContainer.appendChild(panel);

    // Prevent YouTube keyboard shortcuts when panel is open
    const blockYTKeys = (e) => {
      e.stopPropagation();
    };
    panel.addEventListener('keydown', blockYTKeys, true);
    panel.addEventListener('keyup', blockYTKeys, true);
    panel.addEventListener('keypress', blockYTKeys, true);

    // Load and display bookmarks
    refreshBookmarkList();
    updateUndoButton();

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function closePanel(e) {
        if (!panel.contains(e.target) && e.target.id !== 'yt-bookmark-btn') {
          panel.remove();
          document.removeEventListener('click', closePanel);
        }
      });
    }, 100);
  }

  // Add bookmark at current time
  function addBookmarkAtCurrentTime() {
    const video = document.querySelector('video');
    if (!video || !storageKey) return;
    
    const time = Math.floor(video.currentTime);
    if (!bookmarks.some(bm => bm.time === time)) {
      const newBookmark = { time, label: "" };
      bookmarks.push(newBookmark);
      bookmarks.sort((a, b) => a.time - b.time);
      getBookmarkStorage((storage) => {
        storage.set({ [storageKey]: bookmarks }, () => {
          if (chrome.runtime.lastError) {
            bookmarks.pop();
            showBookmarkOverlay('Cloud sync limit reached. Switch to Local Storage in Advanced settings.');
          } else {
            addBookmarkMarker(time);
            currentIndex = bookmarks.findIndex(b => b.time === time);
            refreshBookmarkList();
          }
        });
      });
    }
  }

  // Refresh bookmark list in panel
  function refreshBookmarkList() {
    const listContainer = document.getElementById('yt-bookmark-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    if (bookmarks.length === 0) {
      const emptyMsg = document.createElement('div');
      Object.assign(emptyMsg.style, {
        color: 'rgba(255, 255, 255, 0.5)',
        textAlign: 'center',
        padding: '40px 20px',
        fontSize: '14px'
      });
      emptyMsg.textContent = 'No bookmarks yet. Press P or click + to add one.';
      listContainer.appendChild(emptyMsg);
      return;
    }

    bookmarks.forEach((bm, index) => {
      const item = document.createElement('div');
      Object.assign(item.style, {
        background: 'rgba(255, 255, 255, 0.05)',
        borderRadius: '8px',
        padding: '12px',
        marginBottom: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        transition: 'background 0.2s'
      });
      item.dataset.expanded = 'false';

      // Top row container
      const topRow = document.createElement('div');
      Object.assign(topRow.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        cursor: 'pointer'
      });
      topRow.onmouseover = () => item.style.background = 'rgba(255, 255, 255, 0.1)';
      topRow.onmouseout = () => item.style.background = 'rgba(255, 255, 255, 0.05)';

      // Time badge
      const timeBadge = document.createElement('div');
      Object.assign(timeBadge.style, {
        background: 'rgba(255, 68, 68, 0.2)',
        color: '#ff4444',
        padding: '6px 10px',
        borderRadius: '6px',
        fontSize: '13px',
        fontWeight: '600',
        minWidth: '70px',
        textAlign: 'center'
      });
      timeBadge.textContent = formatTime(bm.time);

      // Label input (expandable)
      const labelInput = document.createElement('textarea');
      Object.assign(labelInput.style, {
        flex: '1',
        background: 'transparent',
        border: 'none',
        color: 'white',
        fontSize: '14px',
        outline: 'none',
        padding: '4px',
        minWidth: '0',
        resize: 'none',
        overflow: 'hidden',
        height: '22px',
        transition: 'height 0.2s cubic-bezier(0.4, 0, 0.2, 1), background 0.2s ease, padding 0.2s ease',
        fontFamily: 'inherit',
        lineHeight: '1.4',
        willChange: 'height'
      });
      labelInput.placeholder = 'Notes...';
      labelInput.value = bm.label || '';
      labelInput.rows = 1;

      // Expand on click/focus
      const expandLabel = () => {
        // Collapse all other expanded items
        document.querySelectorAll('.yt-bookmark-item-expanded').forEach(other => {
          const otherInput = other.querySelector('textarea');
          if (otherInput && otherInput !== labelInput) {
            otherInput.style.height = '22px';
            otherInput.style.background = 'transparent';
            otherInput.style.padding = '4px';
            other.classList.remove('yt-bookmark-item-expanded');
          }
        });

        item.classList.add('yt-bookmark-item-expanded');
        labelInput.style.height = '60px';
        labelInput.style.background = 'rgba(0, 0, 0, 0.3)';
        labelInput.style.borderRadius = '6px';
        labelInput.style.padding = '6px';
      };

      const collapseLabel = () => {
        labelInput.style.height = '22px';
        labelInput.style.background = 'transparent';
        labelInput.style.padding = '4px';
        item.classList.remove('yt-bookmark-item-expanded');
        const oldLabel = bm.label;
        bm.label = labelInput.value;
        getBookmarkStorage((storage) => {
          storage.set({ [storageKey]: bookmarks }, () => {
            if (chrome.runtime.lastError) {
              bm.label = oldLabel;
              labelInput.value = oldLabel;
              showBookmarkOverlay('Cloud sync limit reached. Switch to Local Storage in Advanced settings.');
            } else {
              refreshMarkers();
            }
          });
        });
      };

      labelInput.onclick = (e) => {
        e.stopPropagation();
        expandLabel();
      };

      labelInput.onfocus = () => {
        expandLabel();
      };

      labelInput.onblur = () => {
        collapseLabel();
      };

      labelInput.oninput = () => {
        bm.label = labelInput.value;
      };

      labelInput.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          labelInput.blur(); // This will trigger collapseLabel which saves the note
        }
      };

      // Click handler - expand on row click
      topRow.onclick = (e) => {
        if (e.target === jumpBtn || e.target.closest('button') === jumpBtn ||
            e.target === deleteBtn || e.target.closest('button') === deleteBtn ||
            e.target === labelInput) {
          return;
        }
        
        labelInput.focus();
      };

      // Jump button
      const jumpBtn = document.createElement('button');
      jumpBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" style="fill: white;">
          <path d="M8 5v14l11-7z"></path>
        </svg>
      `;
      Object.assign(jumpBtn.style, {
        background: 'rgba(255, 255, 255, 0.1)',
        border: 'none',
        borderRadius: '6px',
        padding: '6px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        transition: 'background 0.2s'
      });
      jumpBtn.title = 'Jump to this time';
      jumpBtn.onmouseover = () => jumpBtn.style.background = 'rgba(255, 255, 255, 0.2)';
      jumpBtn.onmouseout = () => jumpBtn.style.background = 'rgba(255, 255, 255, 0.1)';
      jumpBtn.onclick = (e) => {
        e.stopPropagation();
        const video = document.querySelector('video');
        if (video) video.currentTime = bm.time;
      };

      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" style="fill: #ff4444;">
          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"></path>
        </svg>
      `;
      Object.assign(deleteBtn.style, {
        background: 'rgba(255, 68, 68, 0.1)',
        border: 'none',
        borderRadius: '6px',
        padding: '6px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        transition: 'background 0.2s'
      });
      deleteBtn.title = 'Delete bookmark';
      deleteBtn.onmouseover = () => deleteBtn.style.background = 'rgba(255, 68, 68, 0.2)';
      deleteBtn.onmouseout = () => deleteBtn.style.background = 'rgba(255, 68, 68, 0.1)';
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        
        // Add to deletion stack
        deletedBookmarks.push({ bookmark: { ...bm }, index: index });
        
        // Remove bookmark
        bookmarks.splice(index, 1);
        getBookmarkStorage((storage) => {
          storage.set({ [storageKey]: bookmarks }, () => {
            refreshMarkers();
            refreshBookmarkList();
            updateUndoButton();
          });
        });
      };

      // Copy timestamp link (copies https://youtu.be/ID?t=N to clipboard)
      const copyLinkBtn = document.createElement('button');
      copyLinkBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
      `;
      Object.assign(copyLinkBtn.style, {
        background: 'rgba(255, 255, 255, 0.1)',
        border: 'none',
        borderRadius: '6px',
        padding: '6px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        transition: 'background 0.2s',
      });
      copyLinkBtn.title = 'Copy YouTube link at this timestamp';
      copyLinkBtn.onmouseover = () => copyLinkBtn.style.background = 'rgba(255, 255, 255, 0.2)';
      copyLinkBtn.onmouseout = () => copyLinkBtn.style.background = 'rgba(255, 255, 255, 0.1)';
      copyLinkBtn.onclick = (e) => {
        e.stopPropagation();
        const vidId = new URLSearchParams(window.location.search).get('v');
        if (!vidId) { showBookmarkOverlay('Not on a video page'); return; }
        const url = `https://youtu.be/${vidId}?t=${bm.time}`;
        navigator.clipboard.writeText(url).then(() => {
          showBookmarkOverlay('🔗 Link copied!');
        }).catch(() => {
          showBookmarkOverlay('Copy failed');
        });
      };

      topRow.appendChild(timeBadge);
      topRow.appendChild(labelInput);
      topRow.appendChild(jumpBtn);
      topRow.appendChild(copyLinkBtn);
      topRow.appendChild(deleteBtn);

      item.appendChild(topRow);

      listContainer.appendChild(item);
    });
  }

  // Undo last deletion
  function undoLastDeletion() {
    if (deletedBookmarks.length === 0) return;
    
    const lastDeleted = deletedBookmarks.pop();
    bookmarks.splice(lastDeleted.index, 0, lastDeleted.bookmark);
    
    getBookmarkStorage((storage) => {
      storage.set({ [storageKey]: bookmarks }, () => {
        if (chrome.runtime.lastError) {
          bookmarks.splice(lastDeleted.index, 1);
          deletedBookmarks.push(lastDeleted);
          showBookmarkOverlay('Cloud sync limit reached. Switch to Local Storage in Advanced settings.');
        } else {
          refreshMarkers();
          refreshBookmarkList();
          updateUndoButton();
        }
      });
    });
  }

  // Update time saved tracker
  function updateTimeSaved() {
    if (!video || video.paused) return;
    
    const now = Date.now();
    if (lastUpdateTime === 0) {
      lastUpdateTime = now;
      return;
    }
    
    const currentSpeed = video.playbackRate;
    if (currentSpeed > 1) {
      const elapsed = (now - lastUpdateTime) / 1000;
      const timeSaved = elapsed * (currentSpeed - 1) / currentSpeed;
      totalTimeSaved += timeSaved;
      
      chrome.storage.local.set({ totalTimeSaved });
    }
    
    lastUpdateTime = now;
    
    const timeSavedDisplay = document.getElementById('time-saved-display');
    if (timeSavedDisplay) {
      timeSavedDisplay.textContent = formatTimeSaved(totalTimeSaved);
    }
  }
  
  // Format time saved for display
  function formatTimeSaved(seconds) {
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }

  // Update undo button state
  function updateUndoButton() {
    const undoBtn = document.getElementById('yt-undo-btn');
    if (!undoBtn) return;
    
    if (deletedBookmarks.length > 0) {
      undoBtn.disabled = false;
      undoBtn.style.opacity = '1';
      undoBtn.style.cursor = 'pointer';
      undoBtn.title = `Undo last deletion (${deletedBookmarks.length} available)`;
    } else {
      undoBtn.disabled = true;
      undoBtn.style.opacity = '0.3';
      undoBtn.style.cursor = 'not-allowed';
      undoBtn.title = 'No deletions to undo';
    }
  }

  // Export bookmarks
  function exportBookmarks() {
    if (bookmarks.length === 0) {
      showBookmarkOverlay('No bookmarks to export');
      return;
    }

    const videoId = new URLSearchParams(window.location.search).get("v");
    const videoTitle = document.title.replace(' - YouTube', '');
    
    const exportData = {
      videoId: videoId,
      videoTitle: videoTitle,
      url: window.location.href,
      exportDate: new Date().toISOString(),
      bookmarks: bookmarks
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bookmarks_${videoId}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Import bookmarks
  function importBookmarks() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const importData = JSON.parse(event.target.result);
          
          if (!importData.bookmarks || !Array.isArray(importData.bookmarks)) {
            showBookmarkOverlay('Invalid bookmark file format');
            return;
          }

          // Merge with existing bookmarks
          const merged = [...bookmarks, ...importData.bookmarks];
          const unique = merged.filter((bm, index, self) => 
            index === self.findIndex(b => b.time === bm.time)
          );
          unique.sort((a, b) => a.time - b.time);

          bookmarks = unique;
          getBookmarkStorage((storage) => {
            storage.set({ [storageKey]: bookmarks }, () => {
              if (chrome.runtime.lastError) {
                bookmarks = bookmarks.slice(0, -importData.bookmarks.length);
                showBookmarkOverlay('Cloud sync limit reached. Switch to Local Storage in Advanced settings.');
              } else {
                refreshMarkers();
                refreshBookmarkList();
                showBookmarkOverlay(`Imported ${importData.bookmarks.length} bookmarks`);
              }
            });
          });
        } catch (error) {
          showBookmarkOverlay('Error reading bookmark file');
          console.error(error);
        }
      };
      reader.readAsText(file);
    };
    
    input.click();
  }

  // Show help panel
  function showHelpPanel() {
    const existingHelp = document.getElementById('yt-help-overlay');
    if (existingHelp) {
      existingHelp.remove();
      return;
    }

    const videoContainer = document.querySelector('.html5-video-player');
    if (!videoContainer) return;

    const overlay = document.createElement('div');
    overlay.id = 'yt-help-overlay';
    Object.assign(overlay.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      background: 'rgba(0, 0, 0, 0.8)',
      backdropFilter: 'blur(5px)',
      zIndex: '10001',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    });

    const helpBox = document.createElement('div');
    Object.assign(helpBox.style, {
      background: 'rgba(18, 18, 18, 0.95)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '12px',
      padding: '24px',
      maxWidth: '480px',
      maxHeight: '85vh',
      overflowY: 'auto',
      color: 'white',
      scrollbarWidth: 'thin',
      scrollbarColor: 'rgba(255, 255, 255, 0.2) transparent'
    });

    helpBox.innerHTML = `
      <h3 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600;">Keyboard Shortcuts</h3>
      <div style="display: grid; gap: 8px; font-size: 14px; line-height: 1.6;">
        <div><kbd style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 3px;">P</kbd> - Add bookmark at current time</div>
        <div><kbd style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 3px;">L</kbd> - Label bookmark at current time</div>
        <div><kbd style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 3px;">Shift + PageUp/Down</kbd> - Navigate bookmarks</div>
        <div><kbd style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 3px;">Shift + R</kbd> - Remove bookmark at current time</div>
        <div><kbd style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 3px;">Shift + C</kbd> - Clear all bookmarks</div>
        <div><kbd style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 3px;">Alt + 1-9</kbd> - Set playback speed (1x-9x)</div>
        <div><kbd style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 3px;">+/-</kbd> - Increase/decrease speed by 0.25x</div>
        <div><kbd style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 3px;">Alt + R</kbd> - Toggle remaining time overlay</div>
      </div>
      <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 13px; color: rgba(255,255,255,0.7); text-align: center;">
        Having problems? <a href="mailto:nibirbbkr@gmail.com" style="color: #3ea6ff; text-decoration: none;">Contact us</a>
      </div>
      <button id="close-help" style="margin-top: 16px; width: 100%; padding: 10px; background: rgba(255,255,255,0.1); border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 14px;">Close</button>
    `;

    overlay.appendChild(helpBox);
    videoContainer.appendChild(overlay);

    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };

    helpBox.querySelector('#close-help').onclick = () => overlay.remove();
  }

  
  // ⏳ Wait for video to load, then add overlay
  function addBookmarkButton() {
    const video = document.querySelector('video');
    if (!video) {
      setTimeout(addBookmarkButton, 1000);
      return;
    }

    // Wait for controls to be available
    const rightControls = document.querySelector('.ytp-right-controls');
    if (!rightControls) {
      setTimeout(addBookmarkButton, 1000);
      return;
    }

    // Don't add if already exists
    if (document.getElementById('yt-bookmark-btn')) return;

    const bookmarkBtn = document.createElement('button');
    bookmarkBtn.id = 'yt-bookmark-btn';
    bookmarkBtn.className = 'ytp-button';
    bookmarkBtn.title = 'Bookmarks (P to add)';
    bookmarkBtn.setAttribute('aria-label', 'Open Bookmarks');
    
    // Bookmark ribbon/tie icon SVG (outline style) - MUCH LARGER
    bookmarkBtn.innerHTML = `
      <svg height="36px" version="1.1" viewBox="0 0 24 24" width="36px">
        <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z" fill="white"></path>
      </svg>
    `;

    Object.assign(bookmarkBtn.style, {
      width: '48px',
      height: '48px',
      padding: '0',
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      opacity: '1',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      top: '-2px'
    });

    bookmarkBtn.addEventListener('mouseover', () => {
      bookmarkBtn.style.opacity = '1';
    });

    bookmarkBtn.addEventListener('mouseout', () => {
      bookmarkBtn.style.opacity = '0.9';
    });

    bookmarkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleBookmarkPanel();
    });

    // Insert before autoplay button (to the left of it)
    try {
      // Look for common right control buttons in order
      const autoplayBtn = rightControls.querySelector('.ytp-button[data-tooltip-target-id="ytp-autonav-toggle-button"]');
      const settingsBtn = rightControls.querySelector('.ytp-settings-button');
      
      if (autoplayBtn && autoplayBtn.parentNode === rightControls) {
        rightControls.insertBefore(bookmarkBtn, autoplayBtn);
      } else if (settingsBtn && settingsBtn.parentNode === rightControls) {
        rightControls.insertBefore(bookmarkBtn, settingsBtn);
      } else {
        // Insert as first child if we can't find reference buttons
        rightControls.insertBefore(bookmarkBtn, rightControls.firstChild);
      }
    } catch (err) {
      console.error('Bookmark button insertion error:', err);
      rightControls.appendChild(bookmarkBtn);
    }
  }

  // Observe URL changes
  const observeUrlChange = () => {
    let oldHref = location.href;
    const body = document.querySelector("body");
    const observer = new MutationObserver(() => {
      if (location.href !== oldHref) {
        oldHref = location.href;
        
        // Clear old bookmarks and markers
        bookmarks = [];
        currentIndex = -1;
        storageKey = null;
        deletedBookmarks = [];
        document.querySelectorAll(".yt-bookmark-marker").forEach(el => el.remove());

        // Clear loop segment on navigation
        loopAPoint = null;
        loopBPoint = null;
        const loopOverlay = document.getElementById('yt-loop-overlay');
        if (loopOverlay) loopOverlay.remove();
        
        // Close bookmark panel if open
        const panel = document.getElementById('yt-bookmark-panel');
        if (panel) panel.remove();
        
        // Reinitialize for new video
        setTimeout(init, 1000);
      }
    });
    observer.observe(body, { childList: true, subtree: true });
  };

  // Statistics tracking functions
  function initializeStatistics(videoId) {
    currentVideoId = videoId;
    videoStartTime = Date.now();
  }

  function trackVideoStart(videoId) {
    chrome.storage.local.get(['statistics'], (data) => {
      const stats = data.statistics || {
        totalVideos: 0,
        totalWatchTime: 0,
        totalTimeSaved: 0,
        speedUsage: {},
        dailyStats: {},
        videoHistory: []
      };

      // Track unique video
      const today = new Date().toDateString();
      if (!stats.dailyStats[today]) {
        stats.dailyStats[today] = {
          videos: 0,
          watchTime: 0,
          timeSaved: 0,
          avgSpeed: 1.0,
          speedSum: 0,
          speedCount: 0
        };
      }

      chrome.storage.local.set({ statistics: stats });
    });
  }

  function trackWatchTime(videoId) {
    if (videoStartTime === 0) return;

    const watchDuration = (Date.now() - videoStartTime) / 1000 / 60; // Convert to minutes
    const currentSpeed = video ? video.playbackRate : 1.0;

    chrome.storage.local.get(['statistics'], (data) => {
      const stats = data.statistics || {
        totalVideos: 0,
        totalWatchTime: 0,
        totalTimeSaved: 0,
        speedUsage: {},
        dailyStats: {}
      };

      // Update total watch time
      stats.totalWatchTime = (stats.totalWatchTime || 0) + watchDuration;

      // Update speed usage
      const speedKey = currentSpeed.toFixed(1);
      stats.speedUsage[speedKey] = (stats.speedUsage[speedKey] || 0) + watchDuration;

      // Calculate time saved
      const timeSaved = watchDuration * (currentSpeed - 1);
      if (timeSaved > 0) {
        stats.totalTimeSaved = (stats.totalTimeSaved || 0) + timeSaved;
      }

      // Update daily stats
      const today = new Date().toDateString();
      if (!stats.dailyStats[today]) {
        stats.dailyStats[today] = {
          videos: 0,
          watchTime: 0,
          timeSaved: 0,
          speedSum: 0,
          speedCount: 0
        };
      }

      stats.dailyStats[today].watchTime += watchDuration;
      if (timeSaved > 0) {
        stats.dailyStats[today].timeSaved += timeSaved;
      }
      stats.dailyStats[today].speedSum += currentSpeed;
      stats.dailyStats[today].speedCount += 1;
      stats.dailyStats[today].avgSpeed = stats.dailyStats[today].speedSum / stats.dailyStats[today].speedCount;

      chrome.storage.local.set({ statistics: stats });
    });

    videoStartTime = Date.now(); // Reset for next tracking period
  }

  function trackVideoComplete(videoId) {
    chrome.storage.local.get(['statistics'], (data) => {
      const stats = data.statistics || {
        totalVideos: 0,
        dailyStats: {}
      };

      stats.totalVideos = (stats.totalVideos || 0) + 1;

      const today = new Date().toDateString();
      if (!stats.dailyStats[today]) {
        stats.dailyStats[today] = { videos: 0 };
      }
      stats.dailyStats[today].videos = (stats.dailyStats[today].videos || 0) + 1;

      chrome.storage.local.set({ statistics: stats });
    });
  }

  function updateStatistics() {
    if (video && !video.paused && videoStartTime > 0) {
      trackWatchTime(currentVideoId);
    }
  }

  // ─── Loop Segment Overlay ─────────────────────────────────────────────────
  /**
   * Renders an amber highlight band on the progress bar between A and B points.
   * Removes any previous overlay first. Safe to call when either point is null.
   */
  function updateLoopOverlay() {
    const existing = document.getElementById('yt-loop-overlay');
    if (existing) existing.remove();
    if (loopAPoint === null || loopBPoint === null || loopAPoint >= loopBPoint) return;
    const v   = document.querySelector('video');
    const bar = document.querySelector('.ytp-progress-bar');
    if (!v || !bar || !v.duration || isNaN(v.duration)) return;
    const overlay = document.createElement('div');
    overlay.id = 'yt-loop-overlay';
    const leftPct  = (loopAPoint              / v.duration) * 100;
    const widthPct = ((loopBPoint - loopAPoint) / v.duration) * 100;
    Object.assign(overlay.style, {
      position: 'absolute',
      left: `${leftPct}%`,
      width: `${widthPct}%`,
      top: '0', bottom: '0',
      background: 'rgba(255, 160, 0, 0.55)',
      borderRadius: '2px',
      pointerEvents: 'none',
      zIndex: '50',
    });
    bar.appendChild(overlay);
  }

  // ─── Watched Progress Tag ──────────────────────────────────────────────────
  /**
   * Persists the current playback percentage (2–97 %) to local storage.
   * Called every 5 s during active playback so thumbnails on browse pages
   * can display a red progress bar showing how far the user got.
   */
  function saveWatchedProgress() {
    const v = document.querySelector('video');
    if (!v || v.paused || !v.duration || isNaN(v.duration)) return;
    const videoId = new URLSearchParams(window.location.search).get('v');
    if (!videoId) return;
    const pct = Math.round((v.currentTime / v.duration) * 100);
    // Skip near-start and near-end to avoid false "partial" tags
    if (pct < 2 || pct > 97) return;
    chrome.storage.local.set({ [`yt_progress_${videoId}`]: pct });
  }

  /**
   * Scans all YouTube thumbnails on the current page and injects a slim red
   * progress bar at the bottom of each one whose video has a saved percentage.
   * Only processes un-tagged thumbnails (data-ytep attribute acts as guard).
   * Feature is gated by the watchedProgress sync setting.
   */
  function injectThumbnailProgress() {
    document.querySelectorAll('ytd-thumbnail:not([data-ytep])').forEach(thumb => {
      thumb.setAttribute('data-ytep', '1');
      const link = thumb.querySelector('a[href]');
      if (!link) return;
      const href = link.getAttribute('href') || '';
      const match = href.match(/[?&]v=([^&]+)/);
      if (!match) return;
      const videoId = match[1];
      chrome.storage.local.get([`yt_progress_${videoId}`], (res) => {
        const pct = res[`yt_progress_${videoId}`];
        if (!pct || pct < 2 || pct > 97) return;
        const imgWrap = thumb.querySelector('#thumbnail');
        if (!imgWrap || imgWrap.querySelector('.yt-watched-bar')) return;
        // Ensure the container is positioned so the bar can be placed absolutely
        if (getComputedStyle(imgWrap).position === 'static') {
          imgWrap.style.position = 'relative';
        }
        const bar = document.createElement('div');
        bar.className = 'yt-watched-bar';
        Object.assign(bar.style, {
          position: 'absolute',
          bottom: '3px',
          left: '4px',
          right: '4px',
          height: '3px',
          background: 'rgba(0,0,0,0.45)',
          borderRadius: '2px',
          pointerEvents: 'none',
          zIndex: '300',
          overflow: 'hidden',
        });
        const fill = document.createElement('div');
        Object.assign(fill.style, {
          height: '100%',
          width: `${pct}%`,
          background: '#ff0000',
          borderRadius: '2px',
        });
        bar.appendChild(fill);
        imgWrap.appendChild(bar);
      });
    });
  }

  init();
  observeUrlChange();
  initTimeLimitHud();

  // ─── Watched Progress thumbnail MutationObserver ───────────────────────────
  // Fires on every DOM mutation of the YT feed and injects progress bars on any
  // newly rendered thumbnails. Throttled to max once every 1.5 s for performance.
  // Self-disconnects when the extension is reloaded to prevent context errors.
  let _thumbThrottle = null;
  const _thumbObserver = new MutationObserver(() => {
    if (!isCtxValid()) { _thumbObserver.disconnect(); return; }
    if (_thumbThrottle) return;
    _thumbThrottle = setTimeout(() => {
      _thumbThrottle = null;
      if (!isCtxValid()) return;
      chrome.storage.sync.get(['watchedProgress'], ({ watchedProgress }) => {
        if (watchedProgress) injectThumbnailProgress();
      });
    }, 1500);
  });
  _thumbObserver.observe(document.body, { childList: true, subtree: true });

  // Initial injection on page load
  if (isCtxValid()) {
    chrome.storage.sync.get(['watchedProgress'], ({ watchedProgress }) => {
      if (watchedProgress) injectThumbnailProgress();
    });
  }
})();
