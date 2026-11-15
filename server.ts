import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

export type LinkStability = 'Excellent' | 'Good' | 'Fair' | 'Degraded' | 'Standby';

export interface DeviceHealth {
  battery_pct: number | null;
  signal_quality_pct: number;
  latency_ms: number | null;
  packet_loss_pct: number;
  mtu_size: number;
  link_stability: LinkStability;
  firmware_rev: string;
  source: 'virtual' | 'web-bluetooth' | 'rust-daemon';
}

export interface PacketTelemetry {
  packet_id: string;
  device_id: string;
  device_name: string;
  mac_address: string;
  rssi: number;
  packet_type:
    | 'ADV_IND'
    | 'CONN_REQ_SENT'
    | 'CONN_ESTABLISHED'
    | 'CONN_TERMINATED'
    | 'CONN_FAILED'
    | 'READ'
    | 'WRITE'
    | 'NOTIFY';
  payload_hex: string;
  gatt_services: string[];
  is_connected: boolean;
  timestamp: string;
  device_health: DeviceHealth;
}

interface VirtualDeviceProfile {
  device_id: string;
  device_name: string;
  mac_address: string;
  base_rssi: number;
  payload_hex: string;
  available_services: string[];
  battery_pct: number | null;
  firmware_rev: string;
  mtu_size: number;
  source: 'virtual' | 'web-bluetooth';
  simulate_reject?: boolean;
}

const VIRTUAL_PERIPHERALS: VirtualDeviceProfile[] = [
  {
    device_id: 'BluetoothLE#BluetoothLE00:1a:7d:da:71:13-ff:22:33:44:55:66',
    device_name: 'MX Master 3S',
    mac_address: 'FF:22:33:44:55:66',
    base_rssi: -46,
    payload_hex: '02 01 06 03 03 12 18 0B 09 4D 58 20 4D 61 73 74 65 72',
    available_services: [
      '00001800-0000-1000-8000-00805f9b34fb',
      '0000180a-0000-1000-8000-00805f9b34fb',
      '0000180f-0000-1000-8000-00805f9b34fb',
      '00001812-0000-1000-8000-00805f9b34fb',
    ],
    battery_pct: 84,
    firmware_rev: 'FW 22.01.0014',
    mtu_size: 247,
    source: 'virtual',
  },
  {
    device_id: 'BluetoothLE#BluetoothLE00:1a:7d:da:71:13-c4:7c:8d:6a:12:09',
    device_name: 'Polar H10 Heart Rate',
    mac_address: 'C4:7C:8D:6A:12:09',
    base_rssi: -58,
    payload_hex: '02 01 06 07 FF 6B 00 1A 02 88 4C',
    available_services: [
      '00001800-0000-1000-8000-00805f9b34fb',
      '0000180d-0000-1000-8000-00805f9b34fb',
      '0000180f-0000-1000-8000-00805f9b34fb',
    ],
    battery_pct: 92,
    firmware_rev: 'FW 3.2.0',
    mtu_size: 247,
    source: 'virtual',
  },
  {
    device_id: 'BluetoothLE#BluetoothLE00:1a:7d:da:71:13-a8:2b:b9:11:40:e2',
    device_name: 'Nordic Thingy:53 Sensor',
    mac_address: 'A8:2B:B9:11:40:E2',
    base_rssi: -64,
    payload_hex: '02 01 06 09 FF 59 00 42 10 04 28 7E 01',
    available_services: [
      '00001800-0000-1000-8000-00805f9b34fb',
      'ef680100-9b35-4933-9b10-52ffa9740042',
      'ef680200-9b35-4933-9b10-52ffa9740042',
    ],
    battery_pct: 68,
    firmware_rev: 'Zephyr 3.5.0',
    mtu_size: 498,
    source: 'virtual',
  },
  {
    device_id: 'BluetoothLE#BluetoothLE00:1a:7d:da:71:13-d1:04:5e:99:73:11',
    device_name: 'Keychron K2 Pro',
    mac_address: 'D1:04:5E:99:73:11',
    base_rssi: -71,
    payload_hex: '02 01 06 03 19 C1 03 05 03 12 18 0F 18',
    available_services: [
      '00001800-0000-1000-8000-00805f9b34fb',
      '0000180f-0000-1000-8000-00805f9b34fb',
      '00001812-0000-1000-8000-00805f9b34fb',
    ],
    battery_pct: 53,
    firmware_rev: 'QMK BLE 1.12',
    mtu_size: 185,
    source: 'virtual',
  },
  {
    device_id: 'BluetoothLE#BluetoothLE00:1a:7d:da:71:13-7e:91:33:0b:8a:44',
    device_name: 'Beacon-Env-07 (Non-Connectable)',
    mac_address: '7E:91:33:0B:8A:44',
    base_rssi: -82,
    payload_hex:
      '02 01 06 1A FF 4C 00 02 15 E2 C5 6D B5 DF FB 48 D2 B0 60 D0 F5 A7 10 96 E0 00 01 00 07 C5',
    available_services: [],
    battery_pct: 41,
    firmware_rev: 'iBeacon 1.4',
    mtu_size: 23,
    source: 'virtual',
    simulate_reject: true,
  },
];

const trackedDevices = new Map<string, PacketTelemetry>();
const pendingHandshakes = new Set<string>();
const profileMap = new Map<string, VirtualDeviceProfile>();
const wsClients = new Set<WebSocket>();

interface SpikeState {
  expiresAt: number;
  rssi: number;
  latency_ms: number;
  packet_loss_pct: number;
  link_stability: LinkStability;
  battery_pct?: number;
}
const spikedUntilMap = new Map<string, SpikeState>();

function computeDeviceHealth(
  rssi: number,
  isConnected: boolean,
  profile?: VirtualDeviceProfile,
  overrideHealth?: Partial<DeviceHealth>
): DeviceHealth {
  const signalQuality = Math.max(0, Math.min(100, Math.round(((rssi + 100) / 65) * 100)));
  const latency = isConnected
    ? overrideHealth?.latency_ms ?? Math.max(7, Math.round((Math.abs(rssi) - 30) * 0.65))
    : null;
  const packetLoss = isConnected
    ? overrideHealth?.packet_loss_pct ?? (rssi > -60 ? 0.0 : rssi > -75 ? 0.4 : 1.8)
    : 0;

  let linkStability: LinkStability = 'Standby';
  if (isConnected) {
    if (signalQuality >= 75 && packetLoss < 0.5) linkStability = 'Excellent';
    else if (signalQuality >= 50) linkStability = 'Good';
    else if (signalQuality >= 30) linkStability = 'Fair';
    else linkStability = 'Degraded';
  }

  return {
    battery_pct: overrideHealth?.battery_pct ?? profile?.battery_pct ?? null,
    signal_quality_pct: signalQuality,
    latency_ms: latency,
    packet_loss_pct: packetLoss,
    mtu_size: overrideHealth?.mtu_size ?? profile?.mtu_size ?? 247,
    link_stability: overrideHealth?.link_stability ?? linkStability,
    firmware_rev: overrideHealth?.firmware_rev ?? profile?.firmware_rev ?? 'BLE 5.x GATT',
    source: overrideHealth?.source ?? profile?.source ?? 'virtual',
  };
}

function initializeDevices() {
  const now = new Date().toISOString();
  for (const profile of VIRTUAL_PERIPHERALS) {
    profileMap.set(profile.device_id, profile);
    trackedDevices.set(profile.device_id, {
      packet_id: crypto.randomUUID(),
      device_id: profile.device_id,
      device_name: profile.device_name,
      mac_address: profile.mac_address,
      rssi: profile.base_rssi,
      packet_type: 'ADV_IND',
      payload_hex: profile.payload_hex,
      gatt_services: [],
      is_connected: false,
      timestamp: now,
      device_health: computeDeviceHealth(profile.base_rssi, false, profile),
    });
  }
}

function broadcastPacket(packet: PacketTelemetry) {
  const payload = JSON.stringify(packet);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function collectWorkspaceFiles(
  baseDir: string,
  currentDir = baseDir
): Array<{ path: string; size: number }> {
  if (!fs.existsSync(currentDir)) return [];
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const results: Array<{ path: string; size: number }> = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'target' || entry.name === 'dist') {
      continue;
    }
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectWorkspaceFiles(baseDir, fullPath));
    } else {
      const stat = fs.statSync(fullPath);
      results.push({
        path: path.relative(baseDir, fullPath).replace(/\\/g, '/'),
        size: stat.size,
      });
    }
  }
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

async function startServer() {
  initializeDevices();

  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    const devices = Array.from(trackedDevices.values());
    const connected = devices.filter((d) => d.is_connected);
    const avgRssi =
      devices.length > 0
        ? Math.round(devices.reduce((acc, d) => acc + d.rssi, 0) / devices.length)
        : null;
    const latencies = connected
      .map((d) => d.device_health?.latency_ms)
      .filter((v): v is number => typeof v === 'number');
    const avgLatency =
      latencies.length > 0
        ? Math.round(latencies.reduce((acc, v) => acc + v, 0) / latencies.length)
        : null;

    res.json({
      status: 'OPERATIONAL',
      adapter_info: 'BLE 5.3 Dual-Mode Controller (Virtual + Web Bluetooth Bridge)',
      cached_device_count: devices.length,
      active_connections: connected.length,
      adapter_health: pendingHandshakes.size > 0 ? 'Busy' : 'Optimal',
      avg_rssi: avgRssi,
      avg_latency_ms: avgLatency,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/devices', (_req, res) => {
    const list = Array.from(trackedDevices.values()).sort((a, b) => b.rssi - a.rssi);
    res.json(list);
  });

  // Register or update a real physical device detected via browser Web Bluetooth API
  app.post('/api/devices/register', (req, res) => {
    const deviceId = String(req.body?.device_id || '').trim();
    if (!deviceId) {
      res.status(400).json({ error: 'device_id is required' });
      return;
    }

    const name = String(req.body?.device_name || 'Physical BLE Peripheral').trim();
    const mac = String(req.body?.mac_address || 'WEB-BLE-GATT').trim();
    const rssiVal = Number(req.body?.rssi);
    const rssi =
      Number.isFinite(rssiVal) && rssiVal >= -127 && rssiVal <= 20 ? Math.round(rssiVal) : -52;
    const isConnected = Boolean(req.body?.is_connected);
    const packetType = (req.body?.packet_type as PacketTelemetry['packet_type']) ||
      (isConnected ? 'CONN_ESTABLISHED' : 'CONN_TERMINATED');
    const gattServices = Array.isArray(req.body?.gatt_services)
      ? req.body.gatt_services.map(String)
      : [];
    const payloadHex = String(req.body?.payload_hex || '02 01 06 03 03 0F 18');

    const profile: VirtualDeviceProfile = {
      device_id: deviceId,
      device_name: name,
      mac_address: mac,
      base_rssi: rssi,
      payload_hex: payloadHex,
      available_services: gattServices,
      battery_pct:
        typeof req.body?.battery_pct === 'number' ? req.body.battery_pct : null,
      firmware_rev: String(req.body?.firmware_rev || 'Hardware GATT Device'),
      mtu_size: Number(req.body?.mtu_size) || 247,
      source: 'web-bluetooth',
    };
    profileMap.set(deviceId, profile);

    const packet: PacketTelemetry = {
      packet_id: crypto.randomUUID(),
      device_id: deviceId,
      device_name: name,
      mac_address: mac,
      rssi,
      packet_type: packetType,
      payload_hex: payloadHex,
      gatt_services: gattServices,
      is_connected: isConnected,
      timestamp: new Date().toISOString(),
      device_health: computeDeviceHealth(rssi, isConnected, profile, {
        source: 'web-bluetooth',
        battery_pct: profile.battery_pct,
        firmware_rev: profile.firmware_rev,
        latency_ms: isConnected ? 14 : null,
      }),
    };

    trackedDevices.set(deviceId, packet);
    broadcastPacket(packet);
    res.status(200).json(packet);
  });

  app.post('/api/connection', async (req, res) => {
    const deviceId = String(req.body?.device_id || '');
    const action = String(req.body?.action || '').trim().toUpperCase();

    if (action !== 'CONNECT' && action !== 'DISCONNECT') {
      res.status(400).json({
        status: 'INVALID_ACTION',
        message: 'Action must be CONNECT or DISCONNECT',
        device_id: deviceId,
        discovered_services: [],
      });
      return;
    }

    const existing = trackedDevices.get(deviceId);
    if (!existing) {
      res.status(404).json({
        status: 'NOT_FOUND',
        message: 'Target peripheral not found in active scan cache',
        device_id: deviceId,
        discovered_services: [],
      });
      return;
    }

    if (pendingHandshakes.has(deviceId)) {
      res.status(409).json({
        status: 'IN_PROGRESS',
        message: 'Another connection operation is already in progress for this device',
        device_id: deviceId,
        discovered_services: [],
      });
      return;
    }

    pendingHandshakes.add(deviceId);

    try {
      const profile = profileMap.get(deviceId);

      if (action === 'CONNECT') {
        if (existing.is_connected) {
          res.json({
            status: 'CONNECTED',
            message: `Peripheral already connected (${existing.gatt_services.length} services active)`,
            device_id: deviceId,
            discovered_services: existing.gatt_services,
          });
          return;
        }

        const reqSent: PacketTelemetry = {
          ...existing,
          packet_id: crypto.randomUUID(),
          packet_type: 'CONN_REQ_SENT',
          is_connected: false,
          timestamp: new Date().toISOString(),
          device_health: computeDeviceHealth(existing.rssi, false, profile),
        };
        trackedDevices.set(deviceId, reqSent);
        broadcastPacket(reqSent);

        await new Promise((r) => setTimeout(r, 600));

        if (profile?.simulate_reject) {
          const failed: PacketTelemetry = {
            ...reqSent,
            packet_id: crypto.randomUUID(),
            packet_type: 'CONN_FAILED',
            is_connected: false,
            gatt_services: [],
            timestamp: new Date().toISOString(),
            device_health: computeDeviceHealth(existing.rssi, false, profile),
          };
          trackedDevices.set(deviceId, failed);
          broadcastPacket(failed);

          res.status(502).json({
            status: 'REJECTED',
            message:
              'Peripheral rejected GATT connection (ADV_NONCONN_IND / non-connectable beacon)',
            device_id: deviceId,
            discovered_services: [],
          });
          return;
        }

        const services = profile?.available_services ?? [
          '00001800-0000-1000-8000-00805f9b34fb',
        ];
        const established: PacketTelemetry = {
          ...reqSent,
          packet_id: crypto.randomUUID(),
          packet_type: 'CONN_ESTABLISHED',
          is_connected: true,
          gatt_services: services,
          timestamp: new Date().toISOString(),
          device_health: computeDeviceHealth(existing.rssi, true, profile),
        };
        trackedDevices.set(deviceId, established);
        broadcastPacket(established);

        res.json({
          status: 'CONNECTED',
          message: `GATT connection established (${services.length} services discovered)`,
          device_id: deviceId,
          discovered_services: services,
        });
        return;
      }

      // DISCONNECT
      if (!existing.is_connected) {
        const terminated: PacketTelemetry = {
          ...existing,
          packet_id: crypto.randomUUID(),
          packet_type: 'CONN_TERMINATED',
          is_connected: false,
          gatt_services: [],
          timestamp: new Date().toISOString(),
          device_health: computeDeviceHealth(existing.rssi, false, profile),
        };
        trackedDevices.set(deviceId, terminated);
        broadcastPacket(terminated);

        res.json({
          status: 'DISCONNECTED',
          message: 'Peripheral was already disconnected',
          device_id: deviceId,
          discovered_services: [],
        });
        return;
      }

      await new Promise((r) => setTimeout(r, 250));
      const terminated: PacketTelemetry = {
        ...existing,
        packet_id: crypto.randomUUID(),
        packet_type: 'CONN_TERMINATED',
        is_connected: false,
        gatt_services: [],
        timestamp: new Date().toISOString(),
        device_health: computeDeviceHealth(existing.rssi, false, profile),
      };
      trackedDevices.set(deviceId, terminated);
      broadcastPacket(terminated);

      res.json({
        status: 'DISCONNECTED',
        message: 'Peripheral disconnected cleanly',
        device_id: deviceId,
        discovered_services: [],
      });
    } finally {
      pendingHandshakes.delete(deviceId);
    }
  });

  app.post('/api/simulator/inject', (req, res) => {
    const name = String(req.body?.device_name || '').trim() || 'Custom BLE Peripheral';
    const rawMac = String(req.body?.mac_address || '').trim().toUpperCase();
    const mac = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(rawMac)
      ? rawMac
      : Array.from({ length: 6 }, () =>
          Math.floor(Math.random() * 256)
            .toString(16)
            .padStart(2, '0')
            .toUpperCase()
        ).join(':');
    const rssiVal = Number(req.body?.rssi);
    const rssi =
      Number.isFinite(rssiVal) && rssiVal >= -100 && rssiVal <= -20
        ? Math.round(rssiVal)
        : -54;
    const rawHex = String(req.body?.payload_hex || '02 01 06 07 FF 4C 00 10 05 0B 1C')
      .replace(/[^0-9A-Fa-f]/g, '')
      .toUpperCase();
    const paddedHex = rawHex.length % 2 === 1 ? `0${rawHex}` : rawHex || '020106';
    const formattedHex = paddedHex.match(/.{1,2}/g)?.join(' ') ?? '02 01 06';

    const deviceId = `BluetoothLE#BluetoothLE00:1a:7d:da:71:13-${mac.toLowerCase()}`;
    const services = [
      '00001800-0000-1000-8000-00805f9b34fb',
      '0000180a-0000-1000-8000-00805f9b34fb',
      '0000180f-0000-1000-8000-00805f9b34fb',
    ];

    const profile: VirtualDeviceProfile = {
      device_id: deviceId,
      device_name: name,
      mac_address: mac,
      base_rssi: rssi,
      payload_hex: formattedHex,
      available_services: services,
      battery_pct: 89,
      firmware_rev: 'BLE 5.3 Custom',
      mtu_size: 247,
      source: 'virtual',
    };
    profileMap.set(deviceId, profile);

    const pkt: PacketTelemetry = {
      packet_id: crypto.randomUUID(),
      device_id: deviceId,
      device_name: name,
      mac_address: mac,
      rssi,
      packet_type: 'ADV_IND',
      payload_hex: formattedHex,
      gatt_services: [],
      is_connected: false,
      timestamp: new Date().toISOString(),
      device_health: computeDeviceHealth(rssi, false, profile),
    };
    trackedDevices.set(deviceId, pkt);
    broadcastPacket(pkt);
    res.status(201).json(pkt);
  });

  app.post('/api/simulator/spike', (req, res) => {
    const requestedId = String(req.body?.device_id || '').trim();
    const recover = Boolean(req.body?.recover);

    if (recover) {
      if (requestedId) {
        spikedUntilMap.delete(requestedId);
      } else {
        spikedUntilMap.clear();
      }
      const entries = Array.from(trackedDevices.values());
      for (const dev of entries) {
        if (requestedId && dev.device_id !== requestedId) continue;
        const profile = profileMap.get(dev.device_id);
        const restoredRssi = profile?.base_rssi ?? -54;
        const recoveredPkt: PacketTelemetry = {
          ...dev,
          packet_id: crypto.randomUUID(),
          rssi: restoredRssi,
          packet_type: dev.is_connected ? 'CONN_ESTABLISHED' : 'ADV_IND',
          timestamp: new Date().toISOString(),
          device_health: computeDeviceHealth(restoredRssi, dev.is_connected, profile),
        };
        trackedDevices.set(dev.device_id, recoveredPkt);
        broadcastPacket(recoveredPkt);
      }
      res.json({ status: 'RECOVERED', message: 'Simulated RF/latency spike cleared.' });
      return;
    }

    const allDevices = Array.from(trackedDevices.values());
    const target =
      (requestedId ? trackedDevices.get(requestedId) : undefined) ||
      allDevices.find((d) => d.is_connected) ||
      allDevices.find((d) => !profileMap.get(d.device_id)?.simulate_reject) ||
      allDevices[0];

    if (!target) {
      res.status(404).json({ error: 'No tracked BLE peripherals available to spike' });
      return;
    }

    const profile = profileMap.get(target.device_id);
    const services =
      target.gatt_services.length > 0
        ? target.gatt_services
        : profile?.available_services ?? ['00001800-0000-1000-8000-00805f9b34fb'];

    const spike: SpikeState = {
      expiresAt: Date.now() + 18000,
      rssi: -89,
      latency_ms: 68,
      packet_loss_pct: 3.4,
      link_stability: 'Degraded',
      battery_pct:
        typeof profile?.battery_pct === 'number'
          ? Math.min(profile.battery_pct, 18)
          : undefined,
    };
    spikedUntilMap.set(target.device_id, spike);

    const spikedPkt: PacketTelemetry = {
      ...target,
      packet_id: crypto.randomUUID(),
      rssi: spike.rssi,
      is_connected: true,
      gatt_services: services,
      packet_type: 'CONN_ESTABLISHED',
      timestamp: new Date().toISOString(),
      device_health: computeDeviceHealth(spike.rssi, true, profile, {
        latency_ms: spike.latency_ms,
        packet_loss_pct: spike.packet_loss_pct,
        link_stability: spike.link_stability,
        battery_pct: spike.battery_pct ?? target.device_health?.battery_pct ?? null,
        source: target.device_health?.source ?? profile?.source ?? 'virtual',
        firmware_rev: target.device_health?.firmware_rev ?? profile?.firmware_rev,
      }),
    };

    trackedDevices.set(target.device_id, spikedPkt);
    broadcastPacket(spikedPkt);
    res.json(spikedPkt);
  });

  // Expose audited standalone codebase tree & file reader for the Code & Bug-Fix Explorer
  const projectDir = path.resolve(process.cwd(), 'bluetooth-packet-tracker');
  app.get('/api/workspace/files', (_req, res) => {
    try {
      res.json(collectWorkspaceFiles(projectDir));
    } catch {
      res.json([]);
    }
  });

  app.get('/api/workspace/file', (req, res) => {
    const rel = String(req.query.path || '');
    const resolved = path.resolve(projectDir, rel);
    if (!resolved.startsWith(projectDir + path.sep) && resolved !== projectDir) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.json({ path: rel, content: fs.readFileSync(resolved, 'utf8') });
  });

  // Periodic BLE advertisement & connected-link health keepalive emission
  setInterval(() => {
    const entries = Array.from(trackedDevices.values());
    if (entries.length === 0) return;
    const target = entries[Math.floor(Math.random() * entries.length)];
    if (pendingHandshakes.has(target.device_id)) return;

    const activeSpike = spikedUntilMap.get(target.device_id);
    if (activeSpike && activeSpike.expiresAt <= Date.now()) {
      spikedUntilMap.delete(target.device_id);
    }
    const validSpike = spikedUntilMap.get(target.device_id);

    const profile = profileMap.get(target.device_id);
    const baseRssi = validSpike ? validSpike.rssi : (profile?.base_rssi ?? target.rssi);
    const jitter = Math.floor(Math.random() * 7) - 3;
    const nextRssi = Math.max(-98, Math.min(-28, baseRssi + jitter));

    const connectedPacketTypes: Array<'CONN_ESTABLISHED' | 'READ' | 'WRITE' | 'NOTIFY'> = [
      'NOTIFY',
      'READ',
      'WRITE',
      'CONN_ESTABLISHED',
    ];
    const nextPacketType = target.is_connected
      ? connectedPacketTypes[Math.floor(Math.random() * connectedPacketTypes.length)]
      : 'ADV_IND';

    const packet: PacketTelemetry = {
      packet_id: crypto.randomUUID(),
      device_id: target.device_id,
      device_name: target.device_name,
      mac_address: target.mac_address,
      rssi: nextRssi,
      packet_type: nextPacketType,
      payload_hex: target.payload_hex,
      gatt_services: target.gatt_services,
      is_connected: target.is_connected,
      timestamp: new Date().toISOString(),
      device_health: computeDeviceHealth(nextRssi, target.is_connected, profile, {
        source: target.device_health?.source ?? profile?.source ?? 'virtual',
        battery_pct:
          validSpike?.battery_pct ??
          target.device_health?.battery_pct ??
          profile?.battery_pct ??
          null,
        firmware_rev: target.device_health?.firmware_rev ?? profile?.firmware_rev,
        ...(validSpike
          ? {
              latency_ms: validSpike.latency_ms + Math.floor(Math.random() * 7) - 3,
              packet_loss_pct: validSpike.packet_loss_pct,
              link_stability: validSpike.link_stability,
            }
          : {}),
      }),
    };
    trackedDevices.set(target.device_id, packet);
    broadcastPacket(packet);
  }, 1500);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(process.cwd(), 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (socket) => {
    wsClients.add(socket);
    socket.on('close', () => wsClients.delete(socket));
    socket.on('error', () => wsClients.delete(socket));
  });

  server.on('upgrade', (request, socket, head) => {
    const urlPath = request.url?.split('?')[0];
    if (urlPath === '/ws/packets') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] BLE Workbench active on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
