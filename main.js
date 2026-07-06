// ═══════════════════════════════════════════════════════════
//  dcheck — Electron Main Process
//  System tray app with embedded ping logger
// ═══════════════════════════════════════════════════════════

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, Notification } = require('electron');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── Globals (prevent GC) ──
let tray = null;
let mainWindow = null;
let pingInterval = null;

// ── Config ──
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const LOG_FILE = path.join(app.getPath('userData'), 'ping_log.jsonl');
const WINDOW_WIDTH = 420;
const WINDOW_HEIGHT = 640;
const WINDOW_MIN_WIDTH = 360;
const WINDOW_MIN_HEIGHT = 400;

let config = {
  openAtLogin: false,
  pingTarget: '8.8.8.8',
  pingIntervalSec: 5,
  highLatencyMs: 100
};

// ── Ping History (in-memory for current session) ──
let pingHistory = [];

// ── Settings Manager ──
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      config = { ...config, ...data };
    }
  } catch (e) {
    // Fail silently, use defaults
  }
}

function saveSettings(newSettings) {
  try {
    config = { ...config, ...newSettings };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(config, null, 2), 'utf-8');
    
    // Apply startup setting
    app.setLoginItemSettings({
      openAtLogin: config.openAtLogin,
      path: app.getPath('exe')
    });
    
    // Restart logger to apply changes
    startLogger();
  } catch (e) {
    // Fail silently
  }
}

// ═══════════════════════════════════════
//  APP LIFECYCLE
// ═══════════════════════════════════════

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      showWindow();
    }
  });
}

app.whenReady().then(() => {
  // Load settings config
  loadSettings();

  // Apply startup launch preference
  try {
    app.setLoginItemSettings({
      openAtLogin: config.openAtLogin,
      path: app.getPath('exe')
    });
  } catch (e) {
    // Silent fail if execution path issues
  }

  // Load existing log data
  loadHistory();

  // Create tray
  createTray();

  // Notify user that it is running in background (helpful after fresh install)
  if (Notification.isSupported()) {
    new Notification({
      title: 'dcheck is running',
      body: 'dcheck is monitoring your connection. Click the tray icon to view the dashboard.',
      icon: path.join(__dirname, 'icons', 'icon16.png')
    }).show();
  }

  // Start the ping logger
  startLogger();
});

app.on('window-all-closed', (e) => {
  // Don't quit when window closes — stay in tray
  e.preventDefault?.();
});

app.on('before-quit', () => {
  if (pingInterval) clearInterval(pingInterval);
});


// ═══════════════════════════════════════
//  SYSTEM TRAY
// ═══════════════════════════════════════

function createTray() {
  const iconPath = path.join(__dirname, 'icons', 'icon16.png');
  const icon = nativeImage.createFromPath(iconPath);

  tray = new Tray(icon);
  tray.setToolTip('dcheck — WiFi Monitor');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '[ SHOW ]',
      click: () => showWindow()
    },
    { type: 'separator' },
    {
      label: '[ QUIT ]',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  // Left-click opens the window
  tray.on('click', () => {
    showWindow();
  });
}


// ═══════════════════════════════════════
//  BROWSER WINDOW
// ═══════════════════════════════════════

function createWindow() {
  // Position near the system tray (bottom-right of screen)
  const display = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = display.workAreaSize;

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    x: screenW - WINDOW_WIDTH - 12,
    y: screenH - WINDOW_HEIGHT - 12,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    show: false,
    transparent: false,
    backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, 'icons', 'icon128.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  mainWindow.loadFile('index.html');

  // Hide instead of close
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Clean up reference on destroy
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
  }

  // Reposition near tray each time (in case resolution changed)
  const display = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = display.workAreaSize;
  mainWindow.setPosition(
    screenW - WINDOW_WIDTH - 12,
    screenH - WINDOW_HEIGHT - 12
  );

  mainWindow.show();
  mainWindow.focus();

  // Send current data to renderer
  sendDataToRenderer();
}


// ═══════════════════════════════════════
//  EMBEDDED PING LOGGER
// ═══════════════════════════════════════

function startLogger() {
  if (pingInterval) {
    clearInterval(pingInterval);
  }
  // Ping immediately, then every interval
  doPing();
  pingInterval = setInterval(doPing, config.pingIntervalSec * 1000);
}

function doPing() {
  const start = Date.now();
  const target = config.pingTarget || '8.8.8.8';

  // Windows ping command: -n 1 = one ping, -w 2000 = 2s timeout
  exec(`ping -n 1 -w 2000 ${target}`, (err, stdout) => {
    const ts = new Date().toISOString();
    let ms = -1;
    let status = 'TIMEOUT';

    if (!err && stdout) {
      // Parse Windows ping output for "time=XXms" or "time<1ms"
      const match = stdout.match(/time[=<](\d+)ms/i);
      if (match) {
        ms = parseInt(match[1], 10);
        status = ms >= config.highLatencyMs ? 'HIGH_LATENCY' : 'OK';
      }
    }

    const entry = { ts, ms, status };

    // Store in memory
    pingHistory.push(entry);

    // Persist to disk (append JSON line)
    try {
      fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (e) {
      // Silently fail — don't crash the app for a log write error
    }

    // Update tray tooltip with latest status
    updateTrayTooltip(entry);

    // Push to renderer if window is visible
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.webContents.send('ping-update', entry);
    }
  });
}

function updateTrayTooltip(entry) {
  if (!tray) return;

  const drops = pingHistory.filter(d => d.status === 'TIMEOUT').length;
  const uptime = pingHistory.length > 0
    ? (((pingHistory.length - drops) / pingHistory.length) * 100).toFixed(1)
    : '--';

  let statusText = entry.status === 'TIMEOUT'
    ? 'OFFLINE'
    : entry.status === 'HIGH_LATENCY'
      ? `${entry.ms}ms (HIGH)`
      : `${entry.ms}ms`;

  tray.setToolTip(`dcheck | ${statusText} | Uptime: ${uptime}% | Drops: ${drops}`);
}


// ═══════════════════════════════════════
//  IPC HANDLERS
// ═══════════════════════════════════════

ipcMain.handle('get-history', (event, rangeSec) => {
  if (rangeSec === 0 || !rangeSec) {
    return pingHistory;
  }

  const cutoff = new Date(Date.now() - rangeSec * 1000).toISOString().slice(0, 19);
  return pingHistory.filter(d => d.ts >= cutoff);
});

ipcMain.handle('get-stats', () => {
  const total = pingHistory.length;
  const drops = pingHistory.filter(d => d.status === 'TIMEOUT').length;
  const highLat = pingHistory.filter(d => d.status === 'HIGH_LATENCY').length;
  const uptime = total > 0 ? (((total - drops) / total) * 100).toFixed(2) : '--';
  const last = pingHistory[pingHistory.length - 1] || null;

  return { total, drops, highLat, uptime, last };
});

ipcMain.on('close-window', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.handle('get-settings', () => {
  return config;
});

ipcMain.handle('save-settings', (event, newSettings) => {
  saveSettings(newSettings);
  return { success: true };
});

ipcMain.handle('clear-history', () => {
  pingHistory = [];
  try {
    if (fs.existsSync(LOG_FILE)) {
      fs.writeFileSync(LOG_FILE, '', 'utf-8');
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

function sendDataToRenderer() {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('full-data', pingHistory);
  }
}


// ═══════════════════════════════════════
//  HISTORY PERSISTENCE
// ═══════════════════════════════════════

function loadHistory() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const raw = fs.readFileSync(LOG_FILE, 'utf-8');
      const lines = raw.trim().split('\n').filter(l => l.trim());
      pingHistory = lines.map(line => {
        try { return JSON.parse(line); }
        catch { return null; }
      }).filter(Boolean);

      // Keep only last 7 days of data to prevent unbounded growth
      const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const before = pingHistory.length;
      pingHistory = pingHistory.filter(d => {
        const timeMs = new Date(d.ts.endsWith('Z') || d.ts.includes('+') || d.ts.includes('-') ? d.ts : d.ts + 'Z').getTime();
        return timeMs >= cutoffMs;
      });

      // Rewrite file if we pruned entries
      if (pingHistory.length < before) {
        const pruned = pingHistory.map(d => JSON.stringify(d)).join('\n') + '\n';
        fs.writeFileSync(LOG_FILE, pruned, 'utf-8');
      }
    }
  } catch (e) {
    pingHistory = [];
  }
}
