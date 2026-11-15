# BLE Connection & Packet Suite

Full-stack Bluetooth Low Energy (BLE) connection request manager, real-time WebSocket packet inspector, and audited Rust + Angular implementation.

## Directory Structure

- **`bluetooth-packet-tracker/`** — Complete standalone Monolithic Rust + Modular Angular codebase with all bugs fixed:
  - **`bluetooth-packet-tracker/backend/`** — Monolithic Rust daemon (`btleplug` + `axum` + `tokio`)
  - **`bluetooth-packet-tracker/frontend/`** — Modular Angular 18 application (`CoreModule`, `SharedModule`, lazy-loaded `ConnectionManagerModule` & `PacketTrackerModule`)
  - **`bluetooth-packet-tracker/README.md`** — Standalone Rust + Angular architecture, API reference, and execution guide
  - **`bluetooth-packet-tracker/BUG_FIXES.md`** — Complete root-cause analysis and fix log for all 13 backend and frontend bugs
- **`server.ts` & `src/`** — Interactive web workbench running on port 3000 (`npm run dev`), providing a live Express + WebSocket BLE controller simulation (implementing the exact fixed `/api/health`, `/api/devices`, `/api/connection`, and `/ws/packets` contract), an optional Local Rust Daemon connection mode (`http://127.0.0.1:8080`), plus an integrated Architecture & Bug-Fix Explorer.

## Running the Live Interactive Workbench (Port 3000)

```bash
npm install
npm run dev
```

## Running the Standalone Rust + Angular Suite

See [`bluetooth-packet-tracker/README.md`](./bluetooth-packet-tracker/README.md) and [`bluetooth-packet-tracker/BUG_FIXES.md`](./bluetooth-packet-tracker/BUG_FIXES.md).
