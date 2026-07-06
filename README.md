# dcheck

I moved back home from uni and the wifi was really bad and kept disconnecting, so for fun I was curious to see how often I disconnected. Here it is.

**dcheck** (Disconnect Check) is a sleek, lightweight Windows system tray application that monitors your network latency and stability, logging dropouts and rendering them on a live canvas graph.

---

## 🚀 Download & Install

You don't need to build it yourself! Just download the pre-compiled installer and run it:

👉 **[Download dcheck_setup.exe](https://github.com/brucelsprouts/dcheck/raw/main/release/dcheck_setup.exe)**

---

## Features

- **System Tray Native**: Runs silently in the background. Left-click the tray icon to open the dashboard.
- **Real-Time Graph**: Visualizes ping times, timeout dropouts (marked in red), and high latency segments (marked in amber).
- **Settings Panel**: Click the gear (`⚙`) to:
  - Toggle **Run on Startup**
  - Set a custom **Ping Target** (e.g. `1.1.1.1` or `8.8.8.8`)
  - Adjust **Ping Interval** and **Latency Threshold**
  - **Clear Logs** if you want to wipe the history.
- **Zero-DB Logging**: Saves logs locally to a simple `.jsonl` file in your AppData directory.

---

## Quick Start

1. **Clone & install**:
   ```bash
   git clone https://github.com/brucelsprouts/dcheck.git
   cd dcheck
   npm install
   ```

2. **Run it**:
   ```bash
   npm start
   ```

3. **Build the installer**:
   ```bash
   npm run build
   ```
   *Creates a standalone installer setup `.exe` in the `dist/` directory.*
