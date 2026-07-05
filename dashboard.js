// ═══════════════════════════════════════════════════════════
//  dcheck — Dashboard Renderer
//  Lightweight canvas graph + IPC data handling
// ═══════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── State ──
  let allData = [];
  let filteredData = [];
  let activeRange = 86400; // 24H default
  let canvas, ctx;
  let isRendering = false;

  // ── DOM ──
  const $ = (id) => document.getElementById(id);

  // ── Graph padding ──
  const PAD = { top: 16, right: 12, bottom: 28, left: 44 };

  // ══════════════════════════════════════
  //  INIT
  // ══════════════════════════════════════

  function init() {
    canvas = $('graph');
    ctx = canvas.getContext('2d');

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Close button
    $('btn-close').addEventListener('click', () => {
      window.dcheck.closeWindow();
    });

    // Settings panel toggles and action handlers
    const settingsOverlay = $('settings-overlay');

    $('btn-settings').addEventListener('click', () => {
      window.dcheck.getSettings().then(cfg => {
        $('setting-startup').checked = cfg.openAtLogin;
        $('setting-target').value = cfg.pingTarget;
        $('setting-interval').value = cfg.pingIntervalSec;
        $('setting-latency').value = cfg.highLatencyMs;
        settingsOverlay.classList.add('active');
      });
    });

    $('btn-cancel-settings').addEventListener('click', () => {
      settingsOverlay.classList.remove('active');
    });

    $('btn-save-settings').addEventListener('click', () => {
      const openAtLogin = $('setting-startup').checked;
      const pingTarget = $('setting-target').value.trim();
      const pingIntervalSec = parseInt($('setting-interval').value, 10);
      const highLatencyMs = parseInt($('setting-latency').value, 10);

      if (!pingTarget) {
        alert('Ping target cannot be empty.');
        return;
      }
      if (isNaN(pingIntervalSec) || pingIntervalSec < 1 || pingIntervalSec > 60) {
        alert('Interval must be between 1 and 60 seconds.');
        return;
      }
      if (isNaN(highLatencyMs) || highLatencyMs < 10 || highLatencyMs > 2000) {
        alert('Latency threshold must be between 10 and 2000 ms.');
        return;
      }

      window.dcheck.saveSettings({
        openAtLogin,
        pingTarget,
        pingIntervalSec,
        highLatencyMs
      }).then(res => {
        if (res.success) {
          settingsOverlay.classList.remove('active');
        }
      });
    });

    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeRange = parseInt(btn.dataset.range);
        applyFilter();
        render();
      });
    });

    // IPC: receive full data when window opens
    window.dcheck.onFullData((data) => {
      allData = data;
      applyFilter();
      updateStats();
      updateEventLog();
      render();
    });

    // IPC: receive live ping updates
    window.dcheck.onPingUpdate((entry) => {
      allData.push(entry);
      applyFilter();
      updateStats();
      updateEventLog();
      render();
    });

    // Request initial data
    window.dcheck.getHistory(0).then(data => {
      allData = data;
      applyFilter();
      updateStats();
      updateEventLog();
      render();
    });

    // Draw empty state
    render();
  }


  // ══════════════════════════════════════
  //  FILTERING
  // ══════════════════════════════════════

  function applyFilter() {
    if (activeRange === 0 || allData.length === 0) {
      filteredData = allData;
      return;
    }
    const cutoffMs = Date.now() - activeRange * 1000;
    filteredData = allData.filter(d => parseTS(d.ts) >= cutoffMs);
  }


  // ══════════════════════════════════════
  //  STATS
  // ══════════════════════════════════════

  function updateStats() {
    window.dcheck.getStats().then(stats => {
      // Current ping
      const pingEl = $('stat-ping');
      if (stats.last) {
        if (stats.last.status === 'TIMEOUT') {
          pingEl.textContent = 'DOWN';
          pingEl.className = 'stat-value stat-down';
        } else if (stats.last.status === 'HIGH_LATENCY') {
          pingEl.textContent = stats.last.ms + 'ms';
          pingEl.className = 'stat-value stat-warn';
        } else {
          pingEl.textContent = stats.last.ms + 'ms';
          pingEl.className = 'stat-value stat-ok';
        }
      }

      // Drops
      const dropsEl = $('stat-drops');
      dropsEl.textContent = stats.drops;
      dropsEl.className = stats.drops > 0 ? 'stat-value stat-alert' : 'stat-value stat-ok';

      // Uptime
      $('stat-uptime').textContent = stats.uptime + '%';

      // Total
      $('stat-total').textContent = stats.total.toLocaleString();

      // Status dot + text
      const dot = $('status-dot');
      const text = $('status-text');
      if (stats.last) {
        if (stats.last.status === 'TIMEOUT') {
          dot.className = 'status-dot offline';
          text.textContent = 'OFFLINE';
        } else if (stats.last.status === 'HIGH_LATENCY') {
          dot.className = 'status-dot degraded';
          text.textContent = 'DEGRADED';
        } else {
          dot.className = 'status-dot online';
          text.textContent = 'ONLINE';
        }
      }
    });
  }


  // ══════════════════════════════════════
  //  EVENT LOG
  // ══════════════════════════════════════

  function updateEventLog() {
    const events = allData.filter(d => d.status === 'TIMEOUT' || d.status === 'HIGH_LATENCY');
    const container = $('event-entries');
    const countEl = $('event-count');

    countEl.textContent = events.length;

    if (events.length === 0) {
      container.innerHTML = '<div class="event-empty">No disconnect events</div>';
      return;
    }

    // Show last 10, newest first
    const recent = events.slice(-10).reverse();
    container.innerHTML = recent.map(e => {
      const badge = e.status === 'TIMEOUT'
        ? '<span class="event-badge timeout">TIMEOUT</span>'
        : '<span class="event-badge high-lat">HIGH LAT</span>';
      const msg = e.status === 'TIMEOUT'
        ? 'No response'
        : e.ms + 'ms';
      return `<div class="event-entry">
        <span class="event-ts">${formatTime(e.ts)}</span>
        ${badge}
        <span class="event-msg">${msg}</span>
      </div>`;
    }).join('');
  }


  // ══════════════════════════════════════
  //  CANVAS GRAPH
  // ══════════════════════════════════════

  function resizeCanvas() {
    const wrap = $('graph-wrap');
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    render();
  }

  function render() {
    if (isRendering) return;
    isRendering = true;
    requestAnimationFrame(() => {
      drawGraph();
      isRendering = false;
    });
  }

  function drawGraph() {
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);

    // Black background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    const pX = PAD.left;
    const pY = PAD.top;
    const pW = w - PAD.left - PAD.right;
    const pH = h - PAD.top - PAD.bottom;

    if (filteredData.length === 0) {
      drawEmpty(w, h);
      return;
    }

    // Time range
    const tMin = parseTS(filteredData[0].ts);
    const tMax = parseTS(filteredData[filteredData.length - 1].ts);
    const tSpan = Math.max(tMax - tMin, 1000);

    // Y range
    const pings = filteredData.filter(d => d.ms > 0).map(d => d.ms);
    const maxPing = pings.length > 0 ? Math.max(...pings) : 200;
    const yMax = Math.max(maxPing * 1.2, 100);

    const mapX = (ts) => pX + ((parseTS(ts) - tMin) / tSpan) * pW;
    const mapY = (ms) => pY + pH - (Math.min(ms, yMax) / yMax) * pH;

    // ── Gridlines ──
    drawGrid(pX, pY, pW, pH, yMax, tMin, tSpan);

    // ── Disconnect bars (red) ──
    for (let i = 0; i < filteredData.length; i++) {
      const d = filteredData[i];
      if (d.status === 'TIMEOUT') {
        const x = mapX(d.ts);
        ctx.strokeStyle = 'rgba(255, 32, 32, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, pY);
        ctx.lineTo(x, pY + pH);
        ctx.stroke();

        // Glow
        ctx.strokeStyle = 'rgba(255, 32, 32, 0.15)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(x, pY);
        ctx.lineTo(x, pY + pH);
        ctx.stroke();
      }
    }

    // ── Ping line (white) ──
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;

    for (let i = 0; i < filteredData.length; i++) {
      const d = filteredData[i];
      if (d.status === 'TIMEOUT') {
        // Break the line at disconnects
        if (started) ctx.stroke();
        ctx.beginPath();
        started = false;
        continue;
      }
      const x = mapX(d.ts);
      const y = mapY(d.ms);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    if (started) ctx.stroke();

    // ── High latency segments (amber) ──
    for (let i = 0; i < filteredData.length; i++) {
      const d = filteredData[i];
      if (d.status === 'HIGH_LATENCY') {
        const x = mapX(d.ts);
        const y = mapY(d.ms);

        // Small amber dot
        ctx.fillStyle = '#ff8c00';
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── Axes ──
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pX, pY);
    ctx.lineTo(pX, pY + pH);
    ctx.lineTo(pX + pW, pY + pH);
    ctx.stroke();
  }

  function drawEmpty(w, h) {
    ctx.fillStyle = '#333333';
    ctx.font = '11px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Waiting for ping data...', w / 2, h / 2);
  }

  function drawGrid(pX, pY, pW, pH, yMax, tMin, tSpan) {
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 3]);

    // Horizontal grid + Y labels
    const ySteps = 4;
    const yInterval = yMax / ySteps;
    ctx.fillStyle = '#444444';
    ctx.font = '9px "Share Tech Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= ySteps; i++) {
      const val = Math.round(i * yInterval);
      const y = pY + pH - (val / yMax) * pH;

      if (i > 0) {
        ctx.beginPath();
        ctx.moveTo(pX, y);
        ctx.lineTo(pX + pW, y);
        ctx.stroke();
      }
      ctx.fillText(val + '', pX - 4, y);
    }

    // Vertical grid + time labels
    const xSteps = Math.min(6, Math.max(3, Math.floor(pW / 60)));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (let i = 0; i <= xSteps; i++) {
      const t = tMin + (i / xSteps) * tSpan;
      const x = pX + (i / xSteps) * pW;

      if (i > 0 && i < xSteps) {
        ctx.beginPath();
        ctx.moveTo(x, pY);
        ctx.lineTo(x, pY + pH);
        ctx.stroke();
      }

      const d = new Date(t);
      const label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      ctx.fillText(label, x, pY + pH + 6);
    }

    ctx.setLineDash([]);

    // 100ms threshold line
    if (100 < yMax) {
      const threshY = pY + pH - (100 / yMax) * pH;
      ctx.strokeStyle = 'rgba(255, 140, 0, 0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pX, threshY);
      ctx.lineTo(pX + pW, threshY);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }


  // ══════════════════════════════════════
  //  UTIL
  // ══════════════════════════════════════

  function parseTS(ts) {
    if (typeof ts === 'string' && !ts.endsWith('Z') && !ts.includes('+') && !ts.includes('-') && ts.length === 19) {
      return new Date(ts + 'Z').getTime();
    }
    return new Date(ts).getTime();
  }

  function formatTime(ts) {
    const d = new Date(parseTS(ts));
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }


  // ══════════════════════════════════════
  //  BOOT
  // ══════════════════════════════════════

  document.addEventListener('DOMContentLoaded', init);

})();
