# Bluetooth Connection Request & Packet Tracker Application

A full-stack Bluetooth Low Energy (BLE) management and packet inspection suite combining a **Monolithic Rust Backend** (`btleplug` + `axum` + `tokio`) with a **Modular Angular Frontend** (partitioned into `CoreModule`, `SharedModule`, and lazy-loaded feature modules `ConnectionManagerModule` and `PacketTrackerModule`).

---

## 1. System Architecture & Data Flow

```text
+-----------------------------------------------------------------------------------+
|                        MODULAR ANGULAR FRONTEND (Port 4200)                       |
|                                                                                   |
|  +---------------------------+     +-------------------------------------------+  |
|  | ConnectionManagerModule   |     | PacketTrackerModule                       |  |
|  | - Device Discovery Grid   |     | - Live Advertising & Handshake Sniffer    |  |
|  | - GATT Connect/Disconnect |     | - Hex Payload & RSSI Telemetry Inspector  |  |
|  +-------------+-------------+     +---------------------+---------------------+  |
|                |                                         ^                        |
|                | HTTP POST /api/connection               | WebSocket Stream       |
|                v                                         | ws://.../ws/packets    |
|  +-----------------------------------------------------------------------------+  |
|  | CoreModule (BluetoothApiService - Singleton State & WebSocket Multiplexer)  |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                        MONOLITHIC RUST BACKEND (Port 8080)                        |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | Axum HTTP & WebSocket Router (/api/health, /api/devices, /api/connection)   |  |
|  +--------------------------------------+--------------------------------------+  |
|                                         |                                         |
|  +--------------------------------------v--------------------------------------+  |
|  | Shared Application State (Arc<AppState> with RwLock & Broadcast Channel)    |  |
|  +--------------------------------------+--------------------------------------+  |
|                                         |                                         |
|  +--------------------------------------v--------------------------------------+  |
|  | BLE Packet & Connection Engine (btleplug Central, GATT Client & Event Loop) |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
                        [ Host Bluetooth 4.0+ / 5.x Hardware ]
```

---

## 2. Folder Layout

```text
bluetooth-packet-tracker/
├── README.md                                     # Application documentation & bug-fix summary
├── BUG_FIXES.md                                  # Detailed root-cause & patch reference
├── backend/                                      # Monolithic Rust Daemon
│   ├── Cargo.toml                                # Rust dependencies & binary metadata
│   └── src/
│       └── main.rs                               # Axum server, BLE engine, state & WS loop
└── frontend/                                     # Modular Angular 18 Application
    ├── angular.json                              # Angular CLI workspace configuration
    ├── package.json                              # NPM dependencies & build scripts
    ├── proxy.conf.json                           # Dev proxy for /api and /ws
    ├── tsconfig.json                             # Base TypeScript configuration
    ├── tsconfig.app.json                         # App TypeScript configuration
    └── src/
        ├── index.html                            # HTML entry document
        ├── main.ts                               # Platform browser bootstrap
        ├── styles.css                            # Dark-theme global stylesheet
        └── app/
            ├── core/                             # Singleton services & HTTP interceptor
            │   ├── interceptors/http-error.interceptor.ts
            │   ├── models/bluetooth.model.ts
            │   ├── services/bluetooth-api.service.ts
            │   └── core.module.ts
            ├── shared/                           # Reusable badges, indicators & pipes
            │   ├── components/rssi-badge/rssi-badge.component.ts
            │   ├── components/status-indicator/status-indicator.component.ts
            │   ├── pipes/hex-format.pipe.ts
            │   └── shared.module.ts
            ├── features/                         # Lazy-loaded domain modules
            │   ├── connection-manager/
            │   │   ├── components/device-card/device-card.component.ts
            │   │   ├── connection-manager.component.ts
            │   │   └── connection-manager.module.ts
            │   └── packet-tracker/
            │       ├── components/packet-filter/packet-filter.component.ts
            │       ├── packet-tracker.component.ts
            │       └── packet-tracker.module.ts
            ├── app-routing.module.ts
            ├── app.component.ts
            └── app.module.ts
```

---

## 3. REST & WebSocket API Specification

| Method / Protocol | Endpoint | Request Payload | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | None | Returns daemon operational status, adapter info, cached device count, and active connection count. |
| `GET` | `/api/devices` | None | Returns a RSSI-sorted JSON array of cached `PacketTelemetry` peripherals. |
| `POST` | `/api/connection` | `{ "device_id": "...", "action": "CONNECT" \| "DISCONNECT" }` | Initiates or terminates a GATT connection handshake with the target peripheral. |
| `WS` | `/ws/packets` | Stream | Emits `PacketTelemetry` JSON frames (`ADV_IND`, `CONN_REQ_SENT`, `CONN_ESTABLISHED`, `CONN_TERMINATED`, `CONN_FAILED`). |

---

## 4. Build & Execution Guide

### 4.1 Running the Monolithic Rust Backend

1. Ensure Bluetooth is enabled on your host operating system.
2. Navigate to `backend/` and start the daemon:

```bash
cd bluetooth-packet-tracker/backend
cargo run --release
```

Optional environment variables: `HOST` (default `127.0.0.1`) and `PORT` (default `8080`).

### 4.2 Running the Modular Angular Frontend

1. Open a second terminal and navigate to `frontend/`:

```bash
cd bluetooth-packet-tracker/frontend
npm install
npx ng serve --open
```

2. Open `http://localhost:4200`:
   - **Connection Requests (`/connections`)**: Inspect discovered peripherals, RSSI proximity, and discovered GATT service UUIDs; send `CONNECT` / `DISCONNECT` requests.
   - **Packet Stream (`/packets`)**: Inspect live `ADV_IND` and GATT handshake packets, pause/resume the stream, and filter by name, MAC address, packet type, or hex payload.

---

## 5. Summary of Bugs Fixed

All critical race conditions, state-machine bugs, WebSocket disconnects, and Angular UI/memory leaks present in the initial draft have been fixed across both folders (see `BUG_FIXES.md` for complete code-level explanations):

### Rust Backend Fixes (`backend/src/main.rs`)
1. **BUG-BE-01 — Scan Updates Overwriting Device Names & Connection States**: `DeviceUpdated` events with partial scan-response properties no longer overwrite previously discovered `device_name` values with `"Unnamed Peripheral"`, and active `CONN_ESTABLISHED` states are preserved while connected. Invalid BLE HCI RSSI values (`127` / `0x7F`) are sanitized.
2. **BUG-BE-02 — Duplicate `CONN_ESTABLISHED` & Dropped Early Connection Events**: Added `pending_handshakes` tracking to suppress premature `CentralEvent::DeviceConnected` broadcasts while `discover_services()` is still executing, and updated `broadcast_state_packet` to upsert missing peripherals instead of dropping events.
3. **BUG-BE-03 — Stuck `CONN_REQ_SENT` State & Concurrent Handshake Race**: Added per-device concurrency guards (`409 Conflict` on overlapping requests), idempotent `is_connected()` pre-checks on `CONNECT`/`DISCONNECT`, error logging for `discover_services()`, and `CONN_FAILED` telemetry broadcasts whenever a handshake rejects or times out.
4. **BUG-BE-04 — Non-Deterministic / Incomplete AD Payload Hex**: Replaced unordered `HashMap` byte dumping with deterministic `BTreeMap` ordering and proper BLE Advertising Data `[Length, AD Type, Data...]` framing (`0x01` Flags, `0xFF` Manufacturer Data, `0x21` Service Data, `0x09` Complete Local Name).
5. **BUG-BE-05 — WebSocket `Lagged` Crash & Half-Open Socket Leaks**: Switched `handle_ws_client` to split sink/stream with `tokio::select!`, handling `RecvError::Lagged` without closing the WebSocket and answering client `Ping`/`Close` frames cleanly.
6. **BUG-BE-06 — Hardcoded Bind & Non-Resilient Scan Loop**: Added `HOST`/`PORT` env configuration, automatic scanner recovery on transient stream termination, and clean `Ctrl+C` scan shutdown.

### Angular Frontend Fixes (`frontend/src/app/`)
1. **BUG-FE-01 — `loadInitialDevices()` Race Condition & Missing Sort/Error Handling**: Added timestamp comparison in `upsertDevice()` so stale HTTP snapshots never overwrite newer WebSocket packets, sorted initial results by RSSI descending, pruned stale cache entries on manual sync, and added HTTP error handling (`lastError$`).
2. **BUG-FE-02 — WebSocket Reconnect Timer Leak & Uncaught `JSON.parse`**: Guarded `initWebSocket()` against parallel reconnect timers, wrapped `new WebSocket()` and `JSON.parse()` in `try/catch`, cleaned up socket event handlers before reconnecting, and implemented `ngOnDestroy()`.
3. **BUG-FE-03 — Missing `trackBy` Causing DOM Thrashing**: Added `trackByDeviceId`, `trackByUuid`, and `trackByPacketId` across `*ngFor` loops so streaming BLE updates patch existing nodes instead of destroying buttons mid-click.
4. **BUG-FE-04 — Packet History Wiped on Navigation & Local Time Displayed as UTC**: Moved the 250-packet ring buffer into singleton `BluetoothApiService` so switching between `/connections` and `/packets` preserves logs, and updated the Angular `date` pipe to `date:'HH:mm:ss.SSS':'UTC'`.
5. **BUG-FE-05 — Single `loadingId` Overwrite & Subscription Leak**: Replaced `loadingId: string | null` with `loadingIds: Set<string>` for independent per-device loading states and added `takeUntil(this.destroy$)` teardown.
6. **BUG-FE-06 — `HexFormatPipe` Non-Hex Fallback & `RssiBadgeComponent` `127 dBm` Bug**: Fixed `HexFormatPipe` to normalize odd-length nibbles and return `'00'` on non-hex/empty strings, and taught `RssiBadgeComponent` to recognize BLE HCI `127` (`0x7F`) as `N/A • Unknown` instead of green `"Immediate"`.
7. **BUG-FE-07 — Deprecated `HttpClientModule`, Hex Search Normalization & Empty States**: Migrated `CoreModule` to Angular 18 `provideHttpClient(withInterceptorsFromDi())`, added space-insensitive hex filtering + Reset button in `PacketFilterComponent`, and added empty-state views.
