# Detailed Bug Audit & Fix Reference

This document catalogs every defect identified in the initial Bluetooth Connection Request & Packet Tracker specification (both the Monolithic Rust Backend and Modular Angular Frontend) along with the exact root cause and fix implemented.

---

## Part A: Monolithic Rust Backend (`backend/src/main.rs`)

### BUG-BE-01: `DeviceUpdated` Overwrites Device Names, Active Connections, and Invalid RSSI
- **Location:** `run_ble_packet_engine()` -> `CentralEvent::DeviceDiscovered | CentralEvent::DeviceUpdated`
- **Root Cause:** Every scan-response or advertisement update created a fresh `PacketTelemetry` struct with `packet_type: "ADV_IND"` and `p.local_name.unwrap_or_else(|| "Unnamed Peripheral")`, unconditionally overwriting `tracked_devices`. When a peripheral omitted its Local Name in a follow-up scan response, its real name was erased. Additionally, connected devices had their `CONN_ESTABLISHED` status overwritten, and BLE HCI sentinel `127` (`0x7F` = RSSI unavailable) was accepted as a valid ultra-strong signal.
- **Fix Implemented:** Added `extract_peripheral_snapshot()` and `sanitize_rssi()`. Incoming updates merge with the cached entry in `tracked_devices`, preserving non-placeholder `device_name`, `gatt_services`, and active `CONN_ESTABLISHED` packet type when `is_connected` is true, and rejecting RSSI values outside `-127..=20`.

### BUG-BE-02: Duplicate `CONN_ESTABLISHED` Events & Silently Dropped State Transitions
- **Location:** `run_ble_packet_engine()` (`CentralEvent::DeviceConnected`) & `broadcast_state_packet()`
- **Root Cause:** When `/api/connection` initiated `CONNECT`, `peripheral.connect()` triggered `CentralEvent::DeviceConnected` asynchronously on the central event stream *and* `handle_connection_request` also emitted `CONN_ESTABLISHED` after `discover_services()`. Clients received duplicate events (often one with `gatt_services: []`). Furthermore, `broadcast_state_packet` used `devices.get_mut(device_id)`, silently dropping events if the device was not yet in `tracked_devices`.
- **Fix Implemented:** Added `pending_handshakes: RwLock<HashSet<String>>` in `AppState` so `CentralEvent::DeviceConnected` skips emitting a premature `CONN_ESTABLISHED` while an API-driven handshake is discovering GATT services. Updated `broadcast_state_packet` to upsert a snapshot from the adapter when missing.

### BUG-BE-03: Stuck `CONN_REQ_SENT` State on Timeout/Error, Concurrent Handshakes, & Ignored GATT Errors
- **Location:** `handle_connection_request()`
- **Root Cause:**
  1. Emitted `CONN_REQ_SENT` before `peripheral.connect()`, but emitted nothing on rejection or 10s timeout—leaving clients permanently stuck in `HANDSHAKING` / `CONN_REQ_SENT`.
  2. Allowed concurrent `CONNECT`/`DISCONNECT` calls for the same `device_id`.
  3. Did not check `peripheral.is_connected()` prior to `CONNECT` or `DISCONNECT` (causing errors on idempotent calls).
  4. Ignored `peripheral.discover_services().await` failures via `let _ = ...`.
- **Fix Implemented:** Enforced per-device mutex via `pending_handshakes` (returning `409 Conflict` on overlap), added `is_connected()` pre-checks, logged `discover_services()` errors, and broadcast `CONN_FAILED` telemetry whenever `connect()` fails or times out.

### BUG-BE-04: Non-Deterministic & Incomplete BLE AD Payload Hex Construction
- **Location:** `build_ad_payload_hex()` (previously inline in `run_ble_packet_engine`)
- **Root Cause:** Iterating `HashMap<u16, Vec<u8>>` produced non-deterministic hex order across runs, omitted BLE AD length/type framing (`0xFF` / `0x21` / `0x09`), and discarded `service_data` whenever `manufacturer_data` was present.
- **Fix Implemented:** Extracted deterministic `build_ad_payload_hex()` using `BTreeMap` ordering and valid BLE Core Specification AD structure framing (`02 01 06` flags + `0xFF` Manufacturer Specific Data + `0x21` Service Data + `0x09` Complete Local Name).

### BUG-BE-05: WebSocket Stream Dies on `RecvError::Lagged` & Leaks Half-Open Connections
- **Location:** `handle_ws_client()`
- **Root Cause:** `while let Ok(packet) = rx.recv().await` exited immediately on `Err(RecvError::Lagged(n))`, terminating healthy WebSocket clients during advertisement bursts. It also never read incoming WebSocket control frames (`Close`/`Ping`).
- **Fix Implemented:** Split the WebSocket with `socket.split()` and used `tokio::select!` to simultaneously handle `rx.recv()` (continuing past `RecvError::Lagged`) and incoming `Close`/`Ping` frames. Increased broadcast capacity from `512` to `1024`.

### BUG-BE-06: Hardcoded `127.0.0.1:8080` Bind & Non-Resilient Scanner Loop
- **Location:** `main()` & `run_ble_packet_engine()`
- **Root Cause:** `bind_addr` could not be overridden via environment variables, the BLE background task exited permanently on any stream error, and `Ctrl+C` did not call `adapter.stop_scan()`.
- **Fix Implemented:** Added `HOST`/`PORT` env var overrides, automatic 3s retry loop around `run_ble_packet_engine()`, and `with_graceful_shutdown(shutdown_signal(...))` calling `stop_scan()`.

---

## Part B: Modular Angular Frontend (`frontend/src/app/`)

### BUG-FE-01: `loadInitialDevices()` Race Condition, Unsorted Initial Load, & Missing Error Handler
- **Location:** `core/services/bluetooth-api.service.ts`
- **Root Cause:**
  1. `loadInitialDevices()` pushed `deviceMap.values()` without sorting by `rssi`, unlike `onmessage`.
  2. In-flight `GET /api/devices` responses overwrote newer WebSocket telemetry packets in `deviceMap`.
  3. Calling `.subscribe({ next })` without an `error` callback threw unhandled RxJS errors when the daemon was offline.
  4. Manual `Sync Cache` never pruned stale devices removed from backend memory.
- **Fix Implemented:** Added `upsertDevice()` timestamp comparison, centralized `emitSortedDevices()`, added stale-device pruning bounded by `requestStartedAt`, and added `lastError$` error reporting.

### BUG-FE-02: WebSocket Reconnect Timer Leak, Uncaught `JSON.parse`, & Missing `ngOnDestroy`
- **Location:** `core/services/bluetooth-api.service.ts`
- **Root Cause:** Unmanaged `setTimeout` inside `onclose` could spawn duplicate reconnect loops, `JSON.parse(event.data)` and `new WebSocket(...)` lacked `try/catch`, and `BluetoothApiService` never closed sockets or cleared timers on teardown.
- **Fix Implemented:** Added `reconnectTimer` deduplication, `isDestroyed` flag, `try/catch` guards around socket creation and JSON parsing, old listener cleanup, and `ngOnDestroy()`.

### BUG-FE-03: Missing `trackBy` in `*ngFor` Causes Severe DOM Thrashing & Unclickable Buttons
- **Location:** `connection-manager.component.ts`, `device-card.component.ts`, `packet-tracker.component.ts`
- **Root Cause:** Streaming BLE advertisements emit new arrays dozens of times per second. Without `trackBy`, Angular tore down and recreated every `<app-device-card>` and `<tr>` on every emission, breaking button clicks and scroll state.
- **Fix Implemented:** Added `trackByDeviceId`, `trackByUuid`, and `trackByPacketId` functions to every `*ngFor`.

### BUG-FE-04: Packet History Wiped on Lazy Route Switch & Local Time Rendered as UTC
- **Location:** `features/packet-tracker/packet-tracker.component.ts` & `core/services/bluetooth-api.service.ts`
- **Root Cause:** `allPackets` lived inside lazy-loaded `PacketTrackerComponent`, so navigating to `/connections` destroyed the component and erased all captured packets. Also, `{{ pkt.timestamp | date:'HH:mm:ss.SSS' }}` displayed local browser time under a `Timestamp (UTC)` column header.
- **Fix Implemented:** Moved the 250-packet ring buffer into singleton `BluetoothApiService` (`packetHistory$`) and updated the template pipe to `date:'HH:mm:ss.SSS':'UTC'`.

### BUG-FE-05: Single `loadingId` Overwrite & Uncleaned Subscription in `ConnectionManagerComponent`
- **Location:** `features/connection-manager/connection-manager.component.ts`
- **Root Cause:** Using `loadingId: string | null` overwrote the loading indicator when two devices were acted on concurrently, and `sendConnectionRequest` lacked `takeUntil` cleanup on component destroy.
- **Fix Implemented:** Replaced `loadingId` with an immutable `Set<string>` (`loadingIds`) and added `destroy$ = new Subject<void>()` with `takeUntil(this.destroy$)`.

### BUG-FE-06: `HexFormatPipe` Fallback Bug & `RssiBadgeComponent` `127 dBm` Sentinel Bug
- **Location:** `shared/pipes/hex-format.pipe.ts` & `shared/components/rssi-badge/rssi-badge.component.ts`
- **Root Cause:** `HexFormatPipe` returned invalid non-hex input verbatim (e.g. `"   "`) and didn't pad odd-length nibble strings. `RssiBadgeComponent` classified BLE HCI unavailable RSSI (`127` / `0x7F`) as `>= -55`, rendering `"127 dBm • Immediate"` in green.
- **Fix Implemented:** Normalized odd-length hex nibbles and returned `'00'` on non-hex input in `HexFormatPipe`; added `isValidRssi` range check (`-127..=20`) in `RssiBadgeComponent` to display `"N/A • Unknown"`.

### BUG-FE-07: Deprecated `HttpClientModule`, Hex Search Normalization, & Missing Empty States
- **Location:** `core/core.module.ts`, `packet-filter.component.ts`, `packet-tracker.component.ts`, `connection-manager.component.ts`
- **Root Cause:** Angular 18 deprecates `HttpClientModule` in favor of `provideHttpClient(withInterceptorsFromDi())`; `PacketFilterComponent` couldn't match space-stripped hex queries like `"020106"` against `"02 01 06"`; empty device/packet lists showed blank containers.
- **Fix Implemented:** Migrated `CoreModule` to `provideHttpClient(withInterceptorsFromDi())`, added space-insensitive hex matching and a Reset button to `PacketFilterComponent`, and added empty-state UI feedback in both modules.
