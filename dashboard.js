// ═══════════════════════════════════════════════════════════
//  dcheck — Dashboard Renderer
//  Lightweight canvas graph + IPC data handling
// ═══════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── State ──
  let allData = [];
  let filteredData = [];
  
  // zoom/pan state
  let isLive = true;
  let currentSpanMs = 86400 * 1000; // 24H default
  let viewStartMs = 0;
  let viewEndMs = 0;
  
  let canvas, ctx;
  let isRendering = false;
  let hoverX = -1; // mouse X in CSS pixels, -1 = not hovering

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

    // Hover tracking on graph
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      hoverX = e.clientX - rect.left;
      render();
    });
    canvas.addEventListener('mouseleave', () => {
      hoverX = -1;
      isPanning = false; // Reset pan on leave
      render();
    });

    // Zoom (scroll wheel)
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!window._mapXInverse || filteredData.length === 0) return;
      
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const tHover = window._mapXInverse(px);
      
      const zoomFactor = e.deltaY > 0 ? 1.2 : 1/1.2;
      let newSpan = currentSpanMs * zoomFactor;
      newSpan = Math.max(60000, Math.min(newSpan, 30 * 24 * 3600 * 1000));
      
      const frac = (tHover - viewStartMs) / currentSpanMs;
      
      viewStartMs = tHover - frac * newSpan;
      viewEndMs = tHover + (1 - frac) * newSpan;
      currentSpanMs = newSpan;
      isLive = false;
      $('btn-live').classList.remove('active');
      
      applyFilter();
      render();
    });

    // Pan (click and drag)
    let isPanning = false;
    let lastPanX = 0;
    
    canvas.addEventListener('mousedown', (e) => {
      isPanning = true;
      lastPanX = e.clientX;
    });
    
    window.addEventListener('mousemove', (e) => {
      if (!isPanning || !window._mapXInverse || filteredData.length === 0) return;
      const dx = e.clientX - lastPanX;
      lastPanX = e.clientX;
      
      if (dx !== 0) {
        const rect = canvas.getBoundingClientRect();
        // Shift time opposite to mouse movement
        const shiftMs = -(dx / rect.width) * currentSpanMs;
        viewStartMs += shiftMs;
        viewEndMs += shiftMs;
        isLive = false;
        $('btn-live').classList.remove('active');
        
        applyFilter();
        render();
      }
    });
    
    window.addEventListener('mouseup', () => {
      isPanning = false;
    });

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

    $('btn-clear-logs').addEventListener('click', () => {
      if (confirm('Are you sure you want to clear all ping log history? This cannot be undone.')) {
        window.dcheck.clearHistory().then(res => {
          if (res.success) {
            allData = [];
            applyFilter();
            updateStats();
            updateEventLog();
            render();
            settingsOverlay.classList.remove('active');
          } else {
            alert('Failed to clear logs: ' + res.error);
          }
        });
      }
    });

    // Live button
    $('btn-live').addEventListener('click', () => {
      isLive = true;
      currentSpanMs = 86400 * 1000;
      $('btn-live').classList.add('active');
      applyFilter();
      render();
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
    if (allData.length === 0) {
      filteredData = [];
      return;
    }

    if (isLive) {
      const latestTs = parseTS(allData[allData.length - 1].ts);
      viewEndMs = latestTs + 60000; // 1 min padding for neatness
      viewStartMs = viewEndMs - currentSpanMs;
    }

    filteredData = allData.filter(d => {
      const t = parseTS(d.ts);
      return t >= viewStartMs && t <= viewEndMs;
    });
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

    // ── Y range ──
    const pings = filteredData.filter(d => d.ms > 0).map(d => d.ms);
    const maxPing = pings.length > 0 ? Math.max(...pings) : 200;
    const yMax = Math.max(maxPing * 1.2, 100);
    const mapY = (ms) => pY + pH - (Math.min(ms, yMax) / yMax) * pH;

    // ── Detect offline gaps (>30s between points = app was off) ──
    const GAP_THRESHOLD_MS = 30000;
    const GAP_SEPARATOR_W = 14; // fixed pixel width per gap separator

    // Build continuous segments
    const segments = [];
    let segStart = 0;
    for (let i = 1; i < filteredData.length; i++) {
      const prev = parseTS(filteredData[i - 1].ts);
      const curr = parseTS(filteredData[i].ts);
      if (curr - prev > GAP_THRESHOLD_MS) {
        segments.push({
          startIdx: segStart,
          endIdx: i - 1,
          startMs: parseTS(filteredData[segStart].ts),
          endMs: prev
        });
        segStart = i;
      }
    }
    segments.push({
      startIdx: segStart,
      endIdx: filteredData.length - 1,
      startMs: parseTS(filteredData[segStart].ts),
      endMs: parseTS(filteredData[filteredData.length - 1].ts)
    });

    const hasGaps = segments.length > 1;
    const totalGapWidth = (segments.length - 1) * GAP_SEPARATOR_W;
    const activeWidth = pW - totalGapWidth;
    const totalActiveTime = segments.reduce((sum, s) => sum + Math.max(s.endMs - s.startMs, 1), 0);

    // Compute pixel offsets for each segment
    let cumX = 0;
    for (const seg of segments) {
      seg.xStart = pX + cumX;
      const segDuration = Math.max(seg.endMs - seg.startMs, 1);
      seg.xWidth = (segDuration / totalActiveTime) * activeWidth;
      cumX += seg.xWidth + GAP_SEPARATOR_W;
    }

    // Collapsed mapX: timestamps map to their segment's pixel range
    const mapX = (ts) => {
      const t = parseTS(ts);
      for (const seg of segments) {
        if (t >= seg.startMs - 1 && t <= seg.endMs + 1) {
          const segDuration = Math.max(seg.endMs - seg.startMs, 1);
          const frac = (t - seg.startMs) / segDuration;
          return seg.xStart + frac * seg.xWidth;
        }
      }
      // Fallback: find nearest segment
      let best = segments[0];
      let bestDist = Infinity;
      for (const seg of segments) {
        const d = Math.min(Math.abs(t - seg.startMs), Math.abs(t - seg.endMs));
        if (d < bestDist) { bestDist = d; best = seg; }
      }
      const segDuration = Math.max(best.endMs - best.startMs, 1);
      const frac = Math.max(0, Math.min(1, (t - best.startMs) / segDuration));
      return best.xStart + frac * best.xWidth;
    };

    window._mapXInverse = (px) => {
      if (segments.length === 0) return Date.now();
      
      for (const seg of segments) {
        if (px >= seg.xStart && px <= seg.xStart + seg.xWidth) {
          const frac = (px - seg.xStart) / seg.xWidth;
          return seg.startMs + frac * (seg.endMs - seg.startMs);
        }
      }
      
      if (px < segments[0].xStart) return segments[0].startMs;
      const last = segments[segments.length - 1];
      if (px > last.xStart + last.xWidth) return last.endMs;
      
      for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        const nextSeg = segments[i + 1];
        if (px > seg.xStart + seg.xWidth && px < nextSeg.xStart) {
          return seg.endMs; 
        }
      }
      return Date.now();
    };

    // ── Draw grid (horizontal lines + Y labels) ──
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 3]);

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

    // ── Draw time labels per segment ──
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#444444';

    for (const seg of segments) {
      const segPixelW = seg.xWidth;
      // How many time labels can fit in this segment
      const labelCount = Math.max(1, Math.min(5, Math.floor(segPixelW / 50)));

      for (let i = 0; i <= labelCount; i++) {
        const frac = labelCount === 0 ? 0 : i / labelCount;
        const x = seg.xStart + frac * seg.xWidth;
        const t = seg.startMs + frac * (seg.endMs - seg.startMs);

        // Vertical grid line (skip first and last of each segment to avoid clutter at edges)
        if (i > 0 && i < labelCount) {
          ctx.strokeStyle = '#1a1a1a';
          ctx.lineWidth = 0.5;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(x, pY);
          ctx.lineTo(x, pY + pH);
          ctx.stroke();
        }

        const d = new Date(t);
        const label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        ctx.setLineDash([]);
        ctx.fillStyle = '#444444';
        ctx.fillText(label, x, pY + pH + 6);
      }
    }

    ctx.setLineDash([]);

    // ── 100ms threshold line ──
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

    // ── Draw gap separators ──
    if (hasGaps) {
      for (let s = 0; s < segments.length - 1; s++) {
        const seg = segments[s];
        const gapX = seg.xStart + seg.xWidth;
        const nextSeg = segments[s + 1];
        const gapDurationMs = nextSeg.startMs - seg.endMs;

        // Separator background
        ctx.fillStyle = 'rgba(30, 30, 30, 0.8)';
        ctx.fillRect(gapX, pY, GAP_SEPARATOR_W, pH);

        // Dashed border lines
        ctx.strokeStyle = '#222222';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(gapX, pY);
        ctx.lineTo(gapX, pY + pH);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(gapX + GAP_SEPARATOR_W, pY);
        ctx.lineTo(gapX + GAP_SEPARATOR_W, pY + pH);
        ctx.stroke();
        ctx.setLineDash([]);

        // Duration label (rotated vertically if enough height)
        const durationStr = formatDuration(gapDurationMs);
        ctx.save();
        ctx.translate(gapX + GAP_SEPARATOR_W / 2, pY + pH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#444444';
        ctx.font = '7px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(durationStr, 0, 0);
        ctx.restore();
      }
    }

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

    // ── Ping line (white) — break at disconnects AND offline gaps ──
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;

    for (let i = 0; i < filteredData.length; i++) {
      const d = filteredData[i];
      if (d.status === 'TIMEOUT') {
        if (started) ctx.stroke();
        ctx.beginPath();
        started = false;
        continue;
      }

      // Break the line if there's a gap before this point
      if (i > 0) {
        const prevMs = parseTS(filteredData[i - 1].ts);
        const currMs = parseTS(d.ts);
        if (currMs - prevMs > GAP_THRESHOLD_MS) {
          if (started) ctx.stroke();
          ctx.beginPath();
          started = false;
        }
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

    // ── Hover tooltip ──
    if (hoverX >= pX && hoverX <= pX + pW) {
      drawHoverTooltip(pX, pY, pW, pH, yMax, mapX, mapY);
    }
  }

  function drawEmpty(w, h) {
    ctx.fillStyle = '#333333';
    ctx.font = '11px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Waiting for ping data...', w / 2, h / 2);
  }

  function drawHoverTooltip(pX, pY, pW, pH, yMax, mapX, mapY) {
    if (filteredData.length === 0) return;

    // Find closest data point to hoverX
    let closest = null;
    let closestDist = Infinity;
    let closestX = 0;
    let closestY = 0;

    for (let i = 0; i < filteredData.length; i++) {
      const d = filteredData[i];
      const dx = mapX(d.ts);
      const dist = Math.abs(dx - hoverX);
      if (dist < closestDist) {
        closestDist = dist;
        closest = d;
        closestX = dx;
        closestY = d.status === 'TIMEOUT' ? pY + pH : mapY(d.ms);
      }
    }

    if (!closest || closestDist > 30) return;

    // ── Vertical crosshair ──
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(closestX, pY);
    ctx.lineTo(closestX, pY + pH);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Dot highlight ──
    let dotColor = '#ffffff';
    let statusLabel = 'OK';
    if (closest.status === 'TIMEOUT') {
      dotColor = '#ff2020';
      statusLabel = 'TIMEOUT';
    } else if (closest.status === 'HIGH_LATENCY') {
      dotColor = '#ff8c00';
      statusLabel = 'HIGH LAT';
    }

    // Outer glow ring
    let glowColor = 'rgba(255, 255, 255, 0.15)';
    if (closest.status === 'TIMEOUT') glowColor = 'rgba(255, 32, 32, 0.2)';
    else if (closest.status === 'HIGH_LATENCY') glowColor = 'rgba(255, 140, 0, 0.2)';
    ctx.fillStyle = glowColor;
    ctx.beginPath();
    ctx.arc(closestX, closestY, 8, 0, Math.PI * 2);
    ctx.fill();

    // Inner dot
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(closestX, closestY, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // ── Tooltip box ──
    const timeStr = formatTime(closest.ts);
    const pingStr = closest.status === 'TIMEOUT' ? 'TIMEOUT' : closest.ms + 'ms';
    const line1 = timeStr;
    const line2 = pingStr + (closest.status !== 'TIMEOUT' && closest.status !== 'OK' ? '  ' + statusLabel : '');

    ctx.font = '10px "Share Tech Mono", monospace';
    const line1W = ctx.measureText(line1).width;
    const line2W = ctx.measureText(line2).width;
    const boxW = Math.max(line1W, line2W) + 16;
    const boxH = 36;
    const margin = 10;

    // Position tooltip — flip sides if near edge
    let tipX = closestX + margin;
    let tipY = closestY - boxH - margin;

    const canvasW = canvas.width / (window.devicePixelRatio || 1);
    if (tipX + boxW > canvasW - PAD.right) {
      tipX = closestX - boxW - margin;
    }
    if (tipY < PAD.top) {
      tipY = closestY + margin;
    }

    // Box background
    ctx.fillStyle = 'rgba(17, 17, 17, 0.92)';
    ctx.beginPath();
    ctx.roundRect(tipX, tipY, boxW, boxH, 3);
    ctx.fill();

    // Box border
    ctx.strokeStyle = dotColor === '#ffffff' ? 'rgba(255,255,255,0.15)' : dotColor;
    ctx.globalAlpha = dotColor === '#ffffff' ? 1 : 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(tipX, tipY, boxW, boxH, 3);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Text line 1: timestamp
    ctx.fillStyle = '#666666';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(line1, tipX + 8, tipY + 6);

    // Text line 2: ping value
    ctx.fillStyle = dotColor;
    ctx.fillText(line2, tipX + 8, tipY + 20);

    ctx.restore();
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

  function formatDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm';
    return totalSec + 's';
  }


  // ══════════════════════════════════════
  //  BOOT
  // ══════════════════════════════════════

  document.addEventListener('DOMContentLoaded', init);

})();
