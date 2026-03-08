document.addEventListener('DOMContentLoaded', () => {

  // ── ? Help modal ───────────────────────────────────────────────────────────────────────
  // The ? button in the header opens a scrollable panel listing every setting
  // description grouped by its section heading.
  const expandToggle = document.getElementById('expandToggle');
  expandToggle.addEventListener('click', () => {
    // Build grouped list from all hidden .setting-desc elements
    const sections = [];
    document.querySelectorAll('section').forEach(sec => {
      const heading = sec.querySelector('h2');
      if (!heading) return;
      const items = [];
      sec.querySelectorAll('.setting-content').forEach(content => {
        const title = content.querySelector('.setting-title');
        const desc  = content.querySelector('.setting-desc');
        if (title && desc && desc.textContent.trim()) {
          items.push({ title: title.textContent.trim(), desc: desc.textContent.trim() });
        }
      });
      if (items.length) sections.push({ heading: heading.textContent.trim(), items });
    });

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-height:80vh;display:flex;flex-direction:column;">
        <div class="modal-header">
          <div class="modal-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
          </div>
          <div class="modal-title">Feature Guide</div>
        </div>
        <div class="modal-body" id="helpGuideBody" style="overflow-y:auto;flex:1;">
          ${sections.map(s => `
            <div style="margin-bottom:14px;">
              <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:rgba(255,255,255,0.35);margin-bottom:6px;">${s.heading}</div>
              ${s.items.map(it => `
                <div style="display:flex;gap:8px;margin-bottom:5px;align-items:baseline;">
                  <span style="color:rgba(255,255,255,0.85);font-size:11px;font-weight:500;white-space:nowrap;">${it.title}</span>
                  <span style="color:rgba(255,255,255,0.4);font-size:10px;flex:1;">— ${it.desc}</span>
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
        <div class="modal-actions">
          <button class="modal-btn modal-btn-neutral" id="helpClose">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#helpClose').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  });
  // ─────────────────────────────────────────────────────────────────────────

  // Keyboard navigation
  // Clicking anywhere on a .setting-item-full row toggles its checkbox,
  // unless the click already landed on the toggle-label/input (natural toggle).
  document.querySelectorAll('.setting-item-full').forEach(card => {
    card.addEventListener('click', e => {
      // Let the label/input handle itself naturally to avoid double-fire
      if (e.target.closest('.toggle-label') || e.target.closest('.toggle-input')) return;
      const input = card.querySelector('.toggle-input');
      if (input) input.click();
    });
  });
  // ---------------------------------------------------------------------------

    // --- Productivity Graph ---
    // Custom dropdown proxy for prodRange — mirrors .value and addEventListener('change')
    // so all downstream code (updateProdGraph) works without modification.
    const prodRange = (() => {
      const container = document.getElementById('prodRangeSelect');
      const trigger   = document.getElementById('prodRangeTrigger');
      const label     = document.getElementById('prodRangeLabel');
      const optEls    = document.querySelectorAll('#prodRangeOptions .vm-option');
      let _val = '7d';
      const _handlers = [];

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        container.classList.toggle('open');
      });
      document.addEventListener('click', () => container.classList.remove('open'));

      optEls.forEach(opt => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          proxy.value = opt.dataset.value;
          container.classList.remove('open');
          _handlers.forEach(fn => fn());
        });
      });

      const proxy = {
        get value() { return _val; },
        set value(v) {
          _val = v;
          const matched = container.querySelector(`[data-value="${v}"]`);
          label.textContent = matched ? matched.textContent : v;
          optEls.forEach(o => o.classList.toggle('vm-active', o.dataset.value === v));
        },
        addEventListener(type, fn) {
          if (type === 'change') _handlers.push(fn);
        },
      };
      return proxy;
    })();
    const prodStatsGraph = document.getElementById('prodStatsGraph');
    let prodStatsData = {};

    // Range-selector proxies for Instagram and Facebook graphs (same pattern as prodRange)
    const igRange = (() => {
      const container = document.getElementById('igRangeSelect');
      const trigger   = document.getElementById('igRangeTrigger');
      const label     = document.getElementById('igRangeLabel');
      const optEls    = document.querySelectorAll('#igRangeOptions .vm-option');
      let _val = '7d';
      const _handlers = [];
      trigger.addEventListener('click', (e) => { e.stopPropagation(); container.classList.toggle('open'); });
      document.addEventListener('click', () => container.classList.remove('open'));
      optEls.forEach(opt => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          proxy.value = opt.dataset.value;
          container.classList.remove('open');
          _handlers.forEach(fn => fn());
        });
      });
      const proxy = {
        get value() { return _val; },
        set value(v) {
          _val = v;
          const matched = container.querySelector(`[data-value="${v}"]`);
          label.textContent = matched ? matched.textContent : v;
          optEls.forEach(o => o.classList.toggle('vm-active', o.dataset.value === v));
        },
        addEventListener(type, fn) { if (type === 'change') _handlers.push(fn); },
      };
      return proxy;
    })();

    const fbRange = (() => {
      const container = document.getElementById('fbRangeSelect');
      const trigger   = document.getElementById('fbRangeTrigger');
      const label     = document.getElementById('fbRangeLabel');
      const optEls    = document.querySelectorAll('#fbRangeOptions .vm-option');
      let _val = '7d';
      const _handlers = [];
      trigger.addEventListener('click', (e) => { e.stopPropagation(); container.classList.toggle('open'); });
      document.addEventListener('click', () => container.classList.remove('open'));
      optEls.forEach(opt => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          proxy.value = opt.dataset.value;
          container.classList.remove('open');
          _handlers.forEach(fn => fn());
        });
      });
      const proxy = {
        get value() { return _val; },
        set value(v) {
          _val = v;
          const matched = container.querySelector(`[data-value="${v}"]`);
          label.textContent = matched ? matched.textContent : v;
          optEls.forEach(o => o.classList.toggle('vm-active', o.dataset.value === v));
        },
        addEventListener(type, fn) { if (type === 'change') _handlers.push(fn); },
      };
      return proxy;
    })();

    let igStatsData = {};
    let fbStatsData = {};

    // Helper: get range dates
    function getRangeDates(range) {
      const now = new Date();
      let start, end;
      end = new Date(now);
      if (range === '1d') {
        start = new Date(now);
        start.setHours(start.getHours() - 23, 0, 0, 0);
      } else if (range === '3d') {
        start = new Date(now);
        start.setDate(start.getDate() - 2);
        start.setHours(0, 0, 0, 0);
      } else if (range === '7d') {
        start = new Date(now);
        start.setDate(start.getDate() - 6);
        start.setHours(0, 0, 0, 0);
      } else if (range === '1m') {
        start = new Date(now);
        start.setMonth(start.getMonth() - 1);
        start.setHours(0, 0, 0, 0);
      } else {
        start = new Date(now);
      }
      return { start, end };
    }

    /**
     * Generic smooth area-line graph renderer shared by all platforms.
     * Uses bezier curves for smooth lines, gradient fill, and theme-aware colours.
     * @param {Object}           stats    - daily stats keyed by Date.toDateString()
     * @param {string}           range    - '1d' | '3d' | '7d' | '1m'
     * @param {HTMLCanvasElement} canvas
     * @param {string}           valueKey - property in each day entry to plot
     */
    function drawGraph(stats, range, canvas, valueKey) {
      if (!canvas) return;
      const dpr  = window.devicePixelRatio || 1;
      const cssW = canvas.offsetWidth || 332;
      const cssH = 120;
      canvas.width  = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, cssW, cssH);

      // Build data series
      let labels = [], values = [];
      const { start, end } = getRangeDates(range);
      if (range === '1d') {
        for (let h = 0; h < 24; h++) {
          const d = new Date(start);
          d.setHours(start.getHours() + h);
          const key = d.toDateString();
          let val = 0;
          if (stats[key]?.hourly) val = stats[key].hourly[d.getHours()] || 0;
          labels.push(h + ':00');
          values.push(val);
        }
      } else {
        let d = new Date(start);
        d.setHours(0, 0, 0, 0);
        while (d <= end) {
          const key = d.toDateString();
          labels.push(new Date(d));
          values.push((stats[key]?.[valueKey]) || 0);
          d.setDate(d.getDate() + 1);
        }
      }

      const n = values.length;
      if (n < 2) return;

      const pad    = { top: 12, right: 10, bottom: 26, left: 34 };
      const gW     = cssW - pad.left - pad.right;
      const gH     = cssH - pad.top  - pad.bottom;
      const maxVal = Math.max(1, ...values);
      const pts    = values.map((v, i) => ({
        x: pad.left + (i / (n - 1)) * gW,
        y: pad.top  + gH - (v / maxVal) * gH,
      }));

      // Smooth gradient area fill
      const fill = ctx.createLinearGradient(0, pad.top, 0, pad.top + gH);
      fill.addColorStop(0, 'rgba(255,0,0,0.22)');
      fill.addColorStop(1, 'rgba(255,0,0,0.02)');
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pad.top + gH);
      ctx.lineTo(pts[0].x, pts[0].y);
      for (let i = 1; i < n; i++) {
        const dx = (pts[i].x - pts[i - 1].x) * 0.4;
        ctx.bezierCurveTo(pts[i-1].x + dx, pts[i-1].y, pts[i].x - dx, pts[i].y, pts[i].x, pts[i].y);
      }
      ctx.lineTo(pts[n - 1].x, pad.top + gH);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();

      // Smooth line stroke
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < n; i++) {
        const dx = (pts[i].x - pts[i - 1].x) * 0.4;
        ctx.bezierCurveTo(pts[i-1].x + dx, pts[i-1].y, pts[i].x - dx, pts[i].y, pts[i].x, pts[i].y);
      }
      ctx.strokeStyle = 'rgba(255,0,0,0.85)';
      ctx.lineWidth   = 2;
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      ctx.stroke();

      // Subtle baseline
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth   = 1;
      ctx.moveTo(pad.left, pad.top + gH + 1);
      ctx.lineTo(pad.left + gW, pad.top + gH + 1);
      ctx.stroke();

      // Y-axis labels + faint horizontal gridlines (top, mid, 0)
      const labelColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--text-secondary').trim() || 'rgba(255,255,255,0.45)';
      const yTicks = [
        { val: maxVal,                    y: pad.top },
        { val: Math.round(maxVal / 2),    y: pad.top + gH / 2 },
        { val: 0,                         y: pad.top + gH },
      ];
      ctx.font      = '9px Inter, -apple-system, sans-serif';
      ctx.fillStyle = labelColor;
      ctx.textAlign = 'right';
      yTicks.forEach(({ val, y }) => {
        // Gridline
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth   = 1;
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + gW, y);
        ctx.stroke();
        // Label
        ctx.fillText(String(val), pad.left - 4, y + 3.5);
      });

      // Last-point accent dot
      const last = pts[n - 1];
      ctx.beginPath();
      ctx.arc(last.x, last.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,0,0,0.9)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(last.x, last.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();

      // X-axis labels
      ctx.font      = '10px Inter, -apple-system, sans-serif';
      ctx.fillStyle = labelColor;
      ctx.textAlign = 'center';
      const step = Math.max(1, Math.ceil(n / 6));
      labels.forEach((lbl, i) => {
        if (i % step !== 0 && i !== n - 1) return;
        const x = pad.left + (i / (n - 1)) * gW;
        let text = '';
        if      (range === '1d') text = lbl;
        else if (range === '1m') text = lbl.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        else                     text = lbl.toLocaleDateString('en-US', { weekday: 'short' });
        ctx.fillText(text, x, cssH - 4);
      });
    }

    /** Thin wrapper — keeps existing callers working. */
    function drawProdGraph(stats, range) {
      drawGraph(stats, range, prodStatsGraph, 'videos');
    }

    function updateProdGraph() {
      if (!prodStatsData || !prodRange.value) return;
      drawProdGraph(prodStatsData, prodRange.value);
    }

    if (prodRange) {
      prodRange.addEventListener('change', updateProdGraph);
    }

    // Update helpers for social platform graphs
    function updateIgGraph() {
      drawGraph(igStatsData, igRange.value, document.getElementById('igStatsGraph'), 'videosWatched');
    }
    function updateFbGraph() {
      drawGraph(fbStatsData, fbRange.value, document.getElementById('fbStatsGraph'), 'videosWatched');
    }
    igRange.addEventListener('change', updateIgGraph);
    fbRange.addEventListener('change', updateFbGraph);

  const speedInput = document.getElementById('speed');
  const speedDisplay = document.getElementById('speedDisplay');
  const skipAdsCheckbox = document.getElementById('skipAds');
  const hideCommentsCheckbox = document.getElementById('hideComments');
  const hideShortsCheckbox = document.getElementById('hideShorts');
  const hideDescriptionCheckbox = document.getElementById('hideDescription');
  const hideSuggestionsCheckbox = document.getElementById('hideSuggestions');
  const hideFbMessengerCheckbox = document.getElementById('hideFbMessenger');
  const rememberSpeedCheckbox = document.getElementById('rememberSpeed');
  const cloudSyncCheckbox = document.getElementById('cloudSync');
  const cloudSyncDesc = document.getElementById('cloudSyncDesc');
  const loopVideoCheckbox = document.getElementById('loopVideo');
  const universalSpeedCheckbox = document.getElementById('universalSpeed');
  const voiceModeDesc = document.getElementById('voiceModeDesc');
  const defaultVolumeEnabledCheckbox = document.getElementById('defaultVolumeEnabled');
  const defaultVolumeInput = document.getElementById('defaultVolume');
  const defaultVolumeDisplay = document.getElementById('defaultVolumeDisplay');
  const autoTheaterCheckbox = document.getElementById('autoTheater');
  const autoFullscreenCheckbox = document.getElementById('autoFullscreen');
  const autoSubtitlesCheckbox = document.getElementById('autoSubtitles');
  const focusModeCheckbox = document.getElementById('focusMode');
  const resetStatsBtn = document.getElementById('resetStatsBtn');
  const exportBookmarksBtn = document.getElementById('exportBookmarksBtn');
  const importBookmarksBtn = document.getElementById('importBookmarksBtn');
  const importBookmarksFile = document.getElementById('importBookmarksFile');
  const sponsorBlockCheckbox      = document.getElementById('sponsorBlock');
  const sleepTimerEnabledCheckbox = document.getElementById('sleepTimerEnabled');
  const sleepTimerRow             = document.getElementById('sleepTimerRow');
  const sleepTimerMinutesInput    = document.getElementById('sleepTimerMinutes');
  const setSleepTimerBtn          = document.getElementById('setSleepTimerBtn');
  const watchedProgressCheckbox   = document.getElementById('watchedProgress');
  const setLoopABtn               = document.getElementById('setLoopA');
  const setLoopBBtn               = document.getElementById('setLoopB');
  const clearLoopBtnEl            = document.getElementById('clearLoopBtn');
  const loopDisplayEl             = document.getElementById('loopDisplay');

  /**
   * Builds a select-like proxy object around the custom div dropdown.
   * Exposes .value (get/set) and .addEventListener('change', fn)
   * so the rest of popup.js needs zero further changes.
   */
  const voiceModeSelect = (() => {
    const container = document.getElementById('vmSelect');
    const trigger   = document.getElementById('vmTrigger');
    const label     = document.getElementById('vmLabel');
    const optEls    = document.querySelectorAll('#vmOptions .vm-option');
    let _val = 'normal';
    const _handlers = [];

    // Toggle dropdown open/close
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      container.classList.toggle('open');
    });
    // Close on outside click
    document.addEventListener('click', () => container.classList.remove('open'));

    // Option selection
    optEls.forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        proxy.value = opt.dataset.value;
        container.classList.remove('open');
        _handlers.forEach(fn => fn());
      });
    });

    const proxy = {
      get value() { return _val; },
      set value(v) {
        _val = v;
        const matched = container.querySelector(`[data-value="${v}"]`);
        label.textContent = matched ? matched.textContent : v;
        optEls.forEach(o => o.classList.toggle('vm-active', o.dataset.value === v));
      },
      addEventListener(type, fn) {
        if (type === 'change') _handlers.push(fn);
      },
    };
    return proxy;
  })();

  /** Maps each voice mode to a short description shown under the label. */
  const VOICE_DESCS = {
    normal:    'Natural pitch at any playback speed',
    chipmunk:  'Pitch follows speed — cartoon high, demon low',
    pikachu:   'Bright electric squeak — cut bass, boost formant & air',
    naruto:    'Energetic grit with vocal presence boost',
    doraemon:  'Nasal toy-robot resonance with warm flutter',
    bassboost: 'Warm bass boost on the audio output',
    robot:     'Robotic ring-modulation effect',
    echo:      'Echoing reverb with feedback delay',
  };

  function updateVoiceModeDesc(mode) {
    if (voiceModeDesc) voiceModeDesc.textContent = VOICE_DESCS[mode] || '';
  }

  // Default values
  const defaults = { 
    speed: '1.0', 
    skipAds: false,
    hideComments: false,
    hideShorts: false,
    hideDescription: false,
    hideSuggestions: false,
    rememberSpeed: false,
    cloudSync: true,
    loopVideo: false,
    voiceMode: 'normal',
    defaultVolume: 80,
    defaultVolumeEnabled: false,
    autoTheater: false,
    autoFullscreen: false,
    autoSubtitles: false,
    focusMode: false,
    sponsorBlock: false,
    sleepTimerEnabled: false,
    sleepTimerMinutes: 30,
    hideFbMessenger: false,
    watchedProgress: false,
  };

  // Update speed display with enhanced formatting + progress-bar fill
  const updateSpeedDisplay = (value) => {
    const speed = parseFloat(value);
    speedDisplay.textContent = `${speed.toFixed(1)}×`;
    // Map value within [0.25, 20] to fill percentage
    const pct = ((speed - 0.25) / (20 - 0.25)) * 100;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim() || '#ff0000';
    speedInput.style.background = `linear-gradient(to right, ${accent} ${pct}%, var(--border-color) ${pct}%)`;
  };

  /** Updates the left-fill gradient on the volume slider to match its current value. */
  const updateVolumeFill = (value) => {
    const pct = Math.min(100, Math.max(0, parseFloat(value)));
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim() || '#ff0000';
    defaultVolumeInput.style.background = `linear-gradient(to right, ${accent} ${pct}%, var(--border-color) ${pct}%)`;
  };

  // Load stored settings with animation
  chrome.storage.sync.get(defaults, (data) => {
    speedInput.value = data.speed;
    skipAdsCheckbox.checked = data.skipAds;
    hideCommentsCheckbox.checked = data.hideComments || false;
    hideShortsCheckbox.checked = data.hideShorts || false;
    hideDescriptionCheckbox.checked = data.hideDescription || false;
    hideSuggestionsCheckbox.checked = data.hideSuggestions || false;
    rememberSpeedCheckbox.checked = data.rememberSpeed || false;
    cloudSyncCheckbox.checked = data.cloudSync !== false;
    loopVideoCheckbox.checked = data.loopVideo || false;
    // Voice mode (migrate legacy pitchCorrection boolean to voiceMode)
    const mode = data.voiceMode || (data.pitchCorrection === false ? 'chipmunk' : 'normal');
    voiceModeSelect.value = mode;
    updateVoiceModeDesc(mode);
    updateCloudSyncDesc(data.cloudSync !== false);

    // Load new automation / playback settings
    defaultVolumeEnabledCheckbox.checked = data.defaultVolumeEnabled || false;
    defaultVolumeInput.value = data.defaultVolume !== undefined ? data.defaultVolume : 80;
    defaultVolumeDisplay.textContent = `${defaultVolumeInput.value}%`;
    updateVolumeFill(defaultVolumeInput.value);
    autoTheaterCheckbox.checked = data.autoTheater || false;
    autoFullscreenCheckbox.checked = data.autoFullscreen || false;
    autoSubtitlesCheckbox.checked = data.autoSubtitles || false;
    focusModeCheckbox.checked = data.focusMode || false;
    if (sponsorBlockCheckbox) sponsorBlockCheckbox.checked = data.sponsorBlock || false;
    if (sleepTimerEnabledCheckbox) sleepTimerEnabledCheckbox.checked = data.sleepTimerEnabled || false;
    if (hideFbMessengerCheckbox) hideFbMessengerCheckbox.checked = data.hideFbMessenger || false;
    if (sleepTimerMinutesInput) sleepTimerMinutesInput.value = data.sleepTimerMinutes || 30;
    if (sleepTimerRow) sleepTimerRow.style.display = data.sleepTimerEnabled ? 'flex' : 'none';

    // Watched progress tags
    if (watchedProgressCheckbox) watchedProgressCheckbox.checked = data.watchedProgress || false;

    // Load universalSpeed from local storage (used by video-hover.js)
    chrome.storage.local.get(['universalSpeed'], (localData) => {
      universalSpeedCheckbox.checked = !!localData.universalSpeed;
    });
    updateSpeedDisplay(data.speed);

    // Sync active speed tick highlight
    syncSpeedTicks(parseFloat(data.speed));
  });

  // Auto-save function
  const autoSave = () => {
    let speed = parseFloat(speedInput.value);
    if (isNaN(speed) || speed < 0.1) speed = parseFloat(defaults.speed);

    const skipAds = !!skipAdsCheckbox.checked;
    const hideComments = !!hideCommentsCheckbox.checked;
    const hideShorts = !!hideShortsCheckbox.checked;
    const hideDescription = !!hideDescriptionCheckbox.checked;
    const hideSuggestions = !!hideSuggestionsCheckbox.checked;
    const rememberSpeed = !!rememberSpeedCheckbox.checked;
    const cloudSync = !!cloudSyncCheckbox.checked;
    const loopVideo = !!loopVideoCheckbox.checked;
    const universalSpeed = !!universalSpeedCheckbox.checked;
    const voiceMode = voiceModeSelect.value || 'normal';
    // Derive legacy pitchCorrection for content.js backward compat
    const pitchCorrection = (voiceMode !== 'chipmunk');
    const defaultVolume = parseInt(defaultVolumeInput.value, 10);
    const defaultVolumeEnabled = !!defaultVolumeEnabledCheckbox.checked;
    const autoTheater = !!autoTheaterCheckbox.checked;
    const autoFullscreen = !!autoFullscreenCheckbox.checked;
    const autoSubtitles = !!autoSubtitlesCheckbox.checked;
    const focusMode = !!focusModeCheckbox.checked;
    const sponsorBlock = !!(sponsorBlockCheckbox && sponsorBlockCheckbox.checked);
    const hideFbMessenger = !!(hideFbMessengerCheckbox && hideFbMessengerCheckbox.checked);
    const watchedProgress = !!(watchedProgressCheckbox && watchedProgressCheckbox.checked);

    // Save universalSpeed to local storage so video-hover.js can read it
    chrome.storage.local.set({ universalSpeed });

    chrome.storage.sync.set({
      speed: speed.toString(),
      skipAds,
      hideComments,
      hideShorts,
      hideDescription,
      hideSuggestions,
      rememberSpeed,
      cloudSync,
      loopVideo,
      pitchCorrection,
      voiceMode,
      defaultVolume,
      defaultVolumeEnabled,
      autoTheater,
      autoFullscreen,
      autoSubtitles,
      focusMode,
      sponsorBlock,
      hideFbMessenger,
      watchedProgress,
    }, () => {
      // Notify content script to apply changes and update speed immediately
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0] && tabs[0].url && tabs[0].url.includes('youtube.com')) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'updateSettings',
            speed: speed,
            settings: { hideComments, hideShorts, hideDescription, hideSuggestions, loopVideo, pitchCorrection, voiceMode, defaultVolume, defaultVolumeEnabled, autoTheater, autoFullscreen, autoSubtitles, focusMode }
          }, (response) => {
            if (chrome.runtime.lastError) {
              // content script not yet injected or tab navigated away — safe to ignore
            }
          });
        }
      });
    });
  };

  // Real-time speed display update with auto-save
  speedInput.addEventListener('input', (e) => {
    updateSpeedDisplay(e.target.value);
    speedDisplay.style.transform = 'scale(1)';
    // Sync speed tick highlights
    syncSpeedTicks(parseFloat(e.target.value));
    autoSave();
  });

  // Auto-save on checkbox changes
  skipAdsCheckbox.addEventListener('change', autoSave);
  rememberSpeedCheckbox.addEventListener('change', autoSave);
  hideCommentsCheckbox.addEventListener('change', autoSave);
  hideShortsCheckbox.addEventListener('change', autoSave);
  hideSuggestionsCheckbox.addEventListener('change', autoSave);
  hideDescriptionCheckbox.addEventListener('change', autoSave);
  loopVideoCheckbox.addEventListener('change', autoSave);
  universalSpeedCheckbox.addEventListener('change', autoSave);
  voiceModeSelect.addEventListener('change', () => {
    updateVoiceModeDesc(voiceModeSelect.value);
    autoSave();
  });

  // New feature event listeners
  defaultVolumeEnabledCheckbox.addEventListener('change', autoSave);
  defaultVolumeInput.addEventListener('input', () => {
    defaultVolumeDisplay.textContent = `${defaultVolumeInput.value}%`;
    updateVolumeFill(defaultVolumeInput.value);
    autoSave();
  });
  autoTheaterCheckbox.addEventListener('change', autoSave);
  autoFullscreenCheckbox.addEventListener('change', autoSave);
  autoSubtitlesCheckbox.addEventListener('change', autoSave);
  focusModeCheckbox.addEventListener('change', autoSave);
  if (sponsorBlockCheckbox) sponsorBlockCheckbox.addEventListener('change', autoSave);
  if (hideFbMessengerCheckbox) hideFbMessengerCheckbox.addEventListener('change', autoSave);
  if (watchedProgressCheckbox) watchedProgressCheckbox.addEventListener('change', autoSave);
  if (sleepTimerEnabledCheckbox) sleepTimerEnabledCheckbox.addEventListener('change', () => {
    if (sleepTimerRow) sleepTimerRow.style.display = sleepTimerEnabledCheckbox.checked ? 'flex' : 'none';
    autoSave();
  });
  if (setSleepTimerBtn) setSleepTimerBtn.addEventListener('click', () => {
    const mins = parseInt(sleepTimerMinutesInput.value, 10) || 30;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'setSleepTimer', minutes: mins }).catch(() => {});
    });
    chrome.storage.sync.set({ sleepTimerMinutes: mins, sleepTimerEnabled: true });
    if (sleepTimerEnabledCheckbox) sleepTimerEnabledCheckbox.checked = true;
  });

  // ── A→B Loop Segment buttons ─────────────────────────────────────────────

  /**
   * Formats seconds as M:SS or H:MM:SS for the loop display label.
   * @param {number|null} s
   */
  function fmtLoopTime(s) {
    if (s === null || s === undefined || isNaN(s)) return '—';
    const h   = Math.floor(s / 3600);
    const m   = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  /** Updates the A→B display line in the popup. */
  function renderLoopDisplay(a, b) {
    if (loopDisplayEl) {
      loopDisplayEl.textContent = `${fmtLoopTime(a)} → ${fmtLoopTime(b)}`;
    }
  }

  /** Sends a loop-action message to the active YouTube tab. */
  function sendLoopAction(action, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0] || !tabs[0].url || !tabs[0].url.includes('youtube.com')) return;
      chrome.tabs.sendMessage(tabs[0].id, { action }, (response) => {
        if (chrome.runtime.lastError || !response) return;
        if (callback) callback(response);
      });
    });
  }

  if (setLoopABtn) {
    setLoopABtn.addEventListener('click', () => {
      sendLoopAction('setLoopA', (res) => {
        if (res.success) {
          // Fetch updated state to refresh display
          sendLoopAction('getLoopState', (state) => renderLoopDisplay(state.loopAPoint, state.loopBPoint));
        }
      });
    });
  }

  if (setLoopBBtn) {
    setLoopBBtn.addEventListener('click', () => {
      sendLoopAction('setLoopB', (res) => {
        if (res.success) {
          sendLoopAction('getLoopState', (state) => renderLoopDisplay(state.loopAPoint, state.loopBPoint));
        }
      });
    });
  }

  if (clearLoopBtnEl) {
    clearLoopBtnEl.addEventListener('click', () => {
      sendLoopAction('clearLoop', () => renderLoopDisplay(null, null));
    });
  }

  // Load current loop state when popup opens (only on YouTube tabs)
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url && tabs[0].url.includes('youtube.com')) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'getLoopState' }, (response) => {
        if (chrome.runtime.lastError || !response) return;
        renderLoopDisplay(response.loopAPoint, response.loopBPoint);
      });
    }
  });

  // Speed tick labels (replaces preset buttons)
  function syncSpeedTicks(speed) {
    document.querySelectorAll('.speed-tick').forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.speed) === speed);
    });
  }
  document.querySelectorAll('.speed-tick').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = parseFloat(btn.dataset.speed);
      speedInput.value = val;
      updateSpeedDisplay(val);
      syncSpeedTicks(val);
      autoSave();
    });
  });

  // Export Bookmarks button (Advanced tab)
  if (exportBookmarksBtn) {
    exportBookmarksBtn.addEventListener('click', () => exportBookmarks());
  }

  // Import Bookmarks button
  if (importBookmarksBtn && importBookmarksFile) {
    importBookmarksBtn.addEventListener('click', () => importBookmarksFile.click());
    importBookmarksFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          // Accept both full export format and raw bookmark objects
          const bookmarkData = data.bookmarks || {};
          const keys = Object.keys(bookmarkData).filter(k => k.startsWith('yt_bm_'));
          if (keys.length === 0) {
            showModal({ title: 'Import', message: 'No bookmarks found in this file.', buttons: [{ text: 'OK', type: 'primary' }] });
            return;
          }
          chrome.storage.sync.get(['cloudSync'], (result) => {
            const useCloudSync = result.cloudSync !== false;
            const storage = useCloudSync ? chrome.storage.sync : chrome.storage.local;
            const toStore = {};
            keys.forEach(k => { toStore[k] = bookmarkData[k]; });
            storage.set(toStore, () => {
              if (chrome.runtime.lastError) {
                showModal({ title: 'Import Failed', message: `Import failed: ${chrome.runtime.lastError.message}`, buttons: [{ text: 'OK', type: 'primary' }] });
              } else {
                showModal({ title: 'Import Successful', message: `✅ Imported ${keys.length} video(s) of bookmarks successfully!`, buttons: [{ text: 'OK', type: 'primary' }] });
              }
            });
          });
        } catch {
          showModal({ title: 'Invalid File', message: 'Invalid backup file. Please select a valid YT Enhanced backup JSON.', buttons: [{ text: 'OK', type: 'primary' }] });
        }
        // Reset input so the same file can be re-selected
        importBookmarksFile.value = '';
      };
      reader.readAsText(file);
    });
  }

  // Reset Statistics button (data management section) — secure 2-step flow
  if (resetStatsBtn) {
    resetStatsBtn.addEventListener('click', async () => {
      const confirmed = await showModal({
        title: 'Reset YouTube Statistics',
        message: 'This will permanently clear all your YouTube watch time statistics. Bookmarks and settings will not be affected.',
        warning: '⚠️ This action cannot be undone.',
        buttons: [
          { text: 'Cancel', type: 'secondary' },
          { text: 'Continue', type: 'primary' }
        ]
      });
      if (!confirmed) return;

      const typeConfirmed = await showConfirmationInput({
        title: 'Type to Confirm',
        message: 'To confirm, please type <strong>RESET YOUTUBE STATS</strong> in the box below:',
        confirmText: 'RESET YOUTUBE STATS',
        placeholder: 'Type here...'
      });
      if (!typeConfirmed) return;

      chrome.storage.local.remove(['statistics'], () => {
        loadStatistics();
      });
    });
  }
  
  // Cloud sync toggle with migration
  cloudSyncCheckbox.addEventListener('change', async () => {
    const isCloudSync = cloudSyncCheckbox.checked;
    updateCloudSyncDesc(isCloudSync);
    
    // Migrate bookmarks between storage types
    await migrateBookmarks(isCloudSync);
    
    autoSave();
  });
  
  // Update cloud sync description
  function updateCloudSyncDesc(isCloudSync) {
    if (isCloudSync) {
      cloudSyncDesc.textContent = 'Sync bookmarks across devices (~50-100 limit)';
    } else {
      cloudSyncDesc.textContent = 'Local storage only (unlimited bookmarks)';
    }
  }
  
  // Migrate bookmarks between storage types
  async function migrateBookmarks(toCloudSync) {
    const sourceStorage = toCloudSync ? chrome.storage.local : chrome.storage.sync;
    const targetStorage = toCloudSync ? chrome.storage.sync : chrome.storage.local;
    
    return new Promise((resolve) => {
      sourceStorage.get(null, (sourceData) => {
        const bookmarkData = {};
        let hasBookmarks = false;
        
        // Find all bookmark keys
        for (const key in sourceData) {
          if (key.startsWith('yt_bm_')) {
            bookmarkData[key] = sourceData[key];
            hasBookmarks = true;
          }
        }
        
        if (!hasBookmarks) {
          resolve();
          return;
        }
        
        // Copy to target storage
        targetStorage.set(bookmarkData, () => {
          if (chrome.runtime.lastError) {
            showModal({ title: 'Migration Failed', message: `⚠️ Migration failed: ${chrome.runtime.lastError.message}. You may have too many bookmarks for cloud sync. Try removing some first.`, buttons: [{ text: 'OK', type: 'primary' }] });
            cloudSyncCheckbox.checked = !toCloudSync;
            updateCloudSyncDesc(!toCloudSync);
          } else {
            // Remove from source storage
            sourceStorage.remove(Object.keys(bookmarkData), () => {
              showModal({ title: 'Migration Successful', message: `✅ Successfully migrated ${Object.keys(bookmarkData).length} video(s) of bookmarks to ${toCloudSync ? 'cloud sync' : 'local storage'}!`, buttons: [{ text: 'OK', type: 'primary' }] });
            });
          }
          resolve();
        });
      });
    });
  }

  // Default shortcuts
  const defaultShortcuts = {
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

  // Load and apply custom shortcuts
  let customShortcuts = {};
  chrome.storage.sync.get(['shortcuts'], (data) => {
    customShortcuts = data.shortcuts || {};
    updateShortcutDisplays();
  });

  function updateShortcutDisplays() {
    document.querySelectorAll('.shortcut-input').forEach(input => {
      const action = input.getAttribute('data-action');
      input.textContent = customShortcuts[action] || defaultShortcuts[action];
    });
  }

  // Shortcut recording
  let recordingAction = null;
  let pressedModifiers = { ctrl: false, alt: false, shift: false, tab: false };
  let liveShortcut = '';

  function getModifierString(e) {
    let mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.key === 'Tab' || pressedModifiers.tab) mods.push('Tab');
    return mods.join('+');
  }

  function isModifierKey(key) {
    return (
      key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Tab' ||
      key === 'Meta'
    );
  }

  document.querySelectorAll('.shortcut-input').forEach(input => {
    input.addEventListener('click', (e) => {
      if (recordingAction) return;
      recordingAction = e.target.getAttribute('data-action');
      e.target.classList.add('recording');
      e.target.textContent = 'Press keys...';
      pressedModifiers = { ctrl: false, alt: false, shift: false, tab: false };
      liveShortcut = '';
    });
  });

  document.addEventListener('keydown', (e) => {
    if (!recordingAction) return;
    e.preventDefault();
    e.stopPropagation();

    // Cancel recording on ESC
    if (e.key === 'Escape') {
      const input = document.querySelector(`.shortcut-input[data-action="${recordingAction}"]`);
      input.classList.remove('recording');
      input.textContent = customShortcuts[recordingAction] || defaultShortcuts[recordingAction];
      recordingAction = null;
      return;
    }

    // Track modifier keys
    if (e.key === 'Control') pressedModifiers.ctrl = true;
    if (e.key === 'Alt') pressedModifiers.alt = true;
    if (e.key === 'Shift') pressedModifiers.shift = true;
    if (e.key === 'Tab') pressedModifiers.tab = true;

    // If only modifier keys are pressed, update display and wait
    if (isModifierKey(e.key)) {
      const input = document.querySelector(`.shortcut-input[data-action="${recordingAction}"]`);
      input.textContent = getModifierString(e) || 'Press keys...';
      return;
    }

    // Only allow one non-modifier key
    let shortcut = getModifierString(e);
    if (shortcut) shortcut += '+';
    if (e.key.length === 1) {
      shortcut += e.key.toUpperCase();
    } else {
      shortcut += e.key;
    }

    // Save the shortcut
    customShortcuts[recordingAction] = shortcut;
    chrome.storage.sync.set({ shortcuts: customShortcuts }, () => {
      const input = document.querySelector(`.shortcut-input[data-action="${recordingAction}"]`);
      input.classList.remove('recording');
      input.textContent = shortcut;
      recordingAction = null;
      pressedModifiers = { ctrl: false, alt: false, shift: false, tab: false };
      liveShortcut = '';
      // Notify content script about shortcut change
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0] && tabs[0].url && tabs[0].url.includes('youtube.com')) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'updateShortcuts',
            shortcuts: customShortcuts
          });
        }
      });
    });
  });

  document.addEventListener('keyup', (e) => {
    if (!recordingAction) return;
    // Reset modifier state on keyup
    if (e.key === 'Control') pressedModifiers.ctrl = false;
    if (e.key === 'Alt') pressedModifiers.alt = false;
    if (e.key === 'Shift') pressedModifiers.shift = false;
    if (e.key === 'Tab') pressedModifiers.tab = false;
  });

  // Reset shortcuts
  document.querySelectorAll('.shortcut-reset').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const action = e.target.getAttribute('data-action');
      delete customShortcuts[action];
      
      chrome.storage.sync.set({ shortcuts: customShortcuts }, () => {
        updateShortcutDisplays();
        
        // Notify content script
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
          if (tabs[0] && tabs[0].url && tabs[0].url.includes('youtube.com')) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'updateShortcuts',
              shortcuts: customShortcuts
            });
          }
        });
      });
    });
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      window.close();
    }
  });

  // Tab switching functionality
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.getAttribute('data-tab');
      
      // Remove active class from all tabs and contents
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));
      
      // Add active class to clicked tab and corresponding content
      tab.classList.add('active');
      document.getElementById(targetTab).classList.add('active');
      // Redraw graphs when Stats tab becomes visible (canvas has zero width while hidden)
      if (targetTab === 'stats') {
        requestAnimationFrame(() => {
          updateProdGraph();
          updateIgGraph();
          updateFbGraph();
        });
      }
    });
  });

  // Clear All Data functionality
  const clearDataBtn = document.getElementById('clearDataBtn');
  
  clearDataBtn.addEventListener('click', async () => {
    // Step 1: Initial confirmation
    const confirmed = await showModal({
      title: 'Clear All Data',
      message: 'This will permanently delete all your bookmarks, settings, and video-specific speeds. This action cannot be undone.',
      warning: '⚠️ This is a destructive action and cannot be reversed.',
      buttons: [
        { text: 'Cancel', type: 'secondary' },
        { text: 'Continue', type: 'primary' }
      ]
    });

    if (!confirmed) return;

    // Step 2: Type confirmation
    const typeConfirmed = await showConfirmationInput({
      title: 'Type to Confirm',
      message: 'To confirm deletion, please type <strong>DELETE ALL DATA</strong> in the box below:',
      confirmText: 'DELETE ALL DATA',
      placeholder: 'Type here...'
    });

    if (!typeConfirmed) return;

    // Step 3: Offer to export data
    const exportData = await showModal({
      title: 'Export Data First?',
      message: 'Would you like to export your bookmarks before deleting everything? This will download a backup file.',
      buttons: [
        { text: 'Cancel', type: 'cancel' },
        { text: 'Skip & Delete', type: 'skip' },
        { text: 'Export & Delete', type: 'export' }
      ]
    });

    // If user cancelled or clicked outside, stop
    if (!exportData || exportData === 'cancel') return;

    // Export if user chose to
    if (exportData === 'export') {
      await exportBookmarks();
    }

    // Step 4: Final deletion (only reaches here if user chose 'skip' or 'export')
    performClearData();
  });

  // Create modal dialog
  function showModal({ title, message, warning, buttons }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal-header">
            <div class="modal-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
            </div>
            <div class="modal-title">${title}</div>
          </div>
          <div class="modal-body">
            <div class="modal-text">${message}</div>
            ${warning ? `<div class="modal-warning">${warning}</div>` : ''}
          </div>
          <div class="modal-actions">
            ${buttons.map((btn, idx) => `
              <button class="modal-btn modal-btn-${btn.type}" data-index="${idx}">${btn.text}</button>
            `).join('')}
          </div>
        </div>
      `;
      
      document.body.appendChild(overlay);
      
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.remove();
          resolve(false);
        }
        
        const btn = e.target.closest('.modal-btn');
        if (btn) {
          const index = parseInt(btn.dataset.index);
          overlay.remove();
          resolve(buttons[index].type === 'secondary' ? false : buttons[index].type);
        }
      });
    });
  }

  // Create confirmation input modal
  function showConfirmationInput({ title, message, confirmText, placeholder }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal-header">
            <div class="modal-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <div class="modal-title">${title}</div>
          </div>
          <div class="modal-body">
            <div class="modal-text">${message}</div>
            <label class="modal-label">Confirmation Text</label>
            <input type="text" class="modal-input" placeholder="${placeholder}" id="confirmInput">
          </div>
          <div class="modal-actions">
            <button class="modal-btn modal-btn-secondary" id="cancelBtn">Cancel</button>
            <button class="modal-btn modal-btn-primary" id="confirmBtn" disabled>Confirm</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(overlay);
      
      const input = overlay.querySelector('#confirmInput');
      const confirmBtn = overlay.querySelector('#confirmBtn');
      const cancelBtn = overlay.querySelector('#cancelBtn');
      
      input.addEventListener('input', () => {
        if (input.value === confirmText) {
          confirmBtn.disabled = false;
          input.classList.remove('error');
        } else {
          confirmBtn.disabled = true;
        }
      });
      
      confirmBtn.addEventListener('click', () => {
        if (input.value === confirmText) {
          overlay.remove();
          resolve(true);
        } else {
          input.classList.add('error');
          setTimeout(() => input.classList.remove('error'), 400);
        }
      });
      
      cancelBtn.addEventListener('click', () => {
        overlay.remove();
        resolve(false);
      });
      
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.remove();
          resolve(false);
        }
      });
      
      input.focus();
    });
  }

  // Export bookmarks function
  async function exportBookmarks() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['cloudSync'], (result) => {
        const useCloudSync = result.cloudSync !== false;
        const bookmarkStorage = useCloudSync ? chrome.storage.sync : chrome.storage.local;
        
        chrome.storage.sync.get(null, (syncData) => {
          bookmarkStorage.get(null, (bookmarkStorageData) => {
            const bookmarkData = {};
            
            // Filter bookmark data from appropriate storage
            for (const key in bookmarkStorageData) {
              if (key.startsWith('yt_bm_')) {
                bookmarkData[key] = bookmarkStorageData[key];
              }
            }
            
            chrome.storage.local.get(['statistics', 'totalTimeSaved'], (localData) => {
              const exportData = {
                bookmarks: bookmarkData,
                settings: syncData,
                statistics: localData.statistics || {},
                totalTimeSaved: localData.totalTimeSaved || 0,
                storageMode: useCloudSync ? 'cloud' : 'local',
                exportDate: new Date().toISOString(),
                version: '2.1.0'
              };
              
              const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `youtube-enhancer-backup-${Date.now()}.json`;
              a.click();
              URL.revokeObjectURL(url);
              
              setTimeout(() => resolve(), 500);
            });
          });
        });
      });
    });
  }

  // Perform the actual data clearing
  function performClearData() {
    chrome.storage.local.clear(() => {
      chrome.storage.sync.clear(() => {
        // Show success message
        showModal({
          title: 'Data Cleared',
          message: 'All data has been successfully deleted. The extension will now reset to default settings.',
          buttons: [
            { text: 'Close', type: 'primary' }
          ]
        }).then(() => {
          window.location.reload();
        });
      });
    });
  }

  // Statistics Functions
  function formatTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  }

  function formatTimeShort(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    if (hours > 0) {
      return `${hours}h`;
    }
    return `${mins}m`;
  }

  function loadStatistics() {
    chrome.storage.local.get(['statistics'], (data) => {
      const stats = data.statistics || {
        totalVideos: 0,
        totalWatchTime: 0,
        totalTimeSaved: 0,
        speedUsage: {},
        dailyStats: {},
        weeklyStats: []
      };

      // Update overall statistics
      document.getElementById('totalVideos').textContent = stats.totalVideos || 0;
      document.getElementById('totalWatchTime').textContent = formatTime(stats.totalWatchTime || 0);
      document.getElementById('timeSaved').textContent = formatTime(stats.totalTimeSaved || 0);

      // Calculate average speed
      const speedUsage = stats.speedUsage || {};
      const speeds = Object.keys(speedUsage);
      if (speeds.length > 0) {
        let totalSpeedTime = 0;
        let weightedSpeed = 0;
        speeds.forEach(speed => {
          const time = speedUsage[speed];
          totalSpeedTime += time;
          weightedSpeed += parseFloat(speed) * time;
        });
        const avgSpeed = totalSpeedTime > 0 ? (weightedSpeed / totalSpeedTime).toFixed(1) : '1.0';
        document.getElementById('avgSpeed').textContent = `${avgSpeed}×`;
      } else {
        document.getElementById('avgSpeed').textContent = '1.0×';
      }

      // Save dailyStats for graph
      prodStatsData = stats.dailyStats || {};

      // Draw graph for default range (last 7 days)
      setTimeout(updateProdGraph, 100);

      // Update today's statistics
      const today = new Date().toDateString();
      const todayStats = stats.dailyStats[today] || { videos: 0, watchTime: 0, avgSpeed: 1.0 };
      
      document.getElementById('todayDate').textContent = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      document.getElementById('todayVideos').textContent = todayStats.videos || 0;
      document.getElementById('todayTime').textContent = formatTimeShort(todayStats.watchTime || 0);
      document.getElementById('todaySpeed').textContent = `${(todayStats.avgSpeed || 1.0).toFixed(1)}×`;

      // Update weekly statistics
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      
      let weekVideos = 0;
      let weekTime = 0;
      let weekSaved = 0;
      
      Object.keys(stats.dailyStats).forEach(dateStr => {
        const date = new Date(dateStr);
        if (date >= weekAgo) {
          const dayStats = stats.dailyStats[dateStr];
          weekVideos += dayStats.videos || 0;
          weekTime += dayStats.watchTime || 0;
          weekSaved += dayStats.timeSaved || 0;
        }
      });
      
      document.getElementById('weekVideos').textContent = weekVideos;
      document.getElementById('weekTime').textContent = formatTimeShort(weekTime);
      document.getElementById('weekSaved').textContent = formatTimeShort(weekSaved);

      // Week-over-week delta: compare current 7 days vs the prior 7 days
      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
      let prevVideos = 0, prevTime = 0, prevSaved = 0;
      Object.keys(stats.dailyStats).forEach(dateStr => {
        const d = new Date(dateStr);
        if (d >= twoWeeksAgo && d < weekAgo) {
          prevVideos += stats.dailyStats[dateStr].videos    || 0;
          prevTime   += stats.dailyStats[dateStr].watchTime || 0;
          prevSaved  += stats.dailyStats[dateStr].timeSaved || 0;
        }
      });
      /** Renders a percentage-change delta badge into an element. */
      function setYtDelta(id, cur, prev) {
        const el = document.getElementById(id);
        if (!el) return;
        if (prev === 0 && cur === 0) { el.textContent = ''; el.className = 'stat-delta flat'; return; }
        if (prev === 0) { el.textContent = 'new'; el.className = 'stat-delta up'; return; }
        const pct = Math.round(((cur - prev) / prev) * 100);
        el.textContent = pct >= 0 ? `+${pct}%` : `${pct}%`;
        el.className = `stat-delta ${pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'}`;
      }
      setYtDelta('ytDeltaVideos', weekVideos, prevVideos);
      setYtDelta('ytDeltaTime',   weekTime,   prevTime);
      setYtDelta('ytDeltaSaved',  weekSaved,  prevSaved);
    });
  }

  // Refresh stats button
  const refreshStatsBtn = document.getElementById('refreshStats');
  if (refreshStatsBtn) {
    refreshStatsBtn.addEventListener('click', () => {
      loadStatistics();
      
      // Visual feedback
      refreshStatsBtn.style.transform = 'rotate(360deg)';
      setTimeout(() => {
        refreshStatsBtn.style.transform = 'rotate(0deg)';
      }, 500);
    });
  }

  // Platform stats tab switching with PIN gate for Instagram/Facebook
  // Platform stats tab switching
  function switchToPlatform(platform) {
    document.querySelectorAll('.platform-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.platform-panel').forEach(p => p.classList.remove('active'));
    const tab = document.querySelector(`.platform-tab[data-platform="${platform}"]`);
    if (tab) tab.classList.add('active');
    const panel = document.getElementById(`panel-${platform}`);
    if (panel) panel.classList.add('active');
    // Persist the chosen platform so it is restored on next popup open
    chrome.storage.local.set({ lastStatsPlatform: platform });
  }

  document.querySelectorAll('.platform-tab').forEach(tab => {
    tab.addEventListener('click', () => switchToPlatform(tab.dataset.platform));
  });

  // ─── Social stats (Instagram / Facebook) ────────────────────────────────
  function loadSocialStats() {
    const today = new Date().toDateString();
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    function sumWeek(dailyData) {
      let videos = 0, time = 0, chat = 0;
      Object.keys(dailyData).forEach(dateStr => {
        if (new Date(dateStr) >= weekAgo) {
          videos += dailyData[dateStr].videosWatched || 0;
          time   += dailyData[dateStr].activeTime    || 0;
          chat   += dailyData[dateStr].chatTime      || 0;
        }
      });
      return { videos, time, chat };
    }

    function sumAll(dailyData) {
      let videos = 0, time = 0;
      Object.keys(dailyData).forEach(dateStr => {
        videos += dailyData[dateStr].videosWatched || 0;
        time   += dailyData[dateStr].activeTime    || 0;
      });
      return { videos, time };
    }

    /** Sums the 7 days immediately before the current week (days 8-14). */
    function sumPrevWeek(dailyData) {
      const prevWeekStart = new Date();
      prevWeekStart.setDate(prevWeekStart.getDate() - 14);
      let videos = 0, time = 0;
      Object.keys(dailyData).forEach(dateStr => {
        const d = new Date(dateStr);
        if (d >= prevWeekStart && d < weekAgo) {
          videos += dailyData[dateStr].videosWatched || 0;
          time   += dailyData[dateStr].activeTime    || 0;
        }
      });
      return { videos, time };
    }

    /** Renders a percentage-change delta badge into a .stat-delta element. */
    function setSocialDelta(id, cur, prev) {
      const el = document.getElementById(id);
      if (!el) return;
      if (prev === 0 && cur === 0) { el.textContent = ''; el.className = 'stat-delta flat'; return; }
      if (prev === 0) { el.textContent = 'new'; el.className = 'stat-delta up'; return; }
      const pct = Math.round(((cur - prev) / prev) * 100);
      el.textContent = pct >= 0 ? `+${pct}%` : `${pct}%`;
      el.className = `stat-delta ${pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'}`;
    }

    // Instagram
    chrome.storage.local.get(['igStats'], (data) => {
      const daily = (data.igStats || {}).dailyData || {};
      const todayD = daily[today] || {};
      const week   = sumWeek(daily);
      const all    = sumAll(daily);

      const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      set('ig-total-reels',     all.videos);
      set('ig-total-time',      formatTime(all.time / 60));
      set('ig-today-reels',     todayD.videosWatched || 0);
      set('ig-today-time',      formatTimeShort(todayD.activeTime / 60 || 0));
      set('ig-chat-time-today', formatTimeShort(todayD.chatTime / 60 || 0));
      set('ig-day-reels',       todayD.videosWatched || 0);
      set('ig-day-time',        formatTimeShort(todayD.activeTime / 60 || 0));
      set('ig-day-chat',        formatTimeShort(todayD.chatTime / 60 || 0));
      set('ig-week-reels',      week.videos);
      set('ig-week-time',       formatTimeShort(week.time / 60));
      set('ig-week-chat',       formatTimeShort(week.chat / 60));
      set('ig-scroll-count',    todayD.scrollCount || 0);
      const igDate = document.getElementById('ig-today-date');
      if (igDate) igDate.textContent = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      igStatsData = daily;
      setTimeout(() => drawGraph(igStatsData, igRange.value, document.getElementById('igStatsGraph'), 'videosWatched'), 50);
      const igPrev = sumPrevWeek(daily);
      setSocialDelta('igDeltaReels', week.videos, igPrev.videos);
      setSocialDelta('igDeltaTime',  week.time,   igPrev.time);
    });

    // Facebook
    chrome.storage.local.get(['fbStats'], (data) => {
      const daily = (data.fbStats || {}).dailyData || {};
      const todayD = daily[today] || {};
      const week   = sumWeek(daily);
      const all    = sumAll(daily);

      const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      set('fb-total-videos',    all.videos);
      set('fb-total-time',      formatTime(all.time / 60));
      set('fb-today-videos',    todayD.videosWatched || 0);
      set('fb-today-time',      formatTimeShort(todayD.activeTime / 60 || 0));
      set('fb-chat-time-today', formatTimeShort(todayD.chatTime / 60 || 0));
      set('fb-day-videos',      todayD.videosWatched || 0);
      set('fb-day-time',        formatTimeShort(todayD.activeTime / 60 || 0));
      set('fb-day-chat',        formatTimeShort(todayD.chatTime / 60 || 0));
      set('fb-week-videos',     week.videos);
      set('fb-week-time',       formatTimeShort(week.time / 60));
      set('fb-week-chat',       formatTimeShort(week.chat / 60));
      set('fb-scroll-count',    todayD.scrollCount || 0);
      const fbDate = document.getElementById('fb-today-date');
      if (fbDate) fbDate.textContent = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      fbStatsData = daily;
      setTimeout(() => drawGraph(fbStatsData, fbRange.value, document.getElementById('fbStatsGraph'), 'videosWatched'), 50);
      const fbPrev = sumPrevWeek(daily);
      setSocialDelta('fbDeltaVideos', week.videos, fbPrev.videos);
      setSocialDelta('fbDeltaTime',   week.time,   fbPrev.time);
    });
  }

  // Refresh buttons for social panels
  const refreshIgBtn = document.getElementById('refreshIgStats');
  if (refreshIgBtn) {
    refreshIgBtn.addEventListener('click', () => {
      loadSocialStats();
      refreshIgBtn.style.transition = 'transform 0.5s';
      refreshIgBtn.style.transform = 'rotate(360deg)';
      setTimeout(() => { refreshIgBtn.style.transform = 'rotate(0deg)'; }, 500);
    });
  }

  // Reset YouTube stats from the YouTube panel — secure 2-step flow
  const resetYtBtn = document.getElementById('resetYtStats');
  if (resetYtBtn) {
    resetYtBtn.addEventListener('click', async () => {
      const confirmed = await showModal({
        title: 'Reset YouTube Statistics',
        message: 'This will permanently clear all your YouTube watch time statistics. Bookmarks and settings will not be affected.',
        warning: '⚠️ This action cannot be undone.',
        buttons: [
          { text: 'Cancel', type: 'secondary' },
          { text: 'Continue', type: 'primary' }
        ]
      });
      if (!confirmed) return;

      const typeConfirmed = await showConfirmationInput({
        title: 'Type to Confirm',
        message: 'To confirm, please type <strong>RESET YOUTUBE STATS</strong> in the box below:',
        confirmText: 'RESET YOUTUBE STATS',
        placeholder: 'Type here...'
      });
      if (!typeConfirmed) return;

      chrome.storage.local.remove(['statistics'], () => {
        loadStatistics();
      });
    });
  }

  // Reset Instagram stats — secure 2-step flow
  const resetIgBtn = document.getElementById('resetIgStats');
  if (resetIgBtn) {
    resetIgBtn.addEventListener('click', async () => {
      const confirmed = await showModal({
        title: 'Reset Instagram Statistics',
        message: 'This will permanently clear all your Instagram activity statistics. This action cannot be undone.',
        warning: '⚠️ This action cannot be undone.',
        buttons: [
          { text: 'Cancel', type: 'secondary' },
          { text: 'Continue', type: 'primary' }
        ]
      });
      if (!confirmed) return;

      const typeConfirmed = await showConfirmationInput({
        title: 'Type to Confirm',
        message: 'To confirm, please type <strong>RESET INSTAGRAM STATS</strong> in the box below:',
        confirmText: 'RESET INSTAGRAM STATS',
        placeholder: 'Type here...'
      });
      if (!typeConfirmed) return;

      chrome.storage.local.remove(['igStats'], () => {
        loadSocialStats();
      });
    });
  }

  const refreshFbBtn = document.getElementById('refreshFbStats');
  if (refreshFbBtn) {
    refreshFbBtn.addEventListener('click', () => {
      loadSocialStats();
      refreshFbBtn.style.transition = 'transform 0.5s';
      refreshFbBtn.style.transform = 'rotate(360deg)';
      setTimeout(() => { refreshFbBtn.style.transform = 'rotate(0deg)'; }, 500);
    });
  }

  // Reset Facebook stats — secure 2-step flow
  const resetFbBtn = document.getElementById('resetFbStats');
  if (resetFbBtn) {
    resetFbBtn.addEventListener('click', async () => {
      const confirmed = await showModal({
        title: 'Reset Facebook Statistics',
        message: 'This will permanently clear all your Facebook activity statistics. This action cannot be undone.',
        warning: '⚠️ This action cannot be undone.',
        buttons: [
          { text: 'Cancel', type: 'secondary' },
          { text: 'Continue', type: 'primary' }
        ]
      });
      if (!confirmed) return;

      const typeConfirmed = await showConfirmationInput({
        title: 'Type to Confirm',
        message: 'To confirm, please type <strong>RESET FACEBOOK STATS</strong> in the box below:',
        confirmText: 'RESET FACEBOOK STATS',
        placeholder: 'Type here...'
      });
      if (!typeConfirmed) return;

      chrome.storage.local.remove(['fbStats'], () => {
        loadSocialStats();
      });
    });
  }

  // Load statistics on page load
  loadStatistics();
  loadSocialStats();

  // Restore the last-viewed platform tab (persisted across popup opens)
  chrome.storage.local.get(['lastStatsPlatform'], (d) => {
    if (d.lastStatsPlatform) switchToPlatform(d.lastStatsPlatform);
  });

  // ── Kebab menu toggle for platform panel actions ─────────────────────────
  ['ytKebab', 'igKebab', 'fbKebab'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const menu = btn.nextElementSibling; // .kebab-menu sibling
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close any other open kebab menus first
      document.querySelectorAll('.kebab-menu.open').forEach(m => { if (m !== menu) m.classList.remove('open'); });
      menu.classList.toggle('open');
    });
  });

  // Close any open kebab menu when clicking outside
  document.addEventListener('click', () => {
    document.querySelectorAll('.kebab-menu.open').forEach(m => m.classList.remove('open'));
  });

  // Close menu immediately when a kebab action item is clicked
  document.querySelectorAll('.kebab-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.kebab-menu.open').forEach(m => m.classList.remove('open'));
    });
  });
  // ── Export platform stats as CSV ─────────────────────────────────────────
  /**
   * Downloads the stored daily stats for a platform as a CSV file.
   * @param {'yt'|'ig'|'fb'} platform
   */
  function exportStatsCSV(platform) {
    const key = platform === 'yt' ? 'statistics' : `${platform}Stats`;
    chrome.storage.local.get([key], (data) => {
      const stats = data[key];
      if (!stats) {
        showModal({ title: 'No Data', message: 'No statistics found to export.', buttons: [{ text: 'OK', type: 'primary' }] });
        return;
      }
      let rows;
      if (platform === 'yt') {
        rows = [['Date', 'Videos', 'WatchTime(min)', 'AvgSpeed', 'TimeSaved(min)']];
        Object.entries(stats.dailyStats || {}).forEach(([d, v]) => {
          const avg = v.videos > 0 ? (v.totalSpeed / v.videos).toFixed(2) : (v.avgSpeed || 1).toFixed(2);
          rows.push([d, v.videos || 0, (v.watchTime || 0).toFixed(1), avg, (v.timeSaved || 0).toFixed(1)]);
        });
      } else {
        rows = [['Date', 'Videos/Reels', 'ActiveTime(min)', 'ChatTime(min)', 'ScrollCount']];
        Object.entries(stats.dailyData || {}).forEach(([d, v]) => {
          rows.push([d, v.videosWatched || 0, ((v.activeTime || 0) / 60).toFixed(1), ((v.chatTime || 0) / 60).toFixed(1), v.scrollCount || 0]);
        });
      }
      // Wrap each cell in quotes and escape inner quotes for RFC 4180 compliance
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      a.download = `${platform}_stats_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    });
  }

  // ── Full backup export ────────────────────────────────────────────────────
  /** Exports all sync + local storage as a single JSON backup file. */
  async function exportFullBackup() {
    const [syncData, localData] = await Promise.all([
      new Promise(r => chrome.storage.sync.get(null, r)),
      new Promise(r => chrome.storage.local.get(null, r)),
    ]);
    const backup = { version: 1, date: new Date().toISOString(), sync: syncData, local: localData };
    const a = document.createElement('a');
    a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(backup, null, 2));
    a.download = `yt_enhanced_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }

  // ── Full backup import ────────────────────────────────────────────────────
  /** Reads a JSON backup file and restores both sync and local storage. */
  async function importFullBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      if (!backup.sync && !backup.local) {
        await showModal({ title: 'Invalid Backup', message: 'This file is not a valid YT Enhanced backup.', buttons: [{ text: 'OK', type: 'primary' }] });
        e.target.value = '';
        return;
      }
      const confirmed = await showModal({
        title: 'Restore Backup',
        message: `Restore backup dated ${new Date(backup.date).toLocaleDateString()}? This will overwrite all current settings and statistics.`,
        warning: '⚠️ This cannot be undone.',
        buttons: [{ text: 'Cancel', type: 'secondary' }, { text: 'Restore', type: 'primary' }],
      });
      if (!confirmed) { e.target.value = ''; return; }
      if (backup.sync)  await new Promise(r => chrome.storage.sync.set(backup.sync, r));
      if (backup.local) await new Promise(r => chrome.storage.local.set(backup.local, r));
      await showModal({ title: 'Restored!', message: 'Backup restored successfully. Reloading...', buttons: [{ text: 'OK', type: 'primary' }] });
      window.location.reload();
    } catch {
      await showModal({ title: 'Error', message: 'Failed to parse backup file. Please select a valid YT Enhanced backup JSON.', buttons: [{ text: 'OK', type: 'primary' }] });
    }
    e.target.value = '';
  }

  // ── Screen time limits ────────────────────────────────────────────────────
  /** Syncs the card border + input enabled-state when a toggle changes. */
  function applyLimitCardState(prefix) {
    const el    = id => document.getElementById(id);
    const card  = el(`${prefix}LimitCard`);
    const input = el(`${prefix}DailyLimit`);
    const on    = !!el(`${prefix}LimitEnabled`)?.checked;
    if (card)  card.classList.toggle('limit-active', on);
    if (input) input.disabled = !on;
  }

  /** Persists screen time limit values; briefly flashes the button green. */
  function saveScreenTimeLimits() {
    const el = id => document.getElementById(id);
    chrome.storage.sync.set({
      ytLimitEnabled: !!el('ytLimitEnabled')?.checked,
      ytDailyLimit:    parseInt(el('ytDailyLimit')?.value,  10) || 120,
      igLimitEnabled: !!el('igLimitEnabled')?.checked,
      igDailyLimit:    parseInt(el('igDailyLimit')?.value,  10) || 60,
      fbLimitEnabled: !!el('fbLimitEnabled')?.checked,
      fbDailyLimit:    parseInt(el('fbDailyLimit')?.value,  10) || 60,
    }, () => {
      const btn = el('saveLimitsBtn');
      if (!btn) return;
      btn.classList.add('saved');
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Saved!`;
      setTimeout(() => {
        btn.classList.remove('saved');
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Save Limits`;
      }, 1800);
    });
  }

  // Load screen time limit values on popup open
  chrome.storage.sync.get(['ytLimitEnabled', 'ytDailyLimit', 'igLimitEnabled', 'igDailyLimit', 'fbLimitEnabled', 'fbDailyLimit'], (d) => {
    const el = id => document.getElementById(id);
    if (el('ytLimitEnabled')) { el('ytLimitEnabled').checked = !!d.ytLimitEnabled; applyLimitCardState('yt'); }
    if (el('ytDailyLimit'))   el('ytDailyLimit').value    = d.ytDailyLimit  || 120;
    if (el('igLimitEnabled')) { el('igLimitEnabled').checked = !!d.igLimitEnabled; applyLimitCardState('ig'); }
    if (el('igDailyLimit'))   el('igDailyLimit').value    = d.igDailyLimit  || 60;
    if (el('fbLimitEnabled')) { el('fbLimitEnabled').checked = !!d.fbLimitEnabled; applyLimitCardState('fb'); }
    if (el('fbDailyLimit'))   el('fbDailyLimit').value    = d.fbDailyLimit  || 60;
  });

  // Toggle-change: update card border and enable/disable the number input live.
  ['yt', 'ig', 'fb'].forEach(prefix => {
    document.getElementById(`${prefix}LimitEnabled`)
      ?.addEventListener('change', () => applyLimitCardState(prefix));
  });

  // ── Additional feature event listeners ───────────────────────────────────
  document.getElementById('exportYtCsv')?.addEventListener('click', () => exportStatsCSV('yt'));
  document.getElementById('exportIgCsv')?.addEventListener('click', () => exportStatsCSV('ig'));
  document.getElementById('exportFbCsv')?.addEventListener('click', () => exportStatsCSV('fb'));
  document.getElementById('exportBackupBtn')?.addEventListener('click', exportFullBackup);
  document.getElementById('restoreBackupBtn')?.addEventListener('click', () => document.getElementById('restoreBackupFile')?.click());
  document.getElementById('restoreBackupFile')?.addEventListener('change', importFullBackup);
  document.getElementById('saveLimitsBtn')?.addEventListener('click', saveScreenTimeLimits);

  setInterval(() => { loadStatistics(); loadSocialStats(); }, 30000);
});
