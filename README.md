# dcheck

A sleek, lightweight Windows system tray application that monitors network latency and stability. **dcheck** (Disconnect Check) runs silently in the background, executing pings, and visualizes network dropouts and high latency spikes via a custom HTML5 canvas dashboard. 

Designed to be unobtrusive, performant, and visual-first, it is perfect for debugging spotty WiFi connections or ISP dropouts.

---

## Key Features

- **System Tray Native**: Minimizes to the Windows system tray with a dynamic tooltip displaying real-time ping stats, uptime, and disconnects. Includes single-instance locking.
- **Real-time Canvas Graph**: High-performance rendering of ping responses, connection timeouts (marked in glowing red vertical bars), and high-latency alerts (marked in amber).
- **Customizable Configuration**:
  - **Launch on Startup**: Enable or disable automatic startup with Windows.
  - **Ping Target**: Target any IP address or domain (defaults to `8.8.8.8`).
  - **Ping Interval**: Adjust checking frequency dynamically (1s to 60s).
  - **Latency Warning Threshold**: Highlight latency spikes based on your custom threshold.
- **Filterable History**: Switch between `1H`, `6H`, `24H`, or `ALL` log filters instantly.
- **No-Database Persistence**: Saves logs locally using a zero-overhead JSON Lines (`.jsonl`) file in the application's user directory. Rotates/prunes entries older than 7 days automatically.
- **Premium Aesthetics**: Monospaced typography, dark glassmorphism styling, and responsive layout scaling.

---

## Technical Stack & Architecture

- **Core Framework**: [Electron](https://www.electronjs.org/) (Main process & context-isolated Renderer process)
- **Frontend**: Vanilla HTML5, Canvas API, and CSS Custom Properties (Variables)
- **Backend/System APIs**: Node.js `child_process` (for OS-level ICMP pings) and `fs` (for JSON Lines logging)
- **Security**: Strict `contextIsolation: true` with a secure Preload Bridge (`preload.js`), exposing only explicit IPC channels.

```
┌────────────────────────────────────────────────────────┐
│                    Electron Main                       │
│    (Ping loop, settings.json, ping_log.jsonl, tray)    │
└───────────────▲────────────────────────▲───────────────┘
                │ IPC                    │ IPC
┌───────────────▼────────────────────────▼───────────────┐
│                    Preload Bridge                      │
│                  (Secure API Exposer)                  │
└───────────────▲────────────────────────▲───────────────┘
                │ Safe Call              │ Safe Call
┌───────────────▼────────────────────────▼───────────────┐
│                   Renderer Process                     │
│        (HTML5 Canvas, Dashboard UI, CSS Theme)         │
└────────────────────────────────────────────────────────┘
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- Windows OS (designed for native Windows `ping` utility outputs)

### Setup & Run Locally

1. **Clone the repository**:
   ```bash
   git clone https://github.com/brucelsprouts/dcheck.git
   cd dcheck
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the application**:
   ```bash
   npm start
   ```
   *The application will initialize, start pinging in the background, and display the tray icon. Left-click the tray icon to open the dashboard.*

### Packaging the Application

To build a standalone production installer (`.exe`) using `electron-builder`:

```bash
npm run build
```
The compiled installer will be outputted to the `dist/` directory.

---

## Settings Customization

Click the **gear icon (`⚙`)** in the window's top right corner to open the Settings panel:

1. **Run on Startup**: Automatically register the app in the Windows startup registry.
2. **Ping Target**: Set to `8.8.8.8` (Google DNS), `1.1.1.1` (Cloudflare), or any local gateway IP.
3. **Ping Interval**: Frequencies between 1 and 60 seconds.
4. **Latency Threshold**: Highlight packets exceeding your benchmark (e.g., `100ms`).

---

## Local Logs Location

Logs are stored locally without database dependencies. You can find them under:
`%APPDATA%\dcheck\ping_log.jsonl`

Settings are persisted in:
`%APPDATA%\dcheck\settings.json`
