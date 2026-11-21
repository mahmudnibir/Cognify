document.addEventListener('DOMContentLoaded', () => {
  // Promote bookmarks to a top-level tab and keep shortcuts under Settings.
  const bookmarkSection = document.getElementById('bookmarkSection');
  const bookmarksTab = document.getElementById('bookmarks');
  const advancedTab = document.getElementById('advanced');
  const shortcutsSection = document.getElementById('shortcuts');
  bookmarksTab.appendChild(bookmarkSection);
  shortcutsSection.classList.remove('tab-content');
  advancedTab.prepend(shortcutsSection);

  const contentControlList = document.getElementById('contentControlList');
  const contentControlReorderToggle = document.getElementById('contentControlReorderToggle');
  const contentControlResetOrder = document.getElementById('contentControlResetOrder');
  const contentControlOrderStatus = document.getElementById('contentControlOrderStatus');
  const contentControlItems = Array.from(contentControlList.children)
    .filter(card => card.matches('.setting-item-full') && card.style.display !== 'none')
    .filter(card => card.querySelector('.toggle-input'));
  contentControlItems.forEach(card => {
    const input = card.querySelector('.toggle-input');
    const title = card.querySelector('.setting-title')?.textContent.trim() || input.id;
    card.classList.add('content-control-item');
    card.dataset.controlId = input.id;
    card.setAttribute('role', 'listitem');

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'content-control-drag-handle';
    handle.hidden = true;
    handle.draggable = false;
    handle.setAttribute('aria-label', `Reorder ${title}`);
    handle.title = 'Drag to move, or press Alt+Arrow Up/Down';
    handle.innerHTML = '<svg width="12" height="18" viewBox="0 0 12 18" aria-hidden="true"><circle cx="3" cy="3" r="1.25" fill="currentColor"/><circle cx="9" cy="3" r="1.25" fill="currentColor"/><circle cx="3" cy="9" r="1.25" fill="currentColor"/><circle cx="9" cy="9" r="1.25" fill="currentColor"/><circle cx="3" cy="15" r="1.25" fill="currentColor"/><circle cx="9" cy="15" r="1.25" fill="currentColor"/></svg>';
    card.prepend(handle);
  });

  const defaultContentControlOrder = contentControlItems.map(card => card.dataset.controlId);
  const getContentControlItems = () => Array.from(contentControlList.children)
    .filter(card => card.classList.contains('content-control-item'));
  const updateContentControlPositions = () => {
    const items = getContentControlItems();
    items.forEach((card, index) => {
      const handle = card.querySelector('.content-control-drag-handle');
      const title = card.querySelector('.setting-title')?.textContent.trim() || card.dataset.controlId;
      handle.setAttribute('aria-label', `Reorder ${title}, position ${index + 1} of ${items.length}`);
    });
  };
  const applyContentControlOrder = order => {
    const itemsById = new Map(getContentControlItems().map(card => [card.dataset.controlId, card]));
    const requestedOrder = Array.isArray(order)
      ? order.filter(id => typeof id === 'string' && itemsById.has(id))
      : [];
    const normalizedOrder = [...new Set([...requestedOrder, ...defaultContentControlOrder])];
    normalizedOrder.forEach(id => {
      const item = itemsById.get(id);
      if (item) contentControlList.appendChild(item);
    });
    updateContentControlPositions();
  };
  let isReorderingContentControls = false;
  let draggedContentControl = null;
  let contentControlOrderChanged = false;
  const setContentControlOrderStatus = message => {
    contentControlOrderStatus.textContent = message;
    contentControlOrderStatus.hidden = !isReorderingContentControls || !message;
  };
  const saveContentControlOrder = () => {
    if (!globalThis.chrome?.storage?.sync) {
      setContentControlOrderStatus('Order can only be saved in the extension.');
      return;
    }
    chrome.storage.sync.set({ contentControlOrder: getContentControlItems().map(card => card.dataset.controlId) }, () => {
      const error = chrome.runtime.lastError;
      setContentControlOrderStatus(error ? `Could not save order: ${error.message}` : 'Order saved.');
    });
  };
  const setContentControlReorderMode = enabled => {
    isReorderingContentControls = enabled;
    contentControlList.classList.toggle('is-reordering', enabled);
    const reorderLabel = contentControlReorderToggle.querySelector('.content-control-reorder-label');
    reorderLabel.hidden = !enabled;
    contentControlReorderToggle.classList.toggle('is-icon-only', !enabled);
    contentControlReorderToggle.setAttribute('aria-pressed', String(enabled));
    contentControlReorderToggle.setAttribute('aria-label', enabled ? 'Finish reordering content controls' : 'Reorder content controls');
    contentControlReorderToggle.title = enabled ? 'Finish reordering' : 'Reorder content controls';
    contentControlResetOrder.hidden = !enabled;
    contentControlItems.forEach(card => {
      const handle = card.querySelector('.content-control-drag-handle');
      handle.hidden = !enabled;
      handle.draggable = enabled;
    });
    if (enabled) {
      setContentControlOrderStatus('Drag a handle, or focus it and press Alt+Arrow Up/Down.');
    } else {
      setContentControlOrderStatus('');
    }
  };

  contentControlReorderToggle.addEventListener('click', () => {
    setContentControlReorderMode(!isReorderingContentControls);
  });
  contentControlResetOrder.addEventListener('click', () => {
    applyContentControlOrder(defaultContentControlOrder);
    saveContentControlOrder();
  });
  contentControlList.addEventListener('keydown', event => {
    const handle = event.target.closest('.content-control-drag-handle');
    if (!isReorderingContentControls || !handle || !event.altKey ||
      (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;

    const items = getContentControlItems();
    const item = handle.closest('.content-control-item');
    const index = items.indexOf(item);
    if (event.key === 'ArrowUp' && index > 0) {
      contentControlList.insertBefore(item, items[index - 1]);
    } else if (event.key === 'ArrowDown' && index >= 0 && index < items.length - 1) {
      contentControlList.insertBefore(items[index + 1], item);
    } else {
      return;
    }

    event.preventDefault();
    updateContentControlPositions();
    saveContentControlOrder();
    handle.focus();
  });
  contentControlList.addEventListener('dragstart', event => {
    const handle = event.target.closest('.content-control-drag-handle');
    const item = handle?.closest('.content-control-item');
    if (!isReorderingContentControls || !item) {
      event.preventDefault();
      return;
    }
    draggedContentControl = item;
    contentControlOrderChanged = false;
    item.classList.add('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.dataset.controlId);
    }
  });
  contentControlList.addEventListener('dragover', event => {
    if (!draggedContentControl) return;
    const target = event.target.closest('.content-control-item');
    if (!target || target === draggedContentControl) return;

    event.preventDefault();
    const bounds = target.getBoundingClientRect();
    const insertAfter = event.clientY > bounds.top + bounds.height / 2;
    const reference = insertAfter ? target.nextElementSibling : target;
    if (reference === draggedContentControl || draggedContentControl.nextElementSibling === reference) return;

    contentControlList.insertBefore(draggedContentControl, reference);
    contentControlOrderChanged = true;
    updateContentControlPositions();
  });
  contentControlList.addEventListener('dragend', () => {
    if (!draggedContentControl) return;
    draggedContentControl.classList.remove('is-dragging');
    draggedContentControl = null;
    if (contentControlOrderChanged) {
      updateContentControlPositions();
      saveContentControlOrder();
    }
  });
  updateContentControlPositions();

  const bookmarkManageToggle = document.getElementById('bookmarkManageToggle');
  const bookmarkManageMenu = document.getElementById('bookmarkManageMenu');
  const closeBookmarkManageMenu = () => {
    bookmarkManageMenu.hidden = true;
    bookmarkManageToggle.setAttribute('aria-expanded', 'false');
  };
  bookmarkManageToggle.addEventListener('click', () => {
    const shouldOpen = bookmarkManageMenu.hidden;
    bookmarkManageMenu.hidden = !shouldOpen;
    bookmarkManageToggle.setAttribute('aria-expanded', String(shouldOpen));
  });
  document.addEventListener('click', (event) => {
    const clickedHint = event.target.closest('.info-hint');
    document.querySelectorAll('.info-hint[open]').forEach((hint) => {
      if (hint !== clickedHint) hint.open = false;
    });
    closeBookmarkTimestampMenus(event.target.closest('.bookmark-time-actions'));
    if (!event.target.closest('.bookmark-library-manage')) closeBookmarkManageMenu();
  }, true);
  bookmarkManageMenu.addEventListener('click', (event) => {
    if (event.target.closest('.bookmark-menu-action')) closeBookmarkManageMenu();
  });
  document.addEventListener('scroll', () => {
    document.querySelectorAll('.info-hint[open]').forEach((hint) => { hint.open = false; });
    closeBookmarkManageMenu();
  }, true);
  document.querySelectorAll('.info-hint-close').forEach((button) => {
    button.addEventListener('click', () => {
      const hint = button.closest('.info-hint');
      hint.open = false;
      hint.querySelector('summary').focus();
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (document.querySelector('.bookmark-manage-menu:not([hidden])')) {
      const manageButton = document.querySelector('.bookmark-manage-button[aria-expanded="true"]');
      closeBookmarkManageMenus();
      manageButton?.focus();
      return;
    }
    if (!bookmarkManageMenu.hidden) {
      closeBookmarkManageMenu();
      bookmarkManageToggle.focus();
      return;
    }
    const openTimestampMenu = document.querySelector('.bookmark-time-menu:not([hidden])');
    if (openTimestampMenu) {
      const trigger = openTimestampMenu.closest('.bookmark-time-actions')?.querySelector('.bookmark-time');
      closeBookmarkTimestampMenus();
      trigger?.focus();
      return;
    }
    const openHint = document.querySelector('.info-hint[open]');
    if (!openHint) return;
    openHint.open = false;
    openHint.querySelector('summary').focus();
  });

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

    const existingGuide = document.getElementById('featureGuidePopover');
    if (existingGuide) existingGuide.remove();

    const guide = document.createElement('div');
    guide.id = 'featureGuidePopover';
    guide.className = 'profile-popover feature-guide-popover';
    guide.setAttribute('role', 'status');
    guide.setAttribute('aria-live', 'polite');
    guide.innerHTML = `
      <span class="profile-popover-question" aria-hidden="true">?</span>
      <div class="profile-popover-copy">
        <div class="profile-popover-title">Feature guide</div>
        <div class="feature-guide-body">
          <table class="feature-guide-table">
            ${sections.map(s => `
              <tbody>
                <tr class="feature-guide-section-row">
                  <th colspan="2">${s.heading}</th>
                </tr>
                ${s.items.map(it => `
                  <tr>
                    <td>${it.title}</td>
                    <td>${it.desc}</td>
                  </tr>
                `).join('')}
              </tbody>
            `).join('')}
          </table>
        </div>
      </div>
      <button class="profile-popover-close" id="featureGuideClose" type="button" aria-label="Close feature guide">×</button>
    `;
    document.body.appendChild(guide);
    expandToggle.setAttribute('aria-expanded', 'true');
    guide.querySelector('#featureGuideClose').addEventListener('click', () => {
      guide.remove();
      expandToggle.setAttribute('aria-expanded', 'false');
      expandToggle.focus();
    });
    document.addEventListener('click', function closeGuide(event) {
      if (event.target.closest('#featureGuidePopover') || event.target.closest('#expandToggle')) return;
      guide.remove();
      expandToggle.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', closeGuide, true);
    }, true);
    document.addEventListener('keydown', function closeGuideOnEscape(event) {
      if (event.key !== 'Escape') return;
      guide.remove();
      expandToggle.setAttribute('aria-expanded', 'false');
      expandToggle.focus();
      document.removeEventListener('keydown', closeGuideOnEscape);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────

  // Keyboard navigation
  // Clicking anywhere on a .setting-item-full row toggles its checkbox,
  // unless the click already landed on the toggle-label/input (natural toggle).
  document.querySelectorAll('.setting-item-full').forEach(card => {
    card.addEventListener('click', e => {
      // Let the label/input handle itself naturally to avoid double-fire
      if (e.target.closest('.toggle-label') || e.target.closest('.toggle-input') ||
        e.target.closest('.content-control-drag-handle')) return;
      if (isReorderingContentControls && card.classList.contains('content-control-item')) return;
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

  const speedInput = document.getElementById('speed');
  const speedDisplay = document.getElementById('speedDisplay');
  const skipAdsCheckbox = document.getElementById('skipAds');
  const hideCommentsCheckbox = document.getElementById('hideComments');
  const hideShortsCheckbox = document.getElementById('hideShorts');
  const hideDescriptionCheckbox = document.getElementById('hideDescription');
  const hideSuggestionsCheckbox = document.getElementById('hideSuggestions');
  const rememberSpeedCheckbox = document.getElementById('rememberSpeed');
  const cloudSyncCheckbox = document.getElementById('cloudSync');
  const cloudSyncDesc = document.getElementById('cloudSyncDesc');
  const loopVideoCheckbox = document.getElementById('loopVideo');
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
  const bookmarkLibrary = document.getElementById('bookmarkLibrary');
  const bookmarkVideoCount = document.getElementById('bookmarkVideoCount');
  const bookmarkSelectionModeToggle = document.getElementById('bookmarkSelectionModeToggle');
  const bookmarkSelectionModeLabel = document.getElementById('bookmarkSelectionModeLabel');
  const bookmarkBulkActions = document.getElementById('bookmarkBulkActions');
  const bookmarkSelectionCount = document.getElementById('bookmarkSelectionCount');
  const bookmarkBulkAddToCollection = document.getElementById('bookmarkBulkAddToCollection');
  const bookmarkClearSelection = document.getElementById('bookmarkClearSelection');
  const bookmarkSearch = document.getElementById('bookmarkSearch');
  const bookmarkActiveFilters = document.getElementById('bookmarkActiveFilters');
  const bookmarkFilterToggle = document.getElementById('bookmarkFilterToggle');
  const bookmarkFilters = document.getElementById('bookmarkFilters');
  const bookmarkFilterCount = document.getElementById('bookmarkFilterCount');
  const bookmarkSortFilter = document.getElementById('bookmarkSortFilter');
  const bookmarkLabelFilter = document.getElementById('bookmarkLabelFilter');
  const bookmarkChannelFilter = document.getElementById('bookmarkChannelFilter');
  const bookmarkDurationFilter = document.getElementById('bookmarkDurationFilter');
  const bookmarkDateFilter = document.getElementById('bookmarkDateFilter');
  const bookmarkDatePicker = document.getElementById('bookmarkDatePicker');
  const bookmarkDateTrigger = document.getElementById('bookmarkDateTrigger');
  const bookmarkDateLabel = document.getElementById('bookmarkDateLabel');
  const bookmarkDatePopover = document.getElementById('bookmarkDatePopover');
  const bookmarkFolderSelect = document.getElementById('bookmarkFolderSelect');
  const bookmarkFolderPicker = document.getElementById('bookmarkFolderPicker');
  const bookmarkFolderTrigger = document.getElementById('bookmarkFolderTrigger');
  const bookmarkFolderLabel = document.getElementById('bookmarkFolderLabel');
  const bookmarkFolderOptions = document.getElementById('bookmarkFolderOptions');
  const newBookmarkFolderBtn = document.getElementById('newBookmarkFolderBtn');
  const shareBookmarkCollectionBtn = document.getElementById('shareBookmarkCollectionBtn');
  const profilePreset = document.getElementById('profilePreset');
  const themePreference = document.getElementById('themePreference');
  const startTutorialBtn = document.getElementById('startTutorialBtn');
  const whatsNewBtn = document.getElementById('whatsNewBtn');
  const tipsGuideBtn = document.getElementById('tipsGuideBtn');
  let bookmarkCollections = { collections: [], memberships: {}, shared: [] };
  let bookmarkLibraryData = {};
  let bookmarkSelectionMode = false;
  const selectedBookmarkVideos = new Set();
  const expandedBookmarkVideos = new Set();
  let bookmarkCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let bookmarkCalendarFocusDate = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  function setupCustomSelect(select, pickerId, triggerId, labelId, optionsId) {
    const picker = document.getElementById(pickerId);
    const trigger = document.getElementById(triggerId);
    const label = document.getElementById(labelId);
    const options = document.getElementById(optionsId);
    if (!select || !picker || !trigger || !label || !options) return;

    const sync = () => {
      const selected = [...select.options].find((option) => option.value === select.value) || select.options[0];
      if (selected) label.textContent = selected.textContent;
      options.querySelectorAll('.cognify-select-option').forEach((option) => {
        option.setAttribute('aria-selected', String(option.dataset.value === select.value));
      });
    };
    [...select.options].forEach((sourceOption) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'cognify-select-option';
      option.dataset.value = sourceOption.value;
      option.setAttribute('role', 'option');
      option.textContent = sourceOption.textContent;
      option.addEventListener('click', () => {
        select.value = sourceOption.value;
        select.dispatchEvent(new Event('change'));
        options.hidden = true;
        picker.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      });
      options.appendChild(option);
    });
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = options.hidden;
      options.hidden = !open;
      picker.classList.toggle('open', open);
      trigger.setAttribute('aria-expanded', String(open));
    });
    select.addEventListener('change', sync);
    sync();
  }

  function parseBookmarkDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function getBookmarkDateValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatBookmarkDate(date) {
    return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  }

  function positionBookmarkDatePopover() {
    if (!bookmarkDateTrigger || !bookmarkDatePopover || bookmarkDatePopover.hidden) return;
    const triggerRect = bookmarkDateTrigger.getBoundingClientRect();
    const width = Math.min(270, window.innerWidth - 24);
    const left = Math.max(12, Math.min(triggerRect.right - width, window.innerWidth - width - 12));
    const popoverHeight = bookmarkDatePopover.getBoundingClientRect().height;
    const below = triggerRect.bottom + 6;
    const top = below + popoverHeight <= window.innerHeight - 12
      ? below
      : Math.max(12, triggerRect.top - popoverHeight - 6);
    bookmarkDatePopover.style.left = `${left}px`;
    bookmarkDatePopover.style.top = `${top}px`;
  }

  function renderBookmarkDateCalendar() {
    if (!bookmarkDatePopover) return;
    const monthStart = new Date(bookmarkCalendarMonth.getFullYear(), bookmarkCalendarMonth.getMonth(), 1);
    const selectedDate = parseBookmarkDate(bookmarkDateFilter?.value);
    const today = new Date();
    const todayValue = getBookmarkDateValue(today);
    const selectedValue = selectedDate ? getBookmarkDateValue(selectedDate) : '';
    const focusValue = getBookmarkDateValue(bookmarkCalendarFocusDate);
    const monthTitle = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(monthStart);
    bookmarkDatePopover.textContent = '';

    const header = document.createElement('div');
    header.className = 'bookmark-calendar-header';
    const monthLabel = document.createElement('span');
    monthLabel.className = 'bookmark-calendar-month';
    monthLabel.id = 'bookmarkCalendarMonth';
    monthLabel.textContent = monthTitle;
    const previousButton = document.createElement('button');
    previousButton.className = 'bookmark-calendar-nav bookmark-calendar-previous';
    previousButton.type = 'button';
    previousButton.setAttribute('aria-label', 'Previous month');
    previousButton.textContent = '‹';
    const nextButton = document.createElement('button');
    nextButton.className = 'bookmark-calendar-nav bookmark-calendar-next';
    nextButton.type = 'button';
    nextButton.setAttribute('aria-label', 'Next month');
    nextButton.textContent = '›';
    header.append(previousButton, monthLabel, nextButton);
    bookmarkDatePopover.appendChild(header);
    bookmarkDatePopover.setAttribute('aria-labelledby', monthLabel.id);

    const weekdays = document.createElement('div');
    weekdays.className = 'bookmark-calendar-weekdays';
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((weekday) => {
      const label = document.createElement('span');
      label.textContent = weekday;
      weekdays.appendChild(label);
    });
    bookmarkDatePopover.appendChild(weekdays);

    const days = document.createElement('div');
    days.className = 'bookmark-calendar-days';
    const firstDayOffset = (monthStart.getDay() + 6) % 7;
    const gridStart = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 - firstDayOffset);
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
      const dateValue = getBookmarkDateValue(date);
      const isCurrentMonth = date.getMonth() === monthStart.getMonth();
      const dayButton = document.createElement('button');
      dayButton.className = 'bookmark-calendar-day';
      dayButton.type = 'button';
      dayButton.textContent = String(date.getDate());
      dayButton.dataset.date = dateValue;
      dayButton.tabIndex = dateValue === focusValue ? 0 : -1;
      dayButton.setAttribute('aria-label', new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }).format(date));
      dayButton.setAttribute('aria-pressed', String(dateValue === selectedValue));
      if (!isCurrentMonth) dayButton.classList.add('is-outside-month');
      if (dateValue === todayValue) dayButton.classList.add('is-today');
      if (dateValue === selectedValue) dayButton.classList.add('is-selected');
      dayButton.addEventListener('click', () => {
        bookmarkDateFilter.value = dateValue;
        bookmarkDateLabel.textContent = formatBookmarkDate(date);
        bookmarkCalendarFocusDate = date;
        setBookmarkDatePickerOpen(false, true);
        bookmarkDateFilter.dispatchEvent(new Event('input'));
      });
      dayButton.addEventListener('keydown', (event) => {
        const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        let nextDate;
        if (Object.prototype.hasOwnProperty.call(offsets, event.key)) {
          nextDate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsets[event.key]);
        } else if (event.key === 'Home' || event.key === 'End') {
          const weekdayOffset = (date.getDay() + 6) % 7;
          nextDate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + (event.key === 'Home' ? -weekdayOffset : 6 - weekdayOffset));
        } else if (event.key === 'PageUp' || event.key === 'PageDown') {
          const monthDelta = event.key === 'PageUp' ? -1 : 1;
          const targetMonth = new Date(date.getFullYear(), date.getMonth() + monthDelta, 1);
          const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate();
          nextDate = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), Math.min(date.getDate(), lastDay));
        } else {
          return;
        }
        event.preventDefault();
        bookmarkCalendarFocusDate = nextDate;
        bookmarkCalendarMonth = new Date(nextDate.getFullYear(), nextDate.getMonth(), 1);
        renderBookmarkDateCalendar();
        bookmarkDatePopover.querySelector(`[data-date="${getBookmarkDateValue(nextDate)}"]`)?.focus();
      });
      days.appendChild(dayButton);
    }
    bookmarkDatePopover.appendChild(days);

    const footer = document.createElement('div');
    footer.className = 'bookmark-calendar-footer';
    const clearButton = document.createElement('button');
    clearButton.className = 'bookmark-calendar-footer-button';
    clearButton.type = 'button';
    clearButton.textContent = 'Clear';
    clearButton.disabled = !bookmarkDateFilter?.value;
    clearButton.addEventListener('click', () => {
      bookmarkDateFilter.value = '';
      bookmarkDateLabel.textContent = 'Any date';
      setBookmarkDatePickerOpen(false, true);
      bookmarkDateFilter.dispatchEvent(new Event('input'));
    });
    const todayButton = document.createElement('button');
    todayButton.className = 'bookmark-calendar-footer-button is-primary';
    todayButton.type = 'button';
    todayButton.textContent = 'Today';
    todayButton.addEventListener('click', () => {
      const selectedToday = new Date();
      bookmarkDateFilter.value = getBookmarkDateValue(selectedToday);
      bookmarkDateLabel.textContent = formatBookmarkDate(selectedToday);
      bookmarkCalendarFocusDate = selectedToday;
      setBookmarkDatePickerOpen(false, true);
      bookmarkDateFilter.dispatchEvent(new Event('input'));
    });
    footer.append(clearButton, todayButton);
    bookmarkDatePopover.appendChild(footer);

    const changeMonth = (amount, focusSelector) => {
      const targetMonth = new Date(bookmarkCalendarMonth.getFullYear(), bookmarkCalendarMonth.getMonth() + amount, 1);
      const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate();
      bookmarkCalendarFocusDate = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), Math.min(bookmarkCalendarFocusDate.getDate(), lastDay));
      bookmarkCalendarMonth = targetMonth;
      renderBookmarkDateCalendar();
      bookmarkDatePopover.querySelector(focusSelector)?.focus();
      positionBookmarkDatePopover();
    };
    previousButton.addEventListener('click', () => changeMonth(-1, '.bookmark-calendar-previous'));
    nextButton.addEventListener('click', () => changeMonth(1, '.bookmark-calendar-next'));
  }

  function setBookmarkDatePickerOpen(open, restoreFocus = false) {
    if (!bookmarkDatePopover || !bookmarkDatePicker || !bookmarkDateTrigger) return;
    bookmarkDatePopover.hidden = !open;
    bookmarkDatePicker.classList.toggle('open', open);
    bookmarkDateTrigger.setAttribute('aria-expanded', String(open));
    if (open) {
      const selected = parseBookmarkDate(bookmarkDateFilter?.value);
      bookmarkCalendarFocusDate = selected || new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
      bookmarkCalendarMonth = new Date(bookmarkCalendarFocusDate.getFullYear(), bookmarkCalendarFocusDate.getMonth(), 1);
      renderBookmarkDateCalendar();
      positionBookmarkDatePopover();
      bookmarkDatePopover.querySelector(`[data-date="${getBookmarkDateValue(bookmarkCalendarFocusDate)}"]`)?.focus();
    } else if (restoreFocus) {
      bookmarkDateTrigger.focus();
    }
  }

  bookmarkDateTrigger?.addEventListener('click', (event) => {
    event.stopPropagation();
    setBookmarkDatePickerOpen(bookmarkDatePopover.hidden);
  });
  bookmarkDatePopover?.addEventListener('click', (event) => event.stopPropagation());
  bookmarkDatePopover?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setBookmarkDatePickerOpen(false, true);
    }
  });
  window.addEventListener('resize', positionBookmarkDatePopover);

  setupCustomSelect(bookmarkDurationFilter, 'bookmarkDurationPicker', 'bookmarkDurationTrigger', 'bookmarkDurationLabel', 'bookmarkDurationOptions');
  setupCustomSelect(bookmarkSortFilter, 'bookmarkSortPicker', 'bookmarkSortTrigger', 'bookmarkSortLabel', 'bookmarkSortOptions');
  setupCustomSelect(profilePreset, 'profilePicker', 'profileTrigger', 'profileLabel', 'profileOptions');
  setupCustomSelect(themePreference, 'themePicker', 'themeTrigger', 'themeLabel', 'themeOptions');

  function saveBookmarkCollections(callback) {
    getBookmarkLibraryStorage((storage) => storage.set({ bookmarkCollections }, () => {
      callback?.(chrome.runtime.lastError?.message || null);
    }));
  }

  function closeBookmarkTimestampMenus(exceptContainer = null) {
    document.querySelectorAll('.bookmark-time-menu:not([hidden])').forEach((menu) => {
      if (menu.closest('.bookmark-time-actions') === exceptContainer) return;
      menu.hidden = true;
      menu.closest('.bookmark-time-actions')?.querySelector('.bookmark-time')?.setAttribute('aria-expanded', 'false');
    });
  }

  function updateBookmarkSelectionUI() {
    const count = selectedBookmarkVideos.size;
    bookmarkLibrary?.classList.toggle('is-selecting', bookmarkSelectionMode);
    if (bookmarkBulkActions && bookmarkSelectionCount) {
      bookmarkBulkActions.hidden = count === 0;
      bookmarkSelectionCount.textContent = `${count} video${count === 1 ? '' : 's'} selected`;
    }
  }

  function setBookmarkSelectionMode(enabled) {
    bookmarkSelectionMode = enabled;
    if (!enabled) selectedBookmarkVideos.clear();
    if (bookmarkSelectionModeLabel) bookmarkSelectionModeLabel.textContent = enabled ? 'Cancel selection' : 'Select videos';
    bookmarkSelectionModeToggle?.setAttribute('aria-label', enabled ? 'Cancel video selection' : 'Select videos');
    bookmarkSelectionModeToggle?.setAttribute('title', enabled ? 'Cancel video selection' : 'Select videos');
    bookmarkSelectionModeToggle?.setAttribute('aria-pressed', String(enabled));
    bookmarkLibrary?.querySelectorAll('.bookmark-video').forEach((card) => {
      const selected = selectedBookmarkVideos.has(card.dataset.videoId);
      card.setAttribute('role', enabled ? 'group' : 'link');
      card.classList.toggle('is-selected', selected);
      const button = card.querySelector('.bookmark-video-select');
      button?.setAttribute('aria-pressed', String(selected));
      button?.setAttribute('aria-label', `${selected ? 'Deselect' : 'Select'} ${card.dataset.videoTitle || 'video'}`);
      button?.setAttribute('title', `${selected ? 'Deselect' : 'Select'} video`);
    });
    updateBookmarkSelectionUI();
  }

  function toggleBookmarkVideoSelection(videoId, card) {
    if (selectedBookmarkVideos.has(videoId)) selectedBookmarkVideos.delete(videoId);
    else selectedBookmarkVideos.add(videoId);
    const selected = selectedBookmarkVideos.has(videoId);
    card?.classList.toggle('is-selected', selected);
    const button = card?.querySelector('.bookmark-video-select');
    button?.setAttribute('aria-pressed', String(selected));
    button?.setAttribute('aria-label', `${selected ? 'Deselect' : 'Select'} ${card?.dataset.videoTitle || 'video'}`);
    button?.setAttribute('title', `${selected ? 'Deselect' : 'Select'} video`);
    updateBookmarkSelectionUI();
  }

  function refreshBookmarkFolderOptions(preferredSelection) {
    if (!bookmarkFolderSelect) return;
    const selected = preferredSelection || bookmarkFolderSelect.value || 'all';
    bookmarkFolderSelect.textContent = '';
    const folders = [['all', 'All collections'], ...bookmarkCollections.collections.map((name) => [name, name])];
    folders.forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        bookmarkFolderSelect.appendChild(option);
      });
    bookmarkFolderSelect.value = [...bookmarkFolderSelect.options].some((option) => option.value === selected) ? selected : 'all';
    if (bookmarkFolderLabel) bookmarkFolderLabel.textContent = folders.find(([value]) => value === bookmarkFolderSelect.value)?.[1] || 'All collections';
    if (bookmarkFolderOptions) {
      bookmarkFolderOptions.textContent = '';
      folders.forEach(([value, label]) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'cognify-select-option';
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(value === bookmarkFolderSelect.value));
        option.textContent = label;
        option.addEventListener('click', () => {
          bookmarkFolderSelect.value = value;
          bookmarkFolderLabel.textContent = label;
          bookmarkFolderOptions.hidden = true;
          bookmarkFolderTrigger.setAttribute('aria-expanded', 'false');
          bookmarkFolderSelect.dispatchEvent(new Event('change'));
        });
        bookmarkFolderOptions.appendChild(option);
      });
    }
  }

  function closeBookmarkManageMenus() {
    document.querySelectorAll('.bookmark-manage-menu').forEach((menu) => {
      menu.hidden = true;
      menu.style.display = 'none';
      menu.style.visibility = '';
    });
    document.querySelectorAll('.bookmark-manage-button').forEach((button) => {
      button.setAttribute('aria-expanded', 'false');
    });
  }

  function positionBookmarkManageMenu(menu, button) {
    const buttonBounds = button.getBoundingClientRect();
    const margin = 8;
    const availableBelow = Math.max(0, window.innerHeight - buttonBounds.bottom - margin);
    const availableAbove = Math.max(0, buttonBounds.top - margin);
    menu.style.maxHeight = '200px';
    const naturalHeight = menu.getBoundingClientRect().height;
    const openAbove = availableBelow < naturalHeight && availableAbove > availableBelow;
    const availableHeight = openAbove ? availableAbove : availableBelow;
    menu.style.maxHeight = `${Math.min(200, availableHeight)}px`;

    const menuBounds = menu.getBoundingClientRect();
    const left = Math.max(margin, Math.min(
      buttonBounds.right - menuBounds.width,
      window.innerWidth - menuBounds.width - margin
    ));
    const top = openAbove
      ? Math.max(margin, buttonBounds.top - menuBounds.height - 4)
      : Math.min(buttonBounds.bottom + 4, window.innerHeight - menuBounds.height - margin);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = '';
  }

  bookmarkLibrary.addEventListener('scroll', closeBookmarkManageMenus);
  window.addEventListener('resize', closeBookmarkManageMenus);

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.bookmark-manage-menu, .bookmark-manage-button')) {
      closeBookmarkManageMenus();
    }
  });
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

  function formatBookmarkTime(seconds) {
    const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const remaining = String(safeSeconds % 60).padStart(2, '0');
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remaining}` : `${minutes}:${remaining}`;
  }

  let bookmarkUndoEntry = null;
  let bookmarkUndoTimer = null;

  function getBookmarkLibraryStorage(callback) {
    chrome.storage.sync.get(['cloudSync'], (result) => {
      callback(result.cloudSync !== false ? chrome.storage.sync : chrome.storage.local);
    });
  }

  function showBookmarkUndoNotice() {
    if (!bookmarkLibrary || !bookmarkUndoEntry) return;
    const remainingSeconds = Math.max(0, Math.ceil((bookmarkUndoEntry.expiresAt - Date.now()) / 1000));
    if (remainingSeconds === 0) {
      bookmarkUndoEntry = null;
      return;
    }

    const notice = document.createElement('div');
    notice.className = 'bookmark-undo-notice';
    Object.assign(notice.style, {
      alignItems: 'center',
      background: 'var(--bg-card-hover)',
      border: '1px solid var(--border-color-hover)',
      borderRadius: '6px',
      color: 'var(--text-primary)',
      display: 'flex',
      fontSize: '11px',
      justifyContent: 'space-between',
      marginBottom: '8px',
      padding: '8px 10px'
    });
    const message = document.createElement('span');
    message.textContent = `Bookmark${bookmarkUndoEntry.bookmarks.length === 1 ? '' : 's'} deleted (${remainingSeconds}s)`;
    const undoButton = document.createElement('button');
    undoButton.type = 'button';
    undoButton.textContent = 'Undo';
    Object.assign(undoButton.style, {
      background: 'transparent',
      border: '1px solid var(--border-color-hover)',
      borderRadius: '4px',
      color: 'var(--text-primary)',
      cursor: 'pointer',
      fontSize: '11px',
      padding: '3px 8px'
    });
    undoButton.onclick = () => undoBookmarkLibraryDeletion();
    notice.append(message, undoButton);
    bookmarkLibrary.appendChild(notice);
  }

  function deleteBookmarkLibraryItems(videoId, times) {
    const storageKey = `yt_bm_${videoId}`;
    getBookmarkLibraryStorage((storage) => {
      storage.get([storageKey], (result) => {
        const currentBookmarks = Array.isArray(result[storageKey]) ? result[storageKey] : [];
        const deletedBookmarks = currentBookmarks.filter((bookmark) => times.includes(Number(bookmark.time)));
        const remainingBookmarks = currentBookmarks.filter((bookmark) => !times.includes(Number(bookmark.time)));
        if (!deletedBookmarks.length) return;

        storage.set({ [storageKey]: remainingBookmarks }, () => {
          if (chrome.runtime.lastError) return;
          clearTimeout(bookmarkUndoTimer);
          bookmarkUndoEntry = {
            storageKey,
            bookmarks: deletedBookmarks,
            expiresAt: Date.now() + 10000
          };
          bookmarkUndoTimer = setTimeout(() => {
            bookmarkUndoEntry = null;
            loadBookmarkLibrary();
          }, 10000);
          loadBookmarkLibrary();
        });
      });
    });
  }

  function undoBookmarkLibraryDeletion() {
    if (!bookmarkUndoEntry || bookmarkUndoEntry.expiresAt <= Date.now()) return;
    const entry = bookmarkUndoEntry;
    clearTimeout(bookmarkUndoTimer);
    getBookmarkLibraryStorage((storage) => {
      storage.get([entry.storageKey], (result) => {
        const currentBookmarks = Array.isArray(result[entry.storageKey]) ? result[entry.storageKey] : [];
        storage.set({ [entry.storageKey]: [...currentBookmarks, ...entry.bookmarks] }, () => {
          if (chrome.runtime.lastError) return;
          bookmarkUndoEntry = null;
          loadBookmarkLibrary();
        });
      });
    });
  }

  function renderBookmarkFilterChips() {
    if (!bookmarkActiveFilters) return;
    const filters = [];
    const addFilter = (label, value, clear) => {
      if (value) filters.push({ label, value, clear });
    };
    const addTextFilter = (label, control) => {
      const value = String(control?.value || '').trim();
      addFilter(label, value, () => {
        control.value = '';
        control.dispatchEvent(new Event('input'));
      });
    };

    addTextFilter('Search', bookmarkSearch);
    addTextFilter('Label', bookmarkLabelFilter);
    addTextFilter('Channel', bookmarkChannelFilter);

    if (bookmarkDurationFilter?.value) {
      const selectedOption = bookmarkDurationFilter.options[bookmarkDurationFilter.selectedIndex];
      addFilter('Duration', selectedOption?.textContent || bookmarkDurationFilter.value, () => {
        bookmarkDurationFilter.value = '';
        bookmarkDurationFilter.dispatchEvent(new Event('change'));
      });
    }

    if (bookmarkDateFilter?.value) {
      const selectedDate = parseBookmarkDate(bookmarkDateFilter.value);
      addFilter('Since', selectedDate ? formatBookmarkDate(selectedDate) : bookmarkDateFilter.value, () => {
        bookmarkDateFilter.value = '';
        bookmarkDateLabel.textContent = 'Any date';
        bookmarkDateFilter.dispatchEvent(new Event('input'));
      });
    }
    if (bookmarkFolderSelect?.value && bookmarkFolderSelect.value !== 'all') {
      addFilter('Collection', bookmarkFolderLabel.textContent, () => {
        bookmarkFolderSelect.value = 'all';
        refreshBookmarkFolderOptions();
        bookmarkFolderSelect.dispatchEvent(new Event('change'));
      });
    }

    bookmarkActiveFilters.textContent = '';
    bookmarkActiveFilters.hidden = filters.length === 0;
    filters.forEach(({ label, value, clear }) => {
      const chip = document.createElement('button');
      chip.className = 'bookmark-filter-chip';
      chip.type = 'button';
      chip.textContent = `${label}: ${value} ×`;
      chip.setAttribute('aria-label', `Remove ${label} filter: ${value}`);
      chip.addEventListener('click', clear);
      bookmarkActiveFilters.appendChild(chip);
    });
  }

  function renderBookmarkLibrary(data) {
    if (!bookmarkLibrary) return;
    bookmarkLibraryData = data || {};
    closeBookmarkManageMenus();
    document.querySelectorAll('.bookmark-manage-menu').forEach((menu) => menu.remove());
    bookmarkLibrary.textContent = '';
    showBookmarkUndoNotice();
    renderBookmarkFilterChips();
    const activeFilterCount = [bookmarkLabelFilter, bookmarkChannelFilter, bookmarkDurationFilter, bookmarkDateFilter]
      .filter((control) => control && String(control.value || '').trim())
      .length;
    bookmarkFilterCount.textContent = activeFilterCount ? String(activeFilterCount) : '';
    bookmarkFilterCount.hidden = activeFilterCount === 0;
    const allVideos = CognifyBookmarkUtils.getBookmarkVideos(data);
    if (!allVideos.length && bookmarkSelectionMode) setBookmarkSelectionMode(false);
    if (bookmarkSelectionModeToggle) bookmarkSelectionModeToggle.hidden = allVideos.length === 0;
    const availableVideoIds = new Set(allVideos.map((video) => video.videoId));
    selectedBookmarkVideos.forEach((videoId) => {
      if (!availableVideoIds.has(videoId)) selectedBookmarkVideos.delete(videoId);
    });
    expandedBookmarkVideos.forEach((videoId) => {
      if (!availableVideoIds.has(videoId)) expandedBookmarkVideos.delete(videoId);
    });
    updateBookmarkSelectionUI();
    let videos = allVideos
      .filter((video) => !bookmarkFolderSelect || bookmarkFolderSelect.value === 'all' || (bookmarkCollections.memberships[video.videoId] || []).includes(bookmarkFolderSelect.value))
      .filter(video => video.bookmarks.length);
    videos = CognifyBookmarkUtils.filterBookmarkVideos(videos, {
      query: bookmarkSearch?.value,
      label: bookmarkLabelFilter?.value,
      channel: bookmarkChannelFilter?.value,
      maxDuration: bookmarkDurationFilter?.value,
      since: bookmarkDateFilter?.value,
    });
    videos = CognifyBookmarkUtils.sortBookmarkVideos(videos, bookmarkSortFilter?.value);
    if (bookmarkVideoCount) {
      bookmarkVideoCount.textContent = `${videos.length} video${videos.length === 1 ? '' : 's'}`;
    }

    if (!videos.length) {
      const empty = document.createElement('div');
      empty.className = 'bookmark-library-empty';
      empty.textContent = 'No bookmarked videos yet. Press P while watching a YouTube video.';
      bookmarkLibrary.appendChild(empty);
      return;
    }

    videos.forEach(({ videoId, bookmarks }) => {
      const card = document.createElement('article');
      card.className = 'bookmark-video';
      card.style.position = 'relative';
      card.tabIndex = 0;
      card.setAttribute('role', bookmarkSelectionMode ? 'group' : 'link');
      card.title = 'Open video in a new tab';
      const videoTitle = bookmarks.find((mark) => mark.title)?.title || `YouTube video (${videoId})`;
      card.dataset.videoId = videoId;
      card.dataset.videoTitle = videoTitle;
      const isExpanded = expandedBookmarkVideos.has(videoId);
      const videoUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
      const openVideo = () => chrome.tabs.create({ url: videoUrl });
      card.addEventListener('click', (event) => {
        if (bookmarkSelectionMode) {
          if (!event.target.closest('button, input, select, textarea')) toggleBookmarkVideoSelection(videoId, card);
          return;
        }
        if (!event.target.closest('.bookmark-time-actions, .bookmark-video-select, .bookmark-manage-button, .bookmark-manage-menu, .bookmark-expand-toggle')) openVideo();
      });
      const selectionButton = document.createElement('button');
      selectionButton.className = 'bookmark-video-select';
      selectionButton.type = 'button';
      selectionButton.setAttribute('aria-pressed', String(selectedBookmarkVideos.has(videoId)));
      selectionButton.setAttribute('aria-label', `${selectedBookmarkVideos.has(videoId) ? 'Deselect' : 'Select'} ${videoTitle}`);
      selectionButton.title = `${selectedBookmarkVideos.has(videoId) ? 'Deselect' : 'Select'} video`;
      selectionButton.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 8 3 3 6-6"></path></svg>';
      card.classList.toggle('is-selected', selectedBookmarkVideos.has(videoId));
      selectionButton.addEventListener('click', (event) => {
        event.stopPropagation();
        if (bookmarkSelectionMode) toggleBookmarkVideoSelection(videoId, card);
      });
      const manageButton = document.createElement('button');
      manageButton.className = 'bookmark-manage-button';
      manageButton.type = 'button';
      manageButton.title = `More options for ${videoTitle}`;
      manageButton.setAttribute('aria-label', `More options for ${videoTitle}`);
      manageButton.setAttribute('aria-expanded', 'false');
      manageButton.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7"></circle><circle cx="12" cy="12" r="1.7"></circle><circle cx="12" cy="19" r="1.7"></circle></svg>';
      manageButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const wasOpen = !menu.hidden;
        closeBookmarkManageMenus();
        if (!wasOpen) {
          menu.hidden = false;
          menu.style.display = 'grid';
          menu.style.visibility = 'hidden';
          positionBookmarkManageMenu(menu, manageButton);
          manageButton.setAttribute('aria-expanded', 'true');
          menu.scrollTop = 0;
        }
      });
      card.appendChild(manageButton);
      const menu = document.createElement('div');
      menu.className = 'bookmark-manage-menu';
      menu.id = `bookmark-manage-menu-${videoId}`;
      menu.hidden = true;
      manageButton.setAttribute('aria-haspopup', 'true');
      manageButton.setAttribute('aria-controls', menu.id);
      const addManageAction = (label, action, isDestructive = false) => {
        const actionButton = document.createElement('button');
        actionButton.className = `bookmark-manage-action${isDestructive ? ' is-destructive' : ''}`;
        actionButton.type = 'button';
        actionButton.textContent = label;
        actionButton.onclick = (event) => {
          event.stopPropagation();
          closeBookmarkManageMenus();
          action();
        };
        menu.appendChild(actionButton);
      };
      const addManageSection = (label) => {
        const heading = document.createElement('div');
        heading.textContent = label;
        Object.assign(heading.style, {
          color: 'var(--text-secondary)',
          fontSize: '9px',
          fontWeight: '700',
          padding: '5px 8px 2px',
          textTransform: 'uppercase'
        });
        menu.appendChild(heading);
      };
      const addManageDivider = () => {
        const divider = document.createElement('div');
        Object.assign(divider.style, {
          borderTop: '1px solid var(--border-color)',
          margin: '3px 5px'
        });
        menu.appendChild(divider);
      };

      addManageSection('Collections');
      const videoCollections = bookmarkCollections.memberships[videoId] || [];
      if (bookmarkCollections.collections.length) {
        bookmarkCollections.collections.forEach((folder) => {
          const isAssigned = videoCollections.includes(folder);
          addManageAction(`${isAssigned ? 'Remove from' : 'Add to'} ${folder}`, () => {
            const previousMemberships = [...videoCollections];
            if (isAssigned) CognifyBookmarkUtils.removeVideoFromCollection(bookmarkCollections, videoId, folder);
            else CognifyBookmarkUtils.addVideoToCollection(bookmarkCollections, videoId, folder);
            saveBookmarkCollections((error) => {
              if (error) {
                if (previousMemberships.length) bookmarkCollections.memberships[videoId] = previousMemberships;
                else delete bookmarkCollections.memberships[videoId];
                showModal({ title: 'Could not save collection', message: error, buttons: [{ text: 'OK', type: 'primary' }] });
                return;
              }
              renderBookmarkLibrary(bookmarkLibraryData);
            });
          });
        });
      } else {
        const emptyCollections = document.createElement('div');
        emptyCollections.textContent = 'Create a collection from Manage bookmarks first.';
        Object.assign(emptyCollections.style, {
          color: 'var(--text-secondary)',
          fontSize: '10px',
          padding: '5px 8px',
          whiteSpace: 'normal'
        });
        menu.appendChild(emptyCollections);
      }

      addManageDivider();
      addManageSection('Delete bookmarks');
      bookmarks.forEach((bookmark) => {
        addManageAction(`Delete ${formatBookmarkTime(bookmark.time)}`, () => {
          deleteBookmarkLibraryItems(videoId, [Number(bookmark.time)]);
        }, true);
      });
      addManageAction('Delete all for this video', () => deleteBookmarkLibraryItems(videoId, bookmarks.map(bookmark => Number(bookmark.time))), true);
      menu.addEventListener('click', (event) => event.stopPropagation());
      document.body.appendChild(menu);
      card.addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button, input, select, textarea')) {
          event.preventDefault();
          if (bookmarkSelectionMode) toggleBookmarkVideoSelection(videoId, card);
          else openVideo();
        }
      });
      const thumbnail = document.createElement('img');
      thumbnail.className = 'bookmark-thumbnail';
      thumbnail.src = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
      thumbnail.alt = '';
      thumbnail.loading = 'lazy';
      thumbnail.onerror = () => { thumbnail.src = '../../icons/icon-48.png'; };
      const thumbnailColumn = document.createElement('div');
      thumbnailColumn.className = 'bookmark-thumbnail-column';
      thumbnailColumn.append(thumbnail, selectionButton);
      const body = document.createElement('div');
      body.className = 'bookmark-video-body';
      const title = document.createElement('span');
      title.className = 'bookmark-video-title';
      title.textContent = videoTitle;
      title.title = title.textContent;
      const count = document.createElement('div');
      count.className = 'bookmark-video-count';
      count.textContent = `${bookmarks.length} bookmark${bookmarks.length === 1 ? '' : 's'}`;
      const times = document.createElement('div');
      times.className = 'bookmark-times';
      times.id = `bookmark-times-${videoId}`;
      bookmarks.forEach((mark, index) => {
        const timeActions = document.createElement('div');
        timeActions.className = 'bookmark-time-actions';
        timeActions.hidden = index >= 3 && !isExpanded;
        const button = document.createElement('button');
        button.className = 'bookmark-time';
        button.type = 'button';
        const timeValue = document.createElement('span');
        timeValue.className = 'bookmark-time-value';
        const timeLabel = formatBookmarkTime(mark.time);
        const noteText = typeof mark.label === 'string' ? mark.label.trim() : '';
        timeValue.textContent = timeLabel;
        button.appendChild(timeValue);
        if (noteText) {
          const notePreview = document.createElement('span');
          notePreview.className = 'bookmark-time-note';
          notePreview.textContent = noteText;
          button.appendChild(notePreview);
        }
        button.title = `Actions for bookmark at ${timeLabel}${noteText ? `: ${noteText}` : ''}`;
        button.setAttribute('aria-label', `Show actions for bookmark at ${timeLabel}${noteText ? `, note: ${noteText}` : ''}`);
        button.setAttribute('aria-expanded', 'false');
        const timeMenu = document.createElement('div');
        timeMenu.className = 'bookmark-time-menu';
        timeMenu.id = `bookmark-time-menu-${videoId}-${index}`;
        timeMenu.hidden = true;
        button.setAttribute('aria-controls', timeMenu.id);
        const addTimestampAction = (label, action) => {
          const actionButton = document.createElement('button');
          actionButton.className = 'bookmark-time-action';
          actionButton.type = 'button';
          actionButton.textContent = label;
          actionButton.addEventListener('click', (event) => {
            event.stopPropagation();
            closeBookmarkTimestampMenus();
            action();
          });
          timeMenu.appendChild(actionButton);
        };
        addTimestampAction(`Open video at ${formatBookmarkTime(mark.time)}`, () => {
          chrome.tabs.create({ url: `${videoUrl}&t=${Math.floor(Number(mark.time))}s` });
        });
        addTimestampAction(mark.label ? 'Edit note' : 'Add note', () => {
          openBookmarkNoteDialog(videoId, Number(mark.time), mark.label || '', button);
        });
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          const shouldOpen = timeMenu.hidden;
          closeBookmarkTimestampMenus();
          timeMenu.hidden = !shouldOpen;
          button.setAttribute('aria-expanded', String(shouldOpen));
        });
        timeMenu.addEventListener('click', (event) => event.stopPropagation());
        timeActions.append(button, timeMenu);
        times.appendChild(timeActions);
      });
      body.append(title, count, times);
      if (bookmarks.length > 3) {
        const expandButton = document.createElement('button');
        expandButton.className = 'bookmark-expand-toggle';
        expandButton.type = 'button';
        expandButton.setAttribute('aria-controls', times.id);
        expandButton.setAttribute('aria-expanded', String(isExpanded));
        expandButton.textContent = isExpanded ? 'Show fewer' : `Show all ${bookmarks.length} bookmarks`;
        expandButton.addEventListener('click', (event) => {
          event.stopPropagation();
          const shouldExpand = !expandedBookmarkVideos.has(videoId);
          if (shouldExpand) expandedBookmarkVideos.add(videoId);
          else expandedBookmarkVideos.delete(videoId);
          times.querySelectorAll('.bookmark-time-actions').forEach((timeActions, index) => {
            timeActions.hidden = index >= 3 && !shouldExpand;
          });
          expandButton.setAttribute('aria-expanded', String(shouldExpand));
          expandButton.textContent = shouldExpand ? 'Show fewer' : `Show all ${bookmarks.length} bookmarks`;
        });
        body.appendChild(expandButton);
      }
      card.append(thumbnailColumn, body);
      bookmarkLibrary.appendChild(card);
    });
  }

  function loadBookmarkLibrary() {
    if (!globalThis.chrome?.storage?.sync) {
      refreshBookmarkFolderOptions();
      renderBookmarkLibrary({});
      return;
    }
    const sharedCollection = new URLSearchParams(location.search).get('collection');
    chrome.storage.sync.get(['cloudSync'], (result) => {
      const storage = result.cloudSync !== false ? chrome.storage.sync : chrome.storage.local;
      if (sharedCollection) {
        try {
          const imported = JSON.parse(decodeURIComponent(sharedCollection));
          const importedName = typeof imported?.name === 'string' ? imported.name.trim().slice(0, 40) : '';
          if (importedName && imported.bookmarks && typeof imported.bookmarks === 'object') {
            storage.get(['bookmarkCollections'], (existing) => {
              const mergedCollections = CognifyBookmarkUtils.normalizeBookmarkCollections(existing.bookmarkCollections);
              if (!mergedCollections.collections.includes(importedName)) mergedCollections.collections.push(importedName);
              Object.keys(imported.bookmarks).forEach((key) => {
                if (key.startsWith('yt_bm_')) {
                  CognifyBookmarkUtils.addVideoToCollection(mergedCollections, key.slice(6), importedName);
                }
              });
              storage.set({ ...imported.bookmarks, bookmarkCollections: mergedCollections }, () => {
                history.replaceState({}, document.title, location.pathname);
                loadBookmarkLibrary();
              });
            });
            return;
          }
        } catch {
          showModal({ title: 'Invalid collection link', message: 'This shared collection link could not be imported.', buttons: [{ text: 'OK', type: 'primary' }] });
        }
      }
      storage.get(null, (data) => {
        if (chrome.runtime.lastError) {
          renderBookmarkLibrary({});
          return;
        }
        bookmarkCollections = CognifyBookmarkUtils.normalizeBookmarkCollections(data.bookmarkCollections);
        refreshBookmarkFolderOptions();
        renderBookmarkLibrary(data);
      });
    });
  }

  bookmarkFilterToggle.addEventListener('click', () => {
    bookmarkFilters.hidden = !bookmarkFilters.hidden;
    const isExpanded = !bookmarkFilters.hidden;
    bookmarkFilterToggle.setAttribute('aria-expanded', String(isExpanded));
    bookmarkFilterToggle.setAttribute('aria-label', `${isExpanded ? 'Hide' : 'Show'} bookmark filters`);
    bookmarkFilterToggle.title = `${isExpanded ? 'Hide' : 'Show'} bookmark filters`;
  });
  [bookmarkSearch, bookmarkLabelFilter, bookmarkChannelFilter, bookmarkDurationFilter, bookmarkDateFilter, bookmarkFolderSelect]
    .filter(Boolean)
    .forEach((control) => control.addEventListener('input', () => renderBookmarkLibrary(bookmarkLibraryData)));
  bookmarkDurationFilter?.addEventListener('change', () => renderBookmarkLibrary(bookmarkLibraryData));
  bookmarkSortFilter?.addEventListener('change', () => renderBookmarkLibrary(bookmarkLibraryData));
  bookmarkFolderSelect?.addEventListener('change', () => renderBookmarkLibrary(bookmarkLibraryData));
  bookmarkSelectionModeToggle?.addEventListener('click', () => setBookmarkSelectionMode(!bookmarkSelectionMode));
  bookmarkFolderTrigger?.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = !bookmarkFolderOptions.hidden;
    bookmarkFolderOptions.hidden = isOpen;
    bookmarkFolderPicker.classList.toggle('open', !isOpen);
    bookmarkFolderTrigger.setAttribute('aria-expanded', String(!isOpen));
  });
  bookmarkFolderOptions?.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', (event) => {
    if (!bookmarkFolderOptions?.hidden) {
      bookmarkFolderOptions.hidden = true;
      bookmarkFolderPicker?.classList.remove('open');
      bookmarkFolderTrigger?.setAttribute('aria-expanded', 'false');
    }
    if (!bookmarkDatePicker?.contains(event.target) && !bookmarkDatePopover?.hidden) {
      setBookmarkDatePickerOpen(false);
    }
  });

  function openNewCollectionDialog(returnFocusElement = bookmarkManageToggle) {
    const previousSelection = bookmarkFolderSelect.value || 'all';
    const dialog = createBookmarkDialog('New collection', 'Choose a clear name for the videos you want to organize.', returnFocusElement);
    const label = document.createElement('label');
    label.className = 'modal-label';
    label.textContent = 'Collection name';
    const input = document.createElement('input');
    input.className = 'modal-input bookmark-dialog-input';
    input.type = 'text';
    input.maxLength = 40;
    input.placeholder = 'e.g. Biology exam review';
    label.htmlFor = 'bookmarkCollectionNameInput';
    input.id = 'bookmarkCollectionNameInput';
    const feedback = document.createElement('div');
    feedback.className = 'bookmark-dialog-feedback';
    dialog.body.append(label, input, feedback);

    const cancelButton = document.createElement('button');
    cancelButton.className = 'modal-btn modal-btn-secondary';
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', dialog.close);
    const createButton = document.createElement('button');
    createButton.className = 'modal-btn modal-btn-primary';
    createButton.type = 'button';
    createButton.textContent = 'Create collection';
    const createCollection = () => {
      if (createButton.disabled) return;
      const name = input.value.trim().slice(0, 40);
      if (!name) {
        feedback.textContent = 'Enter a collection name.';
        input.focus();
        return;
      }
      if (name.toLowerCase() === 'all') {
        feedback.textContent = '"All collections" is reserved. Choose another name.';
        input.focus();
        return;
      }
      if (bookmarkCollections.collections.includes(name)) {
        feedback.textContent = 'That collection already exists.';
        input.focus();
        return;
      }

      const previousCollections = [...bookmarkCollections.collections];
      bookmarkCollections.collections.push(name);
      refreshBookmarkFolderOptions(previousSelection);
      input.disabled = true;
      cancelButton.disabled = true;
      createButton.disabled = true;
      dialog.modal.dataset.busy = 'true';
      saveBookmarkCollections((error) => {
        if (!dialog.overlay.isConnected) return;
        if (error) {
          bookmarkCollections.collections = previousCollections;
          refreshBookmarkFolderOptions(previousSelection);
          input.disabled = false;
          cancelButton.disabled = false;
          delete dialog.modal.dataset.busy;
          createButton.disabled = false;
          feedback.textContent = `Could not save this collection: ${error}`;
          return;
        }
        dialog.close();
        renderBookmarkLibrary(bookmarkLibraryData);
      });
    };
    createButton.addEventListener('click', createCollection);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        createCollection();
      }
    });
    dialog.actions.append(cancelButton, createButton);
    input.focus();
  }

  function openBookmarkNoteDialog(videoId, time, currentNote, returnFocusElement) {
    const dialog = createBookmarkDialog(
      currentNote ? 'Edit bookmark note' : 'Add bookmark note',
      'Add a short reminder to this timestamp.',
      returnFocusElement
    );
    const label = document.createElement('label');
    label.className = 'modal-label';
    label.textContent = 'Note';
    const textarea = document.createElement('textarea');
    textarea.className = 'modal-input bookmark-dialog-textarea';
    textarea.maxLength = 300;
    textarea.value = currentNote;
    textarea.placeholder = 'What should you remember here?';
    label.htmlFor = 'bookmarkNoteInput';
    textarea.id = 'bookmarkNoteInput';
    const feedback = document.createElement('div');
    feedback.className = 'bookmark-dialog-feedback';
    dialog.body.append(label, textarea, feedback);

    const cancelButton = document.createElement('button');
    cancelButton.className = 'modal-btn modal-btn-secondary';
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', dialog.close);
    const saveButton = document.createElement('button');
    saveButton.className = 'modal-btn modal-btn-primary';
    saveButton.type = 'button';
    saveButton.textContent = 'Save note';
    const saveNote = () => {
      if (saveButton.disabled) return;
      const storageKey = `yt_bm_${videoId}`;
      const note = textarea.value.trim().slice(0, 300);
      textarea.disabled = true;
      cancelButton.disabled = true;
      saveButton.disabled = true;
      dialog.modal.dataset.busy = 'true';
      getBookmarkLibraryStorage((storage) => storage.get([storageKey], (result) => {
        const readError = chrome.runtime.lastError?.message;
        if (readError) {
          textarea.disabled = false;
          cancelButton.disabled = false;
          delete dialog.modal.dataset.busy;
          saveButton.disabled = false;
          feedback.textContent = `Could not load this bookmark: ${readError}`;
          return;
        }
        const currentBookmarks = Array.isArray(result[storageKey]) ? result[storageKey] : [];
        if (!currentBookmarks.some((bookmark) => Number(bookmark.time) === time)) {
          textarea.disabled = false;
          cancelButton.disabled = false;
          delete dialog.modal.dataset.busy;
          saveButton.disabled = false;
          feedback.textContent = 'This timestamp no longer exists. Reopen the bookmarks list and try again.';
          return;
        }
        const updatedBookmarks = currentBookmarks.map((bookmark) => (
          Number(bookmark.time) === time ? { ...bookmark, label: note } : bookmark
        ));
        storage.set({ [storageKey]: updatedBookmarks }, () => {
          const writeError = chrome.runtime.lastError?.message;
          if (writeError) {
            textarea.disabled = false;
            cancelButton.disabled = false;
            delete dialog.modal.dataset.busy;
            saveButton.disabled = false;
            feedback.textContent = `Could not save this note: ${writeError}`;
            return;
          }
          dialog.close();
          loadBookmarkLibrary();
        });
      }));
    };
    saveButton.addEventListener('click', saveNote);
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        saveNote();
      }
    });
    dialog.actions.append(cancelButton, saveButton);
    textarea.focus();
  }

  function openBookmarkCollectionAssignmentDialog() {
    const videoIds = [...selectedBookmarkVideos];
    if (!videoIds.length) return;
    const dialog = createBookmarkDialog(
      'Add selected videos to a collection',
      `${videoIds.length} selected video${videoIds.length === 1 ? '' : 's'} will be added to the collection you choose.`,
      bookmarkFolderTrigger
    );
    const selectLabel = document.createElement('label');
    selectLabel.className = 'modal-label';
    selectLabel.textContent = 'Collection';
    const select = document.createElement('select');
    select.className = 'modal-input bookmark-dialog-select';
    select.setAttribute('aria-label', 'Choose a collection');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a collection';
    select.appendChild(placeholder);
    bookmarkCollections.collections.forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
    const createOption = document.createElement('option');
    createOption.value = '__create_collection__';
    createOption.textContent = 'Create a new collection…';
    select.appendChild(createOption);
    selectLabel.appendChild(select);
    const createField = document.createElement('div');
    createField.hidden = true;
    const createLabel = document.createElement('label');
    createLabel.className = 'modal-label';
    createLabel.textContent = 'New collection name';
    const createInput = document.createElement('input');
    createInput.className = 'modal-input bookmark-dialog-input';
    createInput.type = 'text';
    createInput.maxLength = 40;
    createInput.placeholder = 'e.g. Biology exam review';
    createLabel.htmlFor = 'bookmarkBulkCollectionNameInput';
    createInput.id = 'bookmarkBulkCollectionNameInput';
    createField.append(createLabel, createInput);
    const feedback = document.createElement('div');
    feedback.className = 'bookmark-dialog-feedback';
    dialog.body.append(selectLabel, createField, feedback);

    const syncCreateField = () => {
      createField.hidden = select.value !== createOption.value;
      if (!createField.hidden) createInput.focus();
    };
    select.addEventListener('change', syncCreateField);
    if (!bookmarkCollections.collections.length) {
      select.value = createOption.value;
      syncCreateField();
    }

    const cancelButton = document.createElement('button');
    cancelButton.className = 'modal-btn modal-btn-secondary';
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', dialog.close);
    const addButton = document.createElement('button');
    addButton.className = 'modal-btn modal-btn-primary';
    addButton.type = 'button';
    addButton.textContent = 'Add videos';
    addButton.addEventListener('click', () => {
      const isCreating = select.value === createOption.value;
      const collectionName = (isCreating ? createInput.value : select.value).trim().slice(0, 40);
      if (!collectionName) {
        feedback.textContent = isCreating ? 'Enter a collection name.' : 'Choose a collection.';
        (isCreating ? createInput : select).focus();
        return;
      }
      if (collectionName.toLowerCase() === 'all') {
        feedback.textContent = '"All collections" is reserved. Choose another name.';
        createInput.focus();
        return;
      }
      if (isCreating && bookmarkCollections.collections.includes(collectionName)) {
        feedback.textContent = 'That collection already exists. Choose it from the list instead.';
        createInput.focus();
        return;
      }

      const previousCollections = [...bookmarkCollections.collections];
      const previousMemberships = new Map(videoIds.map((videoId) => [
        videoId,
        [...(bookmarkCollections.memberships[videoId] || [])],
      ]));
      if (isCreating) bookmarkCollections.collections.push(collectionName);
      videoIds.forEach((videoId) => {
        CognifyBookmarkUtils.addVideoToCollection(bookmarkCollections, videoId, collectionName);
      });
      cancelButton.disabled = true;
      addButton.disabled = true;
      select.disabled = true;
      createInput.disabled = true;
      dialog.modal.dataset.busy = 'true';
      saveBookmarkCollections((error) => {
        if (!dialog.overlay.isConnected) return;
        if (error) {
          bookmarkCollections.collections = previousCollections;
          previousMemberships.forEach((memberships, videoId) => {
            if (memberships.length) bookmarkCollections.memberships[videoId] = memberships;
            else delete bookmarkCollections.memberships[videoId];
          });
          refreshBookmarkFolderOptions();
          cancelButton.disabled = false;
          select.disabled = false;
          createInput.disabled = false;
          delete dialog.modal.dataset.busy;
          addButton.disabled = false;
          feedback.textContent = `Could not save collection changes: ${error}`;
          return;
        }
        refreshBookmarkFolderOptions();
        selectedBookmarkVideos.clear();
        updateBookmarkSelectionUI();
        dialog.close();
        renderBookmarkLibrary(bookmarkLibraryData);
      });
    });
    dialog.actions.append(cancelButton, addButton);
    if (createField.hidden) select.focus();
  }

  function openShareCollectionDialog(returnFocusElement = bookmarkManageToggle) {
    if (!bookmarkCollections.collections.length) {
      showToast('Create a collection first using Manage → New collection.', 'info');
      return;
    }

    const dialog = createBookmarkDialog(
      'Share a collection',
      'Download a JSON file and send it to someone with Cognify installed. They can import it from Manage → Import bookmarks. Cognify does not upload your data.',
      returnFocusElement
    );
    const label = document.createElement('label');
    label.className = 'modal-label';
    label.id = 'bookmarkShareCollectionFieldLabel';
    label.htmlFor = 'bookmarkShareCollectionTrigger';
    label.textContent = 'Collection';
    const picker = document.createElement('div');
    picker.className = 'cognify-select bookmark-share-collection-select';
    picker.id = 'bookmarkShareCollectionPicker';
    const trigger = document.createElement('button');
    trigger.className = 'cognify-select-trigger';
    trigger.type = 'button';
    trigger.id = 'bookmarkShareCollectionTrigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'bookmarkShareCollectionOptions');
    const selectedLabel = document.createElement('span');
    selectedLabel.id = 'bookmarkShareCollectionLabel';
    trigger.setAttribute('aria-labelledby', `${label.id} ${selectedLabel.id}`);
    const arrow = document.createElement('span');
    arrow.className = 'cognify-select-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    trigger.append(selectedLabel, arrow);
    const options = document.createElement('div');
    options.className = 'cognify-select-options';
    options.id = 'bookmarkShareCollectionOptions';
    options.hidden = true;
    options.setAttribute('role', 'listbox');
    options.setAttribute('aria-labelledby', label.id);
    picker.append(trigger, options);
    const select = document.createElement('select');
    select.className = 'modal-input bookmark-dialog-select';
    select.id = 'bookmarkShareCollectionValue';
    select.hidden = true;
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a collection';
    select.appendChild(placeholder);

    bookmarkCollections.collections.forEach((name) => {
      const videoCount = Object.keys(CognifyBookmarkUtils.createBookmarkCollectionShare(
        name,
        bookmarkLibraryData,
        bookmarkCollections
      )?.bookmarks || {}).length;
      const option = document.createElement('option');
      option.value = name;
      option.textContent = `${name} (${videoCount} video${videoCount === 1 ? '' : 's'})`;
      select.appendChild(option);
    });

    const activeCollection = bookmarkFolderSelect?.value;
    if (bookmarkCollections.collections.includes(activeCollection)) select.value = activeCollection;
    dialog.body.append(label, picker, select);
    setupCustomSelect(
      select,
      picker.id,
      trigger.id,
      selectedLabel.id,
      options.id
    );
    const closePicker = () => {
      options.hidden = true;
      picker.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    };
    dialog.overlay.addEventListener('click', (event) => {
      if (!picker.contains(event.target)) closePicker();
    });
    trigger.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      if (options.hidden) trigger.click();
      options.querySelector('.cognify-select-option')?.focus();
    });
    options.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePicker();
        trigger.focus();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const optionButtons = [...options.querySelectorAll('.cognify-select-option')];
      const currentIndex = optionButtons.indexOf(document.activeElement);
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? optionButtons.length - 1
          : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + optionButtons.length) % optionButtons.length;
      if (!optionButtons.length) return;
      event.preventDefault();
      optionButtons[nextIndex].focus();
    });
    const feedback = document.createElement('div');
    feedback.className = 'bookmark-dialog-feedback';
    const cancelButton = document.createElement('button');
    cancelButton.className = 'modal-btn modal-btn-secondary';
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', dialog.close);
    const downloadButton = document.createElement('button');
    downloadButton.className = 'modal-btn modal-btn-primary bookmark-share-download';
    downloadButton.type = 'button';
    downloadButton.textContent = 'Download file';
    downloadButton.disabled = true;
    const getCollectionShare = (name) => CognifyBookmarkUtils.createBookmarkCollectionShare(
      name,
      bookmarkLibraryData,
      bookmarkCollections
    );
    const updateShareFeedback = () => {
      const count = Object.keys(getCollectionShare(select.value)?.bookmarks || {}).length;
      feedback.textContent = !select.value
        ? 'Choose a collection to continue.'
        : count
          ? `${count} saved video${count === 1 ? '' : 's'} will be included.`
          : 'This collection has no saved videos to share yet.';
      downloadButton.disabled = !select.value || count === 0;
    };
    downloadButton.addEventListener('click', () => {
      const name = select.value;
      const collectionShare = getCollectionShare(name);
      if (!collectionShare || !Object.keys(collectionShare.bookmarks).length) {
        updateShareFeedback();
        return;
      }

      try {
        const content = JSON.stringify(collectionShare, null, 2);
        const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
        const link = document.createElement('a');
        const fileName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'collection';
        link.href = url;
        link.download = `cognify-${fileName}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        dialog.close();
        showToast(`Downloaded "${name}" to your Downloads folder. Send the JSON file; recipients import it from Manage → Import bookmarks.`, 'success');
      } catch (error) {
        feedback.textContent = `Could not create the collection file: ${error.message}`;
      }
    });
    select.addEventListener('change', updateShareFeedback);
    dialog.body.appendChild(feedback);
    dialog.actions.append(cancelButton, downloadButton);
    updateShareFeedback();
    trigger.focus();
  }

  bookmarkBulkAddToCollection?.addEventListener('click', openBookmarkCollectionAssignmentDialog);
  bookmarkClearSelection?.addEventListener('click', () => {
    selectedBookmarkVideos.clear();
    renderBookmarkLibrary(bookmarkLibraryData);
  });
  newBookmarkFolderBtn?.addEventListener('click', () => openNewCollectionDialog());
  shareBookmarkCollectionBtn?.addEventListener('click', () => openShareCollectionDialog());
  loadBookmarkLibrary();

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
    watchedProgress: false,
    contentControlOrder: defaultContentControlOrder,
  };

  const normalizePlaybackSpeed = (value) => {
    const parsedSpeed = Number.parseFloat(value);
    if (!Number.isFinite(parsedSpeed)) return parseFloat(defaults.speed);
    return Math.min(16, Math.max(0.25, parsedSpeed));
  };

  const sliderFillPercent = (slider, value, thumbSize) => {
    const minimum = Number(slider.min);
    const maximum = Number(slider.max);
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || maximum <= minimum) return 0;

    const fraction = Math.min(1, Math.max(0, (numericValue - minimum) / (maximum - minimum)));
    const width = slider.getBoundingClientRect().width;
    if (!width) return fraction * 100;

    const thumbInset = Math.min(thumbSize / 2, width / 2);
    return ((thumbInset + fraction * (width - thumbSize)) / width) * 100;
  };

  // Update speed display with enhanced formatting + progress-bar fill
  const updateSpeedDisplay = (value) => {
    const speed = parseFloat(value);
    speedDisplay.textContent = `${speed.toFixed(1)}×`;
    const pct = sliderFillPercent(speedInput, speed, 14);
    const accent = getComputedStyle(document.body).getPropertyValue('--speed-accent').trim() || '#d94a4a';
    speedInput.style.background = `linear-gradient(to right, ${accent} ${pct}%, var(--border-color) ${pct}%)`;
  };

  /** Updates the left-fill gradient on the volume slider to match its current value. */
  const updateVolumeFill = (value) => {
    const pct = sliderFillPercent(defaultVolumeInput, value, 14);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim() || '#ff0000';
    defaultVolumeInput.style.background = `linear-gradient(to right, ${accent} ${pct}%, var(--border-color) ${pct}%)`;
  };

  updateSpeedDisplay(speedInput.value);
  updateVolumeFill(defaultVolumeInput.value);

  // Load stored settings with animation
  if (globalThis.chrome?.storage?.sync) chrome.storage.sync.get(defaults, (data) => {
    applyContentControlOrder(data.contentControlOrder);
    const storedSpeed = Number.parseFloat(data.speed);
    const speed = normalizePlaybackSpeed(data.speed);
    speedInput.value = speed;
    if (speed !== storedSpeed) chrome.storage.sync.set({ speed: speed.toString() });
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
    if (sleepTimerMinutesInput) sleepTimerMinutesInput.value = data.sleepTimerMinutes || 30;
    if (sleepTimerRow) sleepTimerRow.style.display = data.sleepTimerEnabled ? 'flex' : 'none';

    // Watched progress tags
    if (watchedProgressCheckbox) watchedProgressCheckbox.checked = data.watchedProgress || false;

    updateSpeedDisplay(speed);
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
    const watchedProgress = !!(watchedProgressCheckbox && watchedProgressCheckbox.checked);

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
  if (globalThis.chrome?.tabs?.query) chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url && tabs[0].url.includes('youtube.com')) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'getLoopState' }, (response) => {
        if (chrome.runtime.lastError || !response) return;
        renderLoopDisplay(response.loopAPoint, response.loopBPoint);
      });
    }
  });

  const setSpeed = (value) => {
    const nextValue = Math.min(16, Math.max(0.25, Math.round(value * 4) / 4));
    speedInput.value = nextValue;
    updateSpeedDisplay(nextValue);
    autoSave();
  };
  document.getElementById('speedDecrease')?.addEventListener('click', () => setSpeed(parseFloat(speedInput.value) - 0.25));
  document.getElementById('speedIncrease')?.addEventListener('click', () => setSpeed(parseFloat(speedInput.value) + 0.25));
  document.getElementById('speedReset')?.addEventListener('click', () => setSpeed(1));

  // Export Bookmarks action (Bookmarks menu)
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
          const isCollectionFile = data?.format === 'cognify-collection';
          const importedCollection = isCollectionFile
            ? CognifyBookmarkUtils.parseBookmarkCollectionShare(data)
            : null;
          if (isCollectionFile && !importedCollection) {
            showModal({ title: 'Invalid collection file', message: 'This file is not a supported Cognify collection.', variant: 'error', buttons: [{ text: 'OK', type: 'primary' }] });
            return;
          }
          // Accept both full export format and raw bookmark objects
          const bookmarkData = importedCollection?.bookmarks || data.bookmarks || {};
          if (typeof bookmarkData !== 'object' || Array.isArray(bookmarkData)) {
            showModal({ title: 'Invalid File', message: 'This file does not contain a valid bookmark list.', variant: 'error', buttons: [{ text: 'OK', type: 'primary' }] });
            return;
          }
          const keys = Object.keys(bookmarkData).filter(k => k.startsWith('yt_bm_'));
          const importedCollections = CognifyBookmarkUtils.normalizeBookmarkCollections(data.bookmarkCollections || bookmarkData.bookmarkCollections);
          if (importedCollection) {
            if (!importedCollections.collections.includes(importedCollection.name)) {
              importedCollections.collections.push(importedCollection.name);
            }
            keys.forEach((key) => {
              CognifyBookmarkUtils.addVideoToCollection(importedCollections, key.slice(6), importedCollection.name);
            });
          }
          if (keys.length === 0) {
            showModal({ title: 'Import', message: 'No bookmarks found in this file.', buttons: [{ text: 'OK', type: 'primary' }] });
            return;
          }
          chrome.storage.sync.get(['cloudSync'], (result) => {
            const useCloudSync = result.cloudSync !== false;
            const storage = useCloudSync ? chrome.storage.sync : chrome.storage.local;
            const toStore = {};
            keys.forEach(k => { toStore[k] = bookmarkData[k]; });
            storage.get(['bookmarkCollections'], (existing) => {
              const collections = CognifyBookmarkUtils.normalizeBookmarkCollections(existing.bookmarkCollections);
              importedCollections.collections.forEach((name) => {
                if (!collections.collections.includes(name)) collections.collections.push(name);
              });
              Object.entries(importedCollections.memberships).forEach(([videoId, names]) => {
                names.forEach((name) => CognifyBookmarkUtils.addVideoToCollection(collections, videoId, name));
              });
              collections.shared = [...collections.shared, ...importedCollections.shared];
              storage.set({ ...toStore, bookmarkCollections: collections }, () => {
                if (chrome.runtime.lastError) {
                  showModal({ title: 'Import Failed', message: `Import failed: ${chrome.runtime.lastError.message}`, variant: 'error', buttons: [{ text: 'OK', type: 'primary' }] });
                } else {
                  loadBookmarkLibrary();
                  showModal({
                    title: 'Import Successful',
                    message: importedCollection
                      ? `Added ${keys.length} videos to the imported collection.`
                      : `Imported ${keys.length} video(s) of bookmarks successfully.`,
                    variant: 'success',
                    buttons: [{ text: 'OK', type: 'primary' }]
                  });
                }
              });
            });
          });
        } catch {
          showModal({ title: 'Invalid File', message: 'Invalid backup file. Please select a valid Cognify backup JSON.', variant: 'error', buttons: [{ text: 'OK', type: 'primary' }] });
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
    loadBookmarkLibrary();
    
    autoSave();
  });
  
  // Update cloud sync description
  function updateCloudSyncDesc(isCloudSync) {
    if (isCloudSync) {
      cloudSyncDesc.textContent = 'Bookmarks use Chrome Sync when enabled. Sign into Chrome on each device; no Cognify account needed.';
    } else {
      cloudSyncDesc.textContent = 'Bookmarks stay on this device. Export a backup to move them to another device.';
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

  const profileSettings = {
    student: { speed: '1.5', focusMode: true, autoSubtitles: true, watchedProgress: true },
    professional: { speed: '1.25', focusMode: true, autoSubtitles: false, watchedProgress: true },
    casual: { speed: '1.0', focusMode: false, autoSubtitles: false, watchedProgress: false },
  };

  function applyTheme(preference) {
    const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
    const activeTheme = preference === 'system' ? (prefersLight ? 'light' : 'dark') : preference;
    document.body.dataset.theme = activeTheme;
    const themeToggle = document.getElementById('headerThemeToggle');
    if (themeToggle) {
      const nextTheme = activeTheme === 'light' ? 'dark' : 'light';
      themeToggle.title = `Switch to ${nextTheme} theme`;
      themeToggle.setAttribute('aria-label', `Switch to ${nextTheme} theme`);
    }
  }

  if (globalThis.chrome?.storage?.sync) chrome.storage.sync.get({ themePreference: 'system', profilePreset: '' }, (data) => {
    if (themePreference) themePreference.value = data.themePreference;
    if (profilePreset) profilePreset.value = data.profilePreset;
    applyTheme(data.themePreference);
  });
  themePreference?.addEventListener('change', () => {
    applyTheme(themePreference.value);
    if (globalThis.chrome?.storage?.sync) chrome.storage.sync.set({ themePreference: themePreference.value });
  });
  document.getElementById('headerThemeToggle')?.addEventListener('click', () => {
    const nextTheme = document.body.dataset.theme === 'light' ? 'dark' : 'light';
    if (themePreference) {
      themePreference.value = nextTheme;
      themePreference.dispatchEvent(new Event('change'));
    } else {
      applyTheme(nextTheme);
    }
  });
  profilePreset?.addEventListener('change', () => {
    const settings = profileSettings[profilePreset.value];
    if (!settings) return;
    if (globalThis.chrome?.storage?.sync) chrome.storage.sync.set({ ...settings, profilePreset: profilePreset.value }, () => window.location.reload());
  });

  async function runTutorial() {
    const steps = [
      ['Welcome to Cognify', 'Press P while watching YouTube to capture a timestamp bookmark.'],
      ['Organize', 'Select video cards to add several videos to an existing or new collection at once.'],
      ['Timestamp notes', 'Click a timestamp to open the video at that moment or add and edit a note.'],
      ['Make it yours', 'Choose a profile, customize shortcuts, and use the feature guide whenever you need a refresher.'],
    ];
    for (const [title, message] of steps) {
      const finished = await showModal({ title, message, buttons: [{ text: 'Continue', type: 'primary' }] });
      if (!finished) break;
    }
    chrome.storage.sync.set({ tutorialComplete: true });
  }
  startTutorialBtn?.addEventListener('click', runTutorial);
  tipsGuideBtn?.addEventListener('click', () => expandToggle.click());
  whatsNewBtn?.addEventListener('click', () => showModal({ title: "What's new in 3.9", message: 'Collections, search filters, recommendations, profiles, theme controls, and onboarding are now available.', buttons: [{ text: 'Got it', type: 'primary' }] }));
  if (globalThis.chrome?.storage?.sync) chrome.storage.sync.get({ tutorialComplete: false, lastSeenVersion: '' }, (data) => {
    if (!data.tutorialComplete) runTutorial();
    if (data.lastSeenVersion !== '3.9.0') {
      showModal({ title: "What's new", message: 'Cognify now includes collections, smarter bookmark discovery, profiles, and preference sync.', buttons: [{ text: 'Explore', type: 'primary' }] });
      chrome.storage.sync.set({ lastSeenVersion: '3.9.0' });
    }
  });
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
  if (globalThis.chrome?.storage?.sync) chrome.storage.sync.get(['shortcuts'], (data) => {
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

    const conflict = CognifyBookmarkUtils.findShortcutConflict({ ...defaultShortcuts, ...customShortcuts }, shortcut, recordingAction);
    if (conflict) {
      const input = document.querySelector(`.shortcut-input[data-action="${recordingAction}"]`);
      input.classList.remove('recording');
      input.textContent = customShortcuts[recordingAction] || defaultShortcuts[recordingAction];
      recordingAction = null;
      showModal({ title: 'Shortcut already in use', message: `That combination is assigned to ${conflict}. Choose a different shortcut.`, buttons: [{ text: 'OK', type: 'primary' }] });
      return;
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

  function createBookmarkDialog(titleText, messageText, returnFocusElement) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal bookmark-dialog';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const heading = document.createElement('h2');
    heading.className = 'modal-title';
    heading.id = `bookmarkDialogTitle-${Date.now()}`;
    heading.textContent = titleText;
    modal.setAttribute('aria-labelledby', heading.id);
    const header = document.createElement('div');
    header.className = 'modal-header';
    header.appendChild(heading);
    const body = document.createElement('div');
    body.className = 'modal-body';
    const message = document.createElement('p');
    message.className = 'modal-text';
    message.textContent = messageText;
    body.appendChild(message);
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    modal.append(header, body, actions);
    overlay.appendChild(modal);

    const close = () => {
      if (!overlay.isConnected) return;
      overlay.remove();
      if (returnFocusElement?.isConnected && returnFocusElement.getClientRects().length) returnFocusElement.focus();
    };
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay && modal.dataset.busy !== 'true') close();
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (modal.dataset.busy !== 'true') close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')]
        .filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    document.body.appendChild(overlay);
    return { overlay, modal, body, actions, close };
  }

  // Create modal dialog
  function showModal({ title, message, warning, variant, buttons }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      const errorTitle = /failed|invalid|could not|unable|error|incomplete/i.test(String(title || ''));
      const modalVariant = ['info', 'success', 'warning', 'error'].includes(variant)
        ? variant
        : warning
          ? 'warning'
          : errorTitle
            ? 'error'
            : 'info';
      const icons = {
        info: '<circle cx="12" cy="12" r="9"></circle><path d="M12 11v5"></path><path d="M12 7h.01"></path>',
        success: '<circle cx="12" cy="12" r="9"></circle><path d="m7.5 12 3 3 6-6"></path>',
        warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
        error: '<circle cx="12" cy="12" r="9"></circle><path d="m9 9 6 6"></path><path d="m15 9-6 6"></path>',
      };
      overlay.dataset.modalVariant = modalVariant;
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal-header">
            <div class="modal-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                ${icons[modalVariant]}
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

  let cognifyToastTimer;
  function showToast(message, type = 'info') {
    let toast = document.getElementById('cognifyToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'cognifyToast';
      toast.className = 'cognify-toast';
      toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
      toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
      document.body.appendChild(toast);
    }
    toast.dataset.type = type;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(cognifyToastTimer);
    cognifyToastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 6500);
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
                bookmarkCollections: CognifyBookmarkUtils.normalizeBookmarkCollections(bookmarkStorageData.bookmarkCollections),
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
    if (!globalThis.chrome?.storage?.local) return;
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

  // Load statistics on page load
  loadStatistics();

  // Kebab menu toggle for the YouTube panel actions
  ['ytKebab'].forEach(id => {
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
  // ── Export YouTube stats as CSV ───────────────────────────────────────────
  /**
   * Downloads the stored daily YouTube stats as a CSV file.
   */
  function exportStatsCSV() {
    chrome.storage.local.get(['statistics'], (data) => {
      const stats = data.statistics;
      if (!stats) {
        showModal({ title: 'No Data', message: 'No statistics found to export.', buttons: [{ text: 'OK', type: 'primary' }] });
        return;
      }
      const rows = [['Date', 'Videos', 'WatchTime(min)', 'AvgSpeed', 'TimeSaved(min)']];
      Object.entries(stats.dailyStats || {}).forEach(([d, v]) => {
        const avg = v.videos > 0 ? (v.totalSpeed / v.videos).toFixed(2) : (v.avgSpeed || 1).toFixed(2);
        rows.push([d, v.videos || 0, (v.watchTime || 0).toFixed(1), avg, (v.timeSaved || 0).toFixed(1)]);
      });
      // Wrap each cell in quotes and escape inner quotes for RFC 4180 compliance
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      a.download = `youtube_stats_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    });
  }

  // ── Full backup export ────────────────────────────────────────────────────
  const readStorageArea = area => new Promise((resolve, reject) => {
    area.get(null, data => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(data);
    });
  });

  const writeStorageArea = (area, data) => new Promise((resolve, reject) => {
    area.set(data, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });

  /** Exports sync and local extension data as a single JSON backup file. */
  async function exportFullBackup() {
    try {
      const [syncData, localData] = await Promise.all([
        readStorageArea(chrome.storage.sync),
        readStorageArea(chrome.storage.local),
      ]);
      const backup = { version: 1, date: new Date().toISOString(), sync: syncData, local: localData };
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `cognify_backup_${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      await showModal({
        title: 'Backup failed',
        message: `Could not create your backup: ${error.message}`,
        buttons: [{ text: 'OK', type: 'primary' }],
      });
    }
  }

  // ── Full backup import ────────────────────────────────────────────────────
  /** Validates and merges a backup into both sync and local storage. */
  async function importFullBackup(e) {
    const fileInput = e.target;
    const file = fileInput.files[0];
    if (!file) return;
    try {
      let text;
      try {
        text = await file.text();
      } catch (error) {
        await showModal({
          title: 'Could not read backup',
          message: `The selected file could not be read: ${error.message}`,
          buttons: [{ text: 'OK', type: 'primary' }],
        });
        return;
      }

      let backup;
      try {
        backup = JSON.parse(text);
      } catch {
        await showModal({
          title: 'Invalid Backup',
          message: 'This file is not valid JSON. Select a Cognify backup file.',
          buttons: [{ text: 'OK', type: 'primary' }],
        });
        return;
      }

      const isStorageData = value => value !== null && typeof value === 'object' && !Array.isArray(value);
      if (!isStorageData(backup) || backup.version !== 1 || !isStorageData(backup.sync) || !isStorageData(backup.local)) {
        await showModal({
          title: 'Invalid Backup',
          message: 'This file is not a supported Cognify backup.',
          buttons: [{ text: 'OK', type: 'primary' }],
        });
        return;
      }

      const syncKeys = Object.keys(backup.sync);
      const localKeys = Object.keys(backup.local);
      const bookmarkCount = new Set([...syncKeys, ...localKeys].filter(key => key.startsWith('yt_bm_'))).size;
      const dataCount = syncKeys.length + localKeys.length;
      const parsedDate = new Date(backup.date);
      const backupDate = Number.isNaN(parsedDate.getTime()) ? 'an unknown date' : parsedDate.toLocaleDateString();
      const confirmed = await showModal({
        title: 'Import Backup',
        message: `This backup from ${backupDate} contains ${bookmarkCount} bookmark entries and ${dataCount} saved values. Matching values will be replaced; data not included in the backup will be kept.`,
        warning: 'Review the backup before restoring. This action cannot be undone.',
        buttons: [{ text: 'Cancel', type: 'secondary' }, { text: 'Import', type: 'primary' }],
      });
      if (!confirmed) return;

      try {
        await writeStorageArea(chrome.storage.sync, backup.sync);
        await writeStorageArea(chrome.storage.local, backup.local);
      } catch (error) {
        await showModal({
          title: 'Restore incomplete',
          message: `Cognify could not finish restoring the backup: ${error.message}. Some data may already have been imported.`,
          buttons: [{ text: 'OK', type: 'primary' }],
        });
        return;
      }

      await showModal({
        title: 'Backup imported',
        message: 'Your backup was imported successfully. Cognify will reload to apply the restored settings.',
        buttons: [{ text: 'OK', type: 'primary' }],
      });
      window.location.reload();
    } finally {
      fileInput.value = '';
    }
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

  /** Persists screen time limit values; resets active sessions; briefly flashes the button green. */
  function saveScreenTimeLimits() {
    const el = id => document.getElementById(id);
    chrome.storage.sync.set({
      ytLimitEnabled: !!el('ytLimitEnabled')?.checked,
      ytDailyLimit:    parseInt(el('ytDailyLimit')?.value,  10) || 120,
    }, () => {
      // Reset the YouTube session state so the new limit takes effect immediately.
      chrome.storage.local.set({
        ytSessionBlocked: false, ytSessionStart: null,
      });
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
  if (globalThis.chrome?.storage?.sync) chrome.storage.sync.get(['ytLimitEnabled', 'ytDailyLimit'], (d) => {
    const el = id => document.getElementById(id);
    if (el('ytLimitEnabled')) { el('ytLimitEnabled').checked = !!d.ytLimitEnabled; applyLimitCardState('yt'); }
    if (el('ytDailyLimit'))   el('ytDailyLimit').value    = d.ytDailyLimit  || 120;
  });

  // Toggle-change: update card border, enable/disable input, and auto-save.
  document.getElementById('ytLimitEnabled')
    ?.addEventListener('change', () => {
      applyLimitCardState('yt');
      saveScreenTimeLimits();
    });

  // ── Additional feature event listeners ───────────────────────────────────
  document.getElementById('exportYtCsv')?.addEventListener('click', exportStatsCSV);
  document.getElementById('exportBackupBtn')?.addEventListener('click', exportFullBackup);
  document.getElementById('restoreBackupBtn')?.addEventListener('click', () => document.getElementById('restoreBackupFile')?.click());
  document.getElementById('restoreBackupFile')?.addEventListener('change', importFullBackup);
  document.getElementById('saveLimitsBtn')?.addEventListener('click', saveScreenTimeLimits);

  setInterval(loadStatistics, 30000);
});
