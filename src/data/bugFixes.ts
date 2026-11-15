import { BugFixRecord } from '../types/bluetooth';

export const BUG_FIX_RECORDS: BugFixRecord[] = [
  {
    id: 'BUG-BE-01',
    layer: 'backend',
    severity: 'Critical',
    file: 'bluetooth-packet-tracker/backend/src/main.rs',
    title: 'Scan updates overwrite device names, active connections, and invalid RSSI',
    symptom:
      'DeviceUpdated events without a local_name overwrote known names with "Unnamed Peripheral", regressed CONN_ESTABLISHED state back to ADV_IND, and accepted BLE HCI sentinel 127 (0x7F) as valid RSSI.',
    fix:
      'Added extract_peripheral_snapshot() and sanitize_rssi() to merge incoming scan properties with cached state, preserve non-placeholder names and active connection states, and clamp invalid RSSI readings.',
  },
  {
    id: 'BUG-BE-02',
    layer: 'backend',
    severity: 'High',
    file: 'bluetooth-packet-tracker/backend/src/main.rs',
    title: 'Duplicate CONN_ESTABLISHED events and dropped early connection transitions',
    symptom:
      'CentralEvent::DeviceConnected fired concurrently with handle_connection_request, emitting duplicate CONN_ESTABLISHED frames (one missing gatt_services). Missing devices in tracked_devices were silently ignored.',
    fix:
      'Added pending_handshakes in AppState to suppress premature DeviceConnected broadcasts during service discovery, and updated broadcast_state_packet() to upsert snapshots when missing.',
  },
  {
    id: 'BUG-BE-03',
    layer: 'backend',
    severity: 'Critical',
    file: 'bluetooth-packet-tracker/backend/src/main.rs',
    title: 'Stuck CONN_REQ_SENT on failure/timeout and concurrent handshake race',
    symptom:
      'Failed or timed-out connect() calls never emitted a recovery packet, leaving UI cards stuck in Handshaking. Overlapping CONNECT requests raced and discover_services() errors were silently discarded.',
    fix:
      'Enforced per-device locking via pending_handshakes (409 Conflict on overlap), added idempotent is_connected() pre-checks, logged discover_services() failures, and broadcast CONN_FAILED on rejection/timeout.',
  },
  {
    id: 'BUG-BE-04',
    layer: 'backend',
    severity: 'Medium',
    file: 'bluetooth-packet-tracker/backend/src/main.rs',
    title: 'Non-deterministic HashMap iteration and incomplete AD payload hex',
    symptom:
      'Iterating manufacturer_data HashMap produced unstable byte order, discarded service_data when manufacturer_data existed, and omitted BLE AD length/type framing.',
    fix:
      'Implemented build_ad_payload_hex() using BTreeMap deterministic ordering and proper BLE Core Spec [Length, AD Type, Data...] structures (0x01 Flags, 0xFF Manufacturer, 0x21 Service, 0x09 Name).',
  },
  {
    id: 'BUG-BE-05',
    layer: 'backend',
    severity: 'High',
    file: 'bluetooth-packet-tracker/backend/src/main.rs',
    title: 'WebSocket client drops on RecvError::Lagged and half-open socket leaks',
    symptom:
      'while let Ok(packet) = rx.recv().await terminated the WebSocket silently whenever a slow client lagged by >512 messages, and incoming Close/Ping frames were never read.',
    fix:
      'Split WebSocket sink/stream with tokio::select!, recovered cleanly from RecvError::Lagged(skipped), answered Ping frames, exited on Close frames, and raised broadcast capacity to 1024.',
  },
  {
    id: 'BUG-BE-06',
    layer: 'backend',
    severity: 'Medium',
    file: 'bluetooth-packet-tracker/backend/src/main.rs',
    title: 'Hardcoded bind address and non-resilient BLE scan loop',
    symptom:
      'Server hardcoded 127.0.0.1:8080, scanner exited permanently on transient adapter errors, and shutdown did not stop active scanning.',
    fix:
      'Added HOST/PORT env var configuration, automatic 3s retry loop around run_ble_packet_engine(), and graceful Ctrl+C shutdown calling adapter.stop_scan().',
  },
  {
    id: 'BUG-FE-01',
    layer: 'frontend',
    severity: 'Critical',
    file: 'bluetooth-packet-tracker/frontend/src/app/core/services/bluetooth-api.service.ts',
    title: 'loadInitialDevices() race condition, unsorted load, and uncaught errors',
    symptom:
      'Initial HTTP device load omitted RSSI sorting, overwrote newer in-flight WebSocket packets, failed to prune stale cache on manual sync, and lacked an error callback.',
    fix:
      'Added timestamp comparison in upsertDevice(), centralized emitSortedDevices(), pruned stale entries bounded by requestStartedAt, and exposed lastError$ for offline diagnostics.',
  },
  {
    id: 'BUG-FE-02',
    layer: 'frontend',
    severity: 'High',
    file: 'bluetooth-packet-tracker/frontend/src/app/core/services/bluetooth-api.service.ts',
    title: 'WebSocket reconnect timer leaks, uncaught JSON.parse, and missing ngOnDestroy',
    symptom:
      'Duplicate reconnect timers could spawn parallel WebSockets, malformed frames crashed onmessage, and sockets/timers were never closed on teardown.',
    fix:
      'Deduplicated reconnectTimer, cleared prior socket listeners before reconnecting, wrapped WebSocket construction and JSON.parse in try/catch, and implemented ngOnDestroy().',
  },
  {
    id: 'BUG-FE-03',
    layer: 'frontend',
    severity: 'Critical',
    file: 'bluetooth-packet-tracker/frontend/src/app/features/connection-manager/connection-manager.component.ts',
    title: 'Missing trackBy in *ngFor causes DOM thrashing and unclickable buttons',
    symptom:
      'Every streaming BLE packet emitted a new array, causing Angular to destroy and recreate all device cards and table rows dozens of times per second.',
    fix:
      'Added trackByDeviceId, trackByUuid, and trackByPacketId across ConnectionManagerComponent, DeviceCardComponent, and PacketTrackerComponent.',
  },
  {
    id: 'BUG-FE-04',
    layer: 'frontend',
    severity: 'High',
    file: 'bluetooth-packet-tracker/frontend/src/app/features/packet-tracker/packet-tracker.component.ts',
    title: 'Packet history wiped on route switch and local time displayed as UTC',
    symptom:
      'Navigating from /packets to /connections destroyed lazy-loaded PacketTrackerComponent and erased captured packets. DatePipe displayed local timezone under a Timestamp (UTC) header.',
    fix:
      'Moved the 250-packet ring buffer into singleton BluetoothApiService (packetHistory$) and updated the pipe to date:\'HH:mm:ss.SSS\':\'UTC\'.',
  },
  {
    id: 'BUG-FE-05',
    layer: 'frontend',
    severity: 'Medium',
    file: 'bluetooth-packet-tracker/frontend/src/app/features/connection-manager/connection-manager.component.ts',
    title: 'Single loadingId overwrites concurrent device actions and leaks subscriptions',
    symptom:
      'Triggering two connection requests concurrently overwrote loadingId, and sendConnectionRequest() lacked takeUntil teardown.',
    fix:
      'Replaced loadingId with an immutable Set<string> (loadingIds) and added destroy$ with takeUntil(this.destroy$) cleanup.',
  },
  {
    id: 'BUG-FE-06',
    layer: 'frontend',
    severity: 'Medium',
    file: 'bluetooth-packet-tracker/frontend/src/app/shared/components/rssi-badge/rssi-badge.component.ts',
    title: 'RssiBadge treats BLE 127 dBm unavailable sentinel as green Immediate; HexFormatPipe odd-nibble bug',
    symptom:
      'Per BLE HCI spec, 127 (0x7F) means RSSI unavailable, yet >= -55 classified it as Immediate. HexFormatPipe returned invalid non-hex input verbatim.',
    fix:
      'Added isValidRssi range check (-127..=20) showing "N/A • Unknown" for invalid values, and normalized odd-length nibbles / empty input in HexFormatPipe.',
  },
  {
    id: 'BUG-FE-07',
    layer: 'frontend',
    severity: 'Medium',
    file: 'bluetooth-packet-tracker/frontend/src/app/core/core.module.ts',
    title: 'Deprecated HttpClientModule in Angular 18, space-sensitive hex search, and missing empty states',
    symptom:
      'CoreModule used deprecated HttpClientModule, hex searches like "020106" failed against "02 01 06", and empty lists rendered blank panels.',
    fix:
      'Migrated CoreModule to provideHttpClient(withInterceptorsFromDi()), added space-insensitive hex matching + Reset control in PacketFilterComponent, and added empty-state views.',
  },
];
