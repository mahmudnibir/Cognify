/**
 * edge-hud.js
 *
 * Draggable, edge-docked screen-time HUD widget.
 * Injected before content.js (YouTube) and social-download.js (FB / IG).
 * Both scripts share one instance via window.__ytExtEdgeHud.
 *
 * Collapsed — a rounded tab peeking TAB_W px from the screen edge.
 *             Shows a glowing colour dot + vertical mini-time ("4m").
 * Expanded  — hover slides out the full card:
 *               • Platform badge + SCREEN TIME header
 *               • Circular arc gauge (% used, colour-coded green→amber→red)
 *               • "Xm used · Ym left" text + progress bar
 *               • Focus Controls toggles (platform-aware)
 *               • Drag-hint footer
 * Drag      — drag the tab vertically to reposition along the edge.
 *             Crossing 35% / 65% of viewport width flips the side.
 * Persistent — edge + offset saved in chrome.storage.local.
 */
(function () {
  'use strict';

  if (window.__ytExtEdgeHud) return;

  // ── Constants ──────────────────────────────────────────────────────────────
  const STORAGE_KEY  = 'ytExtEdgeHudPos';
  const PANEL_W      = 252;                   // card width in px
  const TAB_W        = 30;                    // always-visible tab width
  const CIRCUMF      = 2 * Math.PI * 26;      // arc circumference (r = 26)
  const TRANSITION   = 'transform 0.26s cubic-bezier(.4,0,.2,1)';

  // ── State ──────────────────────────────────────────────────────────────────
  let _pos      = { edge: 'right', offset: 200 };
  let _posReady = false;
  let _label    = 'YT';
  let _expanded = false;
  let _dragging = false;
  let _queue    = null;

  // DOM refs
  let _hud, _tab, _panel;
  let _dotEl, _miniEl, _usedEl, _remainEl, _barEl, _arcEl, _pctEl, _ctrlsEl;

  // ── Platform focus-control definitions ────────────────────────────────────
  const CONTROLS = {
    YT: [
      { key: 'focusMode',       label: 'Focus Mode'       },
      { key: 'hideShorts',      label: 'Hide Shorts'      },
      { key: 'hideComments',    label: 'Hide Comments'    },
      { key: 'hideSuggestions', label: 'Hide Suggestions' },
    ],
    FB: [
      { key: 'hideFbMessenger', label: 'Hide Messenger'   },
    ],
    IG: [],
  };

  // ── Utilities ──────────────────────────────────────────────────────────────

  /** Formats seconds → "Xh Ym" / "Zm" / "Ns" */
  function _fmt(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    if (m) return `${m}m`;
    return `${ss}s`;
  }

  /** Compact vertical tab label ("4m", "1h", "<1") */
  function _mini(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h) return `${h}h`;
    if (m) return `${m}m`;
    return '<1';
  }

  /** Progress colour: green → amber → red */
  function _col(pct) {
    return pct >= 90 ? '#e04030' : pct >= 70 ? '#f0a030' : '#4ad66d';
  }

  // ── Position helpers ───────────────────────────────────────────────────────

  function _tfCollapsed() {
    return _pos.edge === 'right'
      ? `translateX(${PANEL_W}px)`
      : `translateX(-${PANEL_W}px)`;
  }

  function _tfExpanded() {
    // Float 10 px away from the edge so the rounded face is clearly visible.
    return _pos.edge === 'right' ? 'translateX(-10px)' : 'translateX(10px)';
  }

  /**
   * Applies edge + vertical offset to the wrapper and updates border-radius
   * and box-shadow on tab + panel to match the active edge.
   */
  function _applyPos() {
    if (!_hud || !_tab) return;
    const panelH = _panel ? (_panel.offsetHeight || 280) : 280;
    const top    = Math.max(60, Math.min(window.innerHeight - panelH - 20, _pos.offset));
    _hud.style.top = top + 'px';

    if (_pos.edge === 'right') {
      _hud.style.right         = '0';
      _hud.style.left          = 'auto';
      // row-reverse: panel is left, tab is right → only tab peeks at right edge
      _hud.style.flexDirection = 'row-reverse';
      _tab.style.borderRadius  = '16px 5px 5px 16px';
      _tab.style.borderRight   = '1px solid rgba(255,255,255,0.06)';
      _tab.style.borderLeft    = '1px solid rgba(255,255,255,0.13)';
      _tab.style.borderTop     = '1px solid rgba(255,255,255,0.10)';
      _tab.style.borderBottom  = '1px solid rgba(255,255,255,0.10)';
      if (_panel) {
        _panel.style.borderRadius = '16px 0 0 16px';
        _panel.style.borderRight  = 'none';
        _panel.style.boxShadow    = '-6px 0 36px rgba(0,0,0,0.75)';
      }
    } else {
      _hud.style.left          = '0';
      _hud.style.right         = 'auto';
      // row: tab is left, panel is right → only tab peeks at left edge
      _hud.style.flexDirection = 'row';
      _tab.style.borderRadius  = '5px 16px 16px 5px';
      _tab.style.borderLeft    = '1px solid rgba(255,255,255,0.06)';
      _tab.style.borderRight   = '1px solid rgba(255,255,255,0.13)';
      _tab.style.borderTop     = '1px solid rgba(255,255,255,0.10)';
      _tab.style.borderBottom  = '1px solid rgba(255,255,255,0.10)';
      if (_panel) {
        _panel.style.borderRadius = '0 16px 16px 0';
        _panel.style.borderLeft   = 'none';
        _panel.style.boxShadow    = '6px 0 36px rgba(0,0,0,0.75)';
      }
    }
  }

  // ── Expand / Collapse ──────────────────────────────────────────────────────

  function _collapse() {
    if (_dragging || !_hud) return;
    _expanded = false;
    _hud.style.transition = TRANSITION;
    _hud.style.transform  = _tfCollapsed();
    if (_panel) _panel.style.pointerEvents = 'none';
  }

  function _expand() {
    if (_dragging || !_hud) return;
    _expanded = true;
    _hud.style.transition = TRANSITION;
    _hud.style.transform  = _tfExpanded();
    if (_panel) _panel.style.pointerEvents = 'auto';
    _refreshControls();
  }

  // ── Focus controls ─────────────────────────────────────────────────────────

  /**
   * Reads current settings from storage and re-renders the toggle rows.
   * Called on every hover-expand so values are always fresh.
   */
  function _refreshControls() {
    if (!_ctrlsEl) return;
    const defs    = CONTROLS[_label] || [];
    const section = document.getElementById('yt-ext-hud-ctrl-section');

    if (!defs.length) {
      if (section) section.style.display = 'none';
      return;
    }
    if (section) section.style.display = '';

    chrome.storage.sync.get(defs.map(d => d.key), (data) => {
      void chrome.runtime.lastError;
      _ctrlsEl.innerHTML = '';

      defs.forEach(({ key, label }) => {
        const on = !!data[key];

        const row = document.createElement('label');
        row.style.cssText = `
          display:flex;align-items:center;justify-content:space-between;
          padding:5px 0;cursor:pointer;gap:8px;
        `;
        row.innerHTML = `
          <span style="font-size:12px;color:rgba(255,255,255,0.58);flex:1;
            font-family:Inter,-apple-system,sans-serif;">${label}</span>
          <div style="
            position:relative;width:34px;height:19px;border-radius:10px;
            flex-shrink:0;
            background:${on ? '#4ad66d' : 'rgba(255,255,255,0.11)'};
            transition:background .18s;
          ">
            <div style="
              position:absolute;top:2.5px;
              left:${on ? '17px' : '2.5px'};
              width:14px;height:14px;border-radius:50%;background:#fff;
              transition:left .18s;box-shadow:0 1px 4px rgba(0,0,0,0.5);
            "></div>
          </div>
        `;

        row.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = !on;
          // Persist — the regular storage.onChanged listeners in content scripts pick this up
          chrome.storage.sync.set({ [key]: next }, () => { void chrome.runtime.lastError; });
          // Also dispatch a window event so content.js / social-download.js apply instantly
          window.dispatchEvent(new CustomEvent('yt-ext-edge-toggle', { detail: { key, value: next } }));
          _refreshControls(); // optimistic UI
        });

        _ctrlsEl.appendChild(row);
      });
    });
  }

  // ── Drag ───────────────────────────────────────────────────────────────────

  function _setupDrag() {
    let startY = 0, startOffset = 0;

    _tab.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      _dragging    = true;
      startY       = e.clientY;
      startOffset  = _pos.offset;
      _tab.style.cursor     = 'grabbing';
      _hud.style.transition = 'none';
      _hud.style.transform  = _tfExpanded();
      if (_panel) _panel.style.pointerEvents = 'none';
      _tab.setPointerCapture(e.pointerId);
    });

    _tab.addEventListener('pointermove', (e) => {
      if (!_dragging) return;
      const panelH = _panel ? (_panel.offsetHeight || 280) : 280;
      _pos.offset  = Math.max(60, Math.min(window.innerHeight - panelH - 20, startOffset + e.clientY - startY));
      _hud.style.top = _pos.offset + 'px';

      // Flip side when dragged past 35% / 65% of viewport width
      const cx = e.clientX;
      if (_pos.edge === 'right' && cx < window.innerWidth * 0.35) {
        _pos.edge = 'left';
        _applyPos();
        _hud.style.transform = _tfExpanded();
      } else if (_pos.edge === 'left' && cx > window.innerWidth * 0.65) {
        _pos.edge = 'right';
        _applyPos();
        _hud.style.transform = _tfExpanded();
      }
    });

    const _endDrag = () => {
      if (!_dragging) return;
      _dragging         = false;
      _tab.style.cursor = 'grab';
      _hud.style.transition = TRANSITION;
      if (_expanded) {
        _hud.style.transform = _tfExpanded();
        if (_panel) _panel.style.pointerEvents = 'auto';
      } else {
        _collapse();
      }
      _savePos();
    };

    _tab.addEventListener('pointerup',     _endDrag);
    _tab.addEventListener('pointercancel', _endDrag);
  }

  // ── Build DOM ──────────────────────────────────────────────────────────────

  function _create() {
    if (_hud) return;

    // ── Outer wrapper (position:fixed, pointer-events:none so page isn't blocked)
    _hud = document.createElement('div');
    _hud.id = 'yt-ext-edge-hud';
    Object.assign(_hud.style, {
      position:      'fixed',
      zIndex:        '2147483646',
      display:       'flex',
      alignItems:    'stretch',
      pointerEvents: 'none',
      top:           _pos.offset + 'px',
    });

    // ── Tab — always-visible handle ──────────────────────────────────────────
    _tab = document.createElement('div');
    _tab.id = 'yt-ext-edge-tab';
    Object.assign(_tab.style, {
      width:          TAB_W + 'px',
      minHeight:      '108px',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      gap:            '6px',
      background:     'rgba(10,10,10,0.93)',
      backdropFilter: 'blur(16px)',
      cursor:         'grab',
      pointerEvents:  'auto',
      flexShrink:     '0',
      padding:        '12px 0',
      userSelect:     'none',
    });

    _tab.innerHTML = `
      <div id="yt-ext-hud-dot" style="
        width:8px;height:8px;border-radius:50%;flex-shrink:0;
        transition:background .4s ease,box-shadow .4s ease;
      "></div>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
        stroke="rgba(255,255,255,0.28)" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      <span id="yt-ext-hud-mini" style="
        writing-mode:vertical-rl;text-orientation:mixed;
        font-size:10px;font-weight:700;letter-spacing:.05em;
        color:rgba(255,255,255,0.38);
        font-family:Inter,-apple-system,sans-serif;
      "></span>
      <div title="Drag to reposition"
        style="display:flex;flex-direction:column;gap:2.5px;margin-top:5px;opacity:.18;">
        <div style="width:10px;height:1.5px;background:#fff;border-radius:1px;"></div>
        <div style="width:10px;height:1.5px;background:#fff;border-radius:1px;"></div>
        <div style="width:10px;height:1.5px;background:#fff;border-radius:1px;"></div>
      </div>
    `;

    // ── Panel — hover card ───────────────────────────────────────────────────
    _panel = document.createElement('div');
    _panel.id = 'yt-ext-edge-panel';
    Object.assign(_panel.style, {
      width:          PANEL_W + 'px',
      background:     'rgba(8,8,8,0.95)',
      border:         '1px solid rgba(255,255,255,0.08)',
      backdropFilter: 'blur(20px)',
      pointerEvents:  'none',
      fontFamily:     'Inter,-apple-system,Helvetica Neue,Arial,sans-serif',
      color:          '#f0f0f0',
      overflow:       'hidden',
    });

    _panel.innerHTML = `
      <!-- Header -->
      <div style="
        padding:13px 16px 0;
        display:flex;align-items:center;justify-content:space-between;
      ">
        <span style="
          font-size:9px;font-weight:700;letter-spacing:.10em;
          text-transform:uppercase;color:rgba(255,255,255,0.28);
        ">Screen Time</span>
        <span id="yt-ext-hud-badge" style="
          font-size:9px;font-weight:800;letter-spacing:.08em;
          text-transform:uppercase;
          background:rgba(255,255,255,0.07);
          border:1px solid rgba(255,255,255,0.10);
          border-radius:4px;padding:2px 6px;
          color:rgba(255,255,255,0.35);
        ">${_label}</span>
      </div>

      <!-- Arc gauge + stats row -->
      <div style="
        display:flex;align-items:center;gap:14px;
        padding:10px 16px 8px;
      ">
        <!-- Circular arc -->
        <div style="position:relative;width:68px;height:68px;flex-shrink:0;">
          <svg width="68" height="68" viewBox="0 0 68 68">
            <circle cx="34" cy="34" r="26"
              fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="5"/>
            <circle id="yt-ext-hud-arc"
              cx="34" cy="34" r="26"
              fill="none" stroke-width="5" stroke-linecap="round"
              transform="rotate(-90 34 34)"
              style="transition:stroke-dasharray .7s ease,stroke .6s ease;
                     stroke-dasharray:0 ${CIRCUMF};"/>
          </svg>
          <div style="
            position:absolute;inset:0;
            display:flex;align-items:center;justify-content:center;
          ">
            <span id="yt-ext-hud-pct" style="
              font-size:12px;font-weight:700;letter-spacing:-.02em;
            "></span>
          </div>
        </div>
        <!-- Text stats -->
        <div style="flex:1;min-width:0;">
          <div id="yt-ext-hud-used" style="
            font-size:17px;font-weight:700;line-height:1.1;letter-spacing:-.02em;
          "></div>
          <div id="yt-ext-hud-remain" style="
            font-size:12px;color:rgba(255,255,255,0.40);margin-top:4px;
          "></div>
        </div>
      </div>

      <!-- Progress bar -->
      <div style="padding:0 16px 12px;">
        <div style="height:3px;background:rgba(255,255,255,0.06);border-radius:99px;overflow:hidden;">
          <div id="yt-ext-hud-bar" style="
            height:100%;border-radius:99px;width:0%;
            transition:width .7s ease,background .6s ease;
          "></div>
        </div>
      </div>

      <!-- Focus controls -->
      <div id="yt-ext-hud-ctrl-section" style="
        border-top:1px solid rgba(255,255,255,0.06);
        padding:10px 16px 14px;
      ">
        <div style="
          font-size:9px;font-weight:700;letter-spacing:.10em;
          text-transform:uppercase;color:rgba(255,255,255,0.22);
          margin-bottom:8px;
        ">Focus Controls</div>
        <div id="yt-ext-hud-controls"></div>
      </div>

      <!-- Drag hint footer -->
      <div style="
        border-top:1px solid rgba(255,255,255,0.04);
        padding:6px 16px 8px;
        display:flex;align-items:center;gap:5px;
      ">
        <div style="display:flex;flex-direction:column;gap:2px;opacity:.18;flex-shrink:0;">
          <div style="width:10px;height:1.5px;background:#fff;border-radius:1px;"></div>
          <div style="width:10px;height:1.5px;background:#fff;border-radius:1px;"></div>
          <div style="width:10px;height:1.5px;background:#fff;border-radius:1px;"></div>
        </div>
        <span style="font-size:9px;color:rgba(255,255,255,0.16);letter-spacing:.04em;">
          Drag tab to reposition
        </span>
      </div>
    `;

    _hud.appendChild(_tab);
    _hud.appendChild(_panel);
    document.body.appendChild(_hud);

    // Cache element refs
    _dotEl    = _hud.querySelector('#yt-ext-hud-dot');
    _miniEl   = _hud.querySelector('#yt-ext-hud-mini');
    _usedEl   = _hud.querySelector('#yt-ext-hud-used');
    _remainEl = _hud.querySelector('#yt-ext-hud-remain');
    _barEl    = _hud.querySelector('#yt-ext-hud-bar');
    _arcEl    = _hud.querySelector('#yt-ext-hud-arc');
    _pctEl    = _hud.querySelector('#yt-ext-hud-pct');
    _ctrlsEl  = _hud.querySelector('#yt-ext-hud-controls');

    // Hide focus section if this platform has no controls (IG)
    const ctrlSection = _hud.querySelector('#yt-ext-hud-ctrl-section');
    if (!(CONTROLS[_label] || []).length && ctrlSection) {
      ctrlSection.style.display = 'none';
    }

    _applyPos();
    _hud.style.transform = _tfCollapsed();

    _hud.addEventListener('mouseenter', _expand);
    _hud.addEventListener('mouseleave', _collapse);

    _setupDrag();
  }

  // ── Update display data ────────────────────────────────────────────────────

  function _doRender(usedSec, limitMin) {
    const limitSec  = limitMin * 60;
    const remainSec = Math.max(0, limitSec - usedSec);
    const pct       = Math.min(100, Math.round((usedSec / limitSec) * 100));
    const col       = _col(pct);

    if (!_hud) _create();

    // Tab
    _dotEl.style.background = col;
    _dotEl.style.boxShadow  = `0 0 8px ${col}99`;
    _miniEl.textContent     = _mini(usedSec);

    // Panel
    _usedEl.textContent   = _fmt(usedSec) + ' used';
    _remainEl.textContent = remainSec > 0 ? _fmt(remainSec) + ' left' : 'Limit reached';
    _pctEl.textContent    = pct + '%';
    _pctEl.style.color    = col;

    _barEl.style.width      = pct + '%';
    _barEl.style.background = col;

    // Arc: stroke-dasharray drives the visible arc length.
    // The circle has transform="rotate(-90 34 34)" so the arc starts at 12 o'clock.
    _arcEl.style.strokeDasharray = `${(pct / 100) * CIRCUMF} ${CIRCUMF}`;
    _arcEl.setAttribute('stroke', col);
  }

  // ── Storage ────────────────────────────────────────────────────────────────

  function _loadPos(cb) {
    try {
      chrome.storage.local.get([STORAGE_KEY], (d) => {
        void chrome.runtime.lastError;
        if (d?.[STORAGE_KEY]) _pos = d[STORAGE_KEY];
        _posReady = true;
        cb();
      });
    } catch (_) {
      _posReady = true;
      cb();
    }
  }

  function _savePos() {
    try { chrome.storage.local.set({ [STORAGE_KEY]: _pos }); } catch (_) {}
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  window.__ytExtEdgeHud = {
    /**
     * Create (first call) or update the HUD.
     * @param {number} usedSec  - seconds elapsed this session
     * @param {number} limitMin - session limit in minutes
     * @param {string} label    - 'YT' | 'FB' | 'IG'
     */
    render(usedSec, limitMin, label) {
      if (label && label !== _label) {
        _label = label;
        const badge = document.getElementById('yt-ext-hud-badge');
        if (badge) badge.textContent = label;
        const sec = document.getElementById('yt-ext-hud-ctrl-section');
        if (sec) sec.style.display = (CONTROLS[label] || []).length ? '' : 'none';
        if (_expanded) _refreshControls();
      }
      const _go = () => _doRender(usedSec, limitMin);
      if (!_posReady) {
        _queue = _go;
        _loadPos(() => { if (_queue) { _queue(); _queue = null; } });
      } else {
        _go();
      }
    },

    /** Remove the HUD (limit disabled or hard-block overlay shown). */
    remove() {
      _hud?.remove();
      _hud = null;
    },
  };
})();
