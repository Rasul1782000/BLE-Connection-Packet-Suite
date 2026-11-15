import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  PacketTelemetry,
  ConnectionActionResponse,
  HealthStatus,
  DeviceHealth,
  LinkStability,
} from '../types/bluetooth';

const MAX_PACKET_HISTORY = 250;

export type ControllerTarget = 'workbench' | 'local-rust';

interface WebBluetoothServer {
  connected: boolean;
  connect: () => Promise<WebBluetoothServer>;
  disconnect: () => void;
  getPrimaryServices: () => Promise<Array<{ uuid: string; getCharacteristic: (id: number) => Promise<{ readValue: () => Promise<DataView> }> }>>;
}

interface WebBluetoothDevice {
  id: string;
  name?: string;
  gatt?: WebBluetoothServer;
  addEventListener: (type: string, listener: () => void) => void;
}

function getEndpoints(target: ControllerTarget) {
  if (target === 'local-rust') {
    return {
      apiBase: 'http://127.0.0.1:8080/api',
      wsUrl: 'ws://127.0.0.1:8080/ws/packets',
    };
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return {
    apiBase: `${window.location.origin}/api`,
    wsUrl: `${proto}//${window.location.host}/ws/packets`,
  };
}

export function deriveDeviceHealth(packet: PacketTelemetry): DeviceHealth {
  if (packet.device_health) return packet.device_health;

  const rssi = typeof packet.rssi === 'number' && packet.rssi >= -127 && packet.rssi <= 20 ? packet.rssi : -85;
  const signalQuality = Math.max(0, Math.min(100, Math.round(((rssi + 100) / 65) * 100)));
  const latency = packet.is_connected ? Math.max(8, Math.round((Math.abs(rssi) - 30) * 0.65)) : null;
  const packetLoss = packet.is_connected ? (rssi > -60 ? 0.0 : rssi > -75 ? 0.4 : 1.5) : 0;

  let linkStability: LinkStability = 'Standby';
  if (packet.is_connected) {
    if (signalQuality >= 75) linkStability = 'Excellent';
    else if (signalQuality >= 50) linkStability = 'Good';
    else if (signalQuality >= 30) linkStability = 'Fair';
    else linkStability = 'Degraded';
  }

  return {
    battery_pct: null,
    signal_quality_pct: signalQuality,
    latency_ms: latency,
    packet_loss_pct: packetLoss,
    mtu_size: 247,
    link_stability: linkStability,
    firmware_rev: 'BLE GATT Host',
    source: 'rust-daemon',
  };
}

export function useBluetoothClient(target: ControllerTarget) {
  const [devices, setDevices] = useState<PacketTelemetry[]>([]);
  const [packetHistory, setPacketHistory] = useState<PacketTelemetry[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [latencyHistory, setLatencyHistory] = useState<Record<string, number[]>>({});

  const deviceMapRef = useRef<Map<string, PacketTelemetry>>(new Map());
  const lastLatencyPacketRef = useRef<Map<string, string>>(new Map());
  const physicalHandlesRef = useRef<Map<string, WebBluetoothDevice>>(new Map());
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emitSortedDevices = useCallback(() => {
    const sorted = Array.from(deviceMapRef.current.values()).sort((a, b) => b.rssi - a.rssi);
    setDevices(sorted);
  }, []);

  const upsertDevice = useCallback((raw: PacketTelemetry) => {
    const incoming: PacketTelemetry = {
      ...raw,
      device_health: deriveDeviceHealth(raw),
    };
    const existing = deviceMapRef.current.get(incoming.device_id);
    const existingTs = existing ? Date.parse(existing.timestamp) || 0 : 0;
    const incomingTs = Date.parse(incoming.timestamp) || 0;

    if (!existing || incomingTs >= existingTs) {
      deviceMapRef.current.set(incoming.device_id, incoming);

      const prevLatencyPacket = lastLatencyPacketRef.current.get(incoming.device_id);
      if (prevLatencyPacket !== incoming.packet_id) {
        lastLatencyPacketRef.current.set(incoming.device_id, incoming.packet_id);
        if (
          incoming.is_connected &&
          typeof incoming.device_health?.latency_ms === 'number'
        ) {
          const sample = incoming.device_health.latency_ms;
          setLatencyHistory((prev) => {
            const list = prev[incoming.device_id] ?? [];
            return {
              ...prev,
              [incoming.device_id]: [...list, sample].slice(-20),
            };
          });
        } else if (!incoming.is_connected) {
          setLatencyHistory((prev) => {
            if (!prev[incoming.device_id]) return prev;
            const next = { ...prev };
            delete next[incoming.device_id];
            return next;
          });
        }
      }
    }
  }, []);

  const syncDevicesAndHealth = useCallback(async () => {
    const { apiBase } = getEndpoints(target);
    const requestStartedAt = Date.now();
    try {
      const [devRes, healthRes] = await Promise.all([
        fetch(`${apiBase}/devices`),
        fetch(`${apiBase}/health`),
      ]);
      if (!devRes.ok) {
        throw new Error(`GET /api/devices returned ${devRes.status}`);
      }
      const list: PacketTelemetry[] = await devRes.json();
      const incomingIds = new Set(list.map((d) => d.device_id));

      for (const [id, existing] of deviceMapRef.current.entries()) {
        const existingTs = Date.parse(existing.timestamp) || 0;
        if (!incomingIds.has(id) && existingTs < requestStartedAt) {
          deviceMapRef.current.delete(id);
        }
      }

      list.forEach((d) => upsertDevice(d));
      emitSortedDevices();

      if (healthRes.ok) {
        const h: HealthStatus = await healthRes.json();
        setHealth(h);
      }
      setLastError(null);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to reach BLE controller endpoint';
      setLastError(
        target === 'local-rust'
          ? `Local Rust daemon offline at 127.0.0.1:8080 (${msg})`
          : msg
      );
    }
  }, [target, upsertDevice, emitSortedDevices]);

  useEffect(() => {
    let disposed = false;
    deviceMapRef.current.clear();
    lastLatencyPacketRef.current.clear();
    setDevices([]);
    setPacketHistory([]);
    setLatencyHistory({});
    setHealth(null);
    setLastError(null);

    const { wsUrl } = getEndpoints(target);

    const connectWs = () => {
      if (disposed) return;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (socketRef.current) {
        socketRef.current.onopen = null;
        socketRef.current.onmessage = null;
        socketRef.current.onclose = null;
        socketRef.current.onerror = null;
        if (
          socketRef.current.readyState === WebSocket.OPEN ||
          socketRef.current.readyState === WebSocket.CONNECTING
        ) {
          socketRef.current.close();
        }
        socketRef.current = null;
      }

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        setWsConnected(false);
        reconnectTimerRef.current = setTimeout(connectWs, 2500);
        return;
      }

      socketRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        setWsConnected(true);
        setLastError(null);
        void syncDevicesAndHealth();
      };

      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const raw: PacketTelemetry = JSON.parse(event.data);
          if (!raw || !raw.device_id) return;
          const packet: PacketTelemetry = {
            ...raw,
            device_health: deriveDeviceHealth(raw),
          };

          upsertDevice(packet);
          emitSortedDevices();

          if (!isPausedRef.current) {
            setPacketHistory((prev) => [packet, ...prev].slice(0, MAX_PACKET_HISTORY));
          }
        } catch {
          // Ignore malformed telemetry frame
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setWsConnected(false);
        if (!reconnectTimerRef.current) {
          reconnectTimerRef.current = setTimeout(connectWs, 2500);
        }
      };

      ws.onerror = () => {
        if (disposed) return;
        setWsConnected(false);
      };
    };

    void syncDevicesAndHealth();
    connectWs();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (socketRef.current) {
        socketRef.current.onopen = null;
        socketRef.current.onmessage = null;
        socketRef.current.onclose = null;
        socketRef.current.onerror = null;
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [target, syncDevicesAndHealth, upsertDevice, emitSortedDevices]);

  const registerPhysicalDevice = useCallback(
    async (payload: {
      device_id: string;
      device_name: string;
      mac_address: string;
      rssi: number;
      is_connected: boolean;
      packet_type: string;
      gatt_services: string[];
      battery_pct: number | null;
      firmware_rev: string;
    }) => {
      const { apiBase } = getEndpoints('workbench');
      const res = await fetch(`${apiBase}/devices/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const pkt: PacketTelemetry = await res.json();
        upsertDevice(pkt);
        emitSortedDevices();
        void syncDevicesAndHealth();
      }
    },
    [upsertDevice, emitSortedDevices, syncDevicesAndHealth]
  );

  const scanPhysicalBluetoothDevice = useCallback(async (): Promise<{
    device_name: string;
    services_count: number;
    battery_pct: number | null;
  }> => {
    const nav = navigator as Navigator & {
      bluetooth?: {
        requestDevice: (options: Record<string, unknown>) => Promise<WebBluetoothDevice>;
      };
    };

    if (!nav.bluetooth) {
      throw new Error(
        'Web Bluetooth API is unavailable in this browser/iframe context. Use Chrome or Edge over HTTPS to pair physical hardware.'
      );
    }

    const device = await nav.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        'generic_access',
        'device_information',
        'battery_service',
        'heart_rate',
        0x1800,
        0x180a,
        0x180d,
        0x180f,
        0x1812,
      ],
    });

    if (!device.gatt) {
      throw new Error('Selected Bluetooth device does not expose a GATT server.');
    }

    const server = await device.gatt.connect();
    const services = await server.getPrimaryServices();
    const serviceUuids = services.map((s) => s.uuid);

    let batteryPct: number | null = null;
    let firmwareRev = 'Physical BLE GATT';

    for (const svc of services) {
      if (svc.uuid.includes('180f')) {
        try {
          const ch = await svc.getCharacteristic(0x2a19);
          const val = await ch.readValue();
          batteryPct = val.getUint8(0);
        } catch {
          // Battery characteristic unreadable
        }
      }
      if (svc.uuid.includes('180a')) {
        try {
          const ch = await svc.getCharacteristic(0x2a26);
          const val = await ch.readValue();
          const decoded = new TextDecoder().decode(val.buffer).trim();
          if (decoded) firmwareRev = decoded;
        } catch {
          // Firmware revision unavailable
        }
      }
    }

    const deviceId = `WebBLE#${device.id}`;
    const deviceName = device.name || 'Physical BLE Peripheral';
    physicalHandlesRef.current.set(deviceId, device);

    device.addEventListener('gattserverdisconnected', () => {
      void registerPhysicalDevice({
        device_id: deviceId,
        device_name: deviceName,
        mac_address: `WEB-${device.id.slice(0, 8).toUpperCase()}`,
        rssi: -52,
        is_connected: false,
        packet_type: 'CONN_TERMINATED',
        gatt_services: [],
        battery_pct: batteryPct,
        firmware_rev: firmwareRev,
      });
    });

    await registerPhysicalDevice({
      device_id: deviceId,
      device_name: deviceName,
      mac_address: `WEB-${device.id.slice(0, 8).toUpperCase()}`,
      rssi: -44,
      is_connected: true,
      packet_type: 'CONN_ESTABLISHED',
      gatt_services: serviceUuids,
      battery_pct: batteryPct,
      firmware_rev: firmwareRev,
    });

    return {
      device_name: deviceName,
      services_count: serviceUuids.length,
      battery_pct: batteryPct,
    };
  }, [registerPhysicalDevice]);

  const sendConnectionRequest = useCallback(
    async (
      deviceId: string,
      action: 'CONNECT' | 'DISCONNECT'
    ): Promise<ConnectionActionResponse> => {
      const physical = physicalHandlesRef.current.get(deviceId);
      if (physical && physical.gatt) {
        if (action === 'DISCONNECT') {
          physical.gatt.disconnect();
          return {
            status: 'DISCONNECTED',
            message: `Disconnected physical BLE device ${physical.name || deviceId}`,
            device_id: deviceId,
            discovered_services: [],
          };
        }
        const server = await physical.gatt.connect();
        const services = await server.getPrimaryServices();
        const uuids = services.map((s) => s.uuid);
        await registerPhysicalDevice({
          device_id: deviceId,
          device_name: physical.name || 'Physical BLE Peripheral',
          mac_address: `WEB-${physical.id.slice(0, 8).toUpperCase()}`,
          rssi: -46,
          is_connected: true,
          packet_type: 'CONN_ESTABLISHED',
          gatt_services: uuids,
          battery_pct: deviceMapRef.current.get(deviceId)?.device_health?.battery_pct ?? null,
          firmware_rev: deviceMapRef.current.get(deviceId)?.device_health?.firmware_rev ?? 'Physical BLE GATT',
        });
        return {
          status: 'CONNECTED',
          message: `Reconnected physical BLE device (${uuids.length} GATT services)`,
          device_id: deviceId,
          discovered_services: uuids,
        };
      }

      const { apiBase } = getEndpoints(target);
      const res = await fetch(`${apiBase}/connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId, action }),
      });
      const body: ConnectionActionResponse = await res.json();
      if (!res.ok) {
        throw new Error(body.message || `Request failed (${res.status})`);
      }
      void syncDevicesAndHealth();
      return body;
    },
    [target, syncDevicesAndHealth, registerPhysicalDevice]
  );

  const injectVirtualPeripheral = useCallback(
    async (payload: {
      device_name: string;
      mac_address: string;
      rssi: number;
      payload_hex: string;
    }) => {
      const { apiBase } = getEndpoints(target);
      const res = await fetch(`${apiBase}/simulator/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error('Failed to register virtual peripheral');
      }
      const created: PacketTelemetry = await res.json();
      upsertDevice(created);
      emitSortedDevices();
      void syncDevicesAndHealth();
      return created;
    },
    [target, upsertDevice, emitSortedDevices, syncDevicesAndHealth]
  );

  const simulateHealthSpike = useCallback(
    async (deviceId?: string, recover = false) => {
      const { apiBase } = getEndpoints(target);
      const res = await fetch(`${apiBase}/simulator/spike`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId, recover }),
      });
      if (!res.ok) {
        throw new Error('Failed to trigger simulated health spike');
      }
      const data = await res.json();
      if (!recover && data?.device_id) {
        upsertDevice(data as PacketTelemetry);
        emitSortedDevices();
      } else {
        void syncDevicesAndHealth();
      }
      return data;
    },
    [target, upsertDevice, emitSortedDevices, syncDevicesAndHealth]
  );

  const clearPacketHistory = useCallback(() => {
    setPacketHistory([]);
  }, []);

  return {
    devices,
    packetHistory,
    latencyHistory,
    wsConnected,
    health,
    lastError,
    isPaused,
    setIsPaused,
    syncDevicesAndHealth,
    sendConnectionRequest,
    scanPhysicalBluetoothDevice,
    injectVirtualPeripheral,
    simulateHealthSpike,
    clearPacketHistory,
  };
}
