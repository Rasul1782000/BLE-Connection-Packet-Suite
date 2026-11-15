import React, { useState } from 'react';
import {
  Activity,
  Battery,
  BluetoothSearching,
  Cpu,
  Link2,
  RefreshCw,
  ShieldCheck,
  Unlink,
} from 'lucide-react';
import type { ConnectionActionResponse, PacketTelemetry } from '../types/bluetooth';
import { RssiText } from './RssiText';
import { BleTopology3D, classifyDeviceArchetype } from './BleTopology3D';
import { LatencySparkline } from './LatencySparkline';

interface ConnectionManagerProps {
  devices: PacketTelemetry[];
  latestPacket: PacketTelemetry | null;
  latencyHistory: Record<string, number[]>;
  lastError: string | null;
  onSync: () => void;
  onConnectionAction: (
    deviceId: string,
    action: 'CONNECT' | 'DISCONNECT'
  ) => Promise<ConnectionActionResponse>;
  onScanPhysicalDevice: () => Promise<{
    device_name: string;
    services_count: number;
    battery_pct: number | null;
  }>;
  alertDeviceIds?: Set<string>;
  onOpenAlerts?: () => void;
}

const STABILITY_TONE: Record<string, string> = {
  Excellent: 'text-emerald-400',
  Good: 'text-sky-400',
  Fair: 'text-amber-400',
  Degraded: 'text-red-400',
  Standby: 'text-zinc-400',
};

export const ConnectionManager: React.FC<ConnectionManagerProps> = ({
  devices,
  latestPacket,
  latencyHistory,
  lastError,
  onSync,
  onConnectionAction,
  onScanPhysicalDevice,
  alertDeviceIds,
  onOpenAlerts,
}) => {
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [scanningPhysical, setScanningPhysical] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isError, setIsError] = useState<boolean>(false);

  const handleAction = async (device: PacketTelemetry, action: 'CONNECT' | 'DISCONNECT') => {
    const id = device.device_id;
    if (loadingIds.has(id)) return;

    setLoadingIds((prev) => new Set(prev).add(id));
    setIsError(false);
    setStatusMessage(
      `Transmitting ${action} request to ${device.device_name || device.mac_address}...`
    );

    try {
      const res = await onConnectionAction(id, action);
      setStatusMessage(`[${res.status}] ${res.message}`);
    } catch (err) {
      setIsError(true);
      setStatusMessage(
        `[FAILED] ${err instanceof Error ? err.message : 'Connection request failed'}`
      );
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handlePhysicalScan = async () => {
    setScanningPhysical(true);
    setIsError(false);
    setStatusMessage('Opening browser Bluetooth device chooser...');
    try {
      const result = await onScanPhysicalDevice();
      const batText =
        result.battery_pct !== null ? ` · Battery ${result.battery_pct}%` : '';
      setStatusMessage(
        `[CONNECTED] Physical BLE device "${result.device_name}" paired (${result.services_count} GATT services${batText})`
      );
    } catch (err) {
      setIsError(true);
      setStatusMessage(
        err instanceof Error ? err.message : 'Physical Bluetooth scan cancelled or unavailable'
      );
    } finally {
      setScanningPhysical(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Interactive 3D Spatial Topology */}
      <BleTopology3D
        devices={devices}
        latestPacket={latestPacket}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={setSelectedDeviceId}
        onQuickConnectToggle={(dev) =>
          void handleAction(dev, dev.is_connected ? 'DISCONNECT' : 'CONNECT')
        }
      />

      {/* Device Discovery & Health Matrix */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">
              Discovered Peripherals &amp; Link Health
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              Pair physical Web Bluetooth hardware or manage active peripherals with live RSSI, latency, battery, and GATT diagnostics.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={scanningPhysical}
              onClick={() => void handlePhysicalScan()}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-60"
            >
              <BluetoothSearching className="h-3.5 w-3.5" aria-hidden="true" />
              {scanningPhysical ? 'Scanning Hardware...' : 'Scan Physical BLE Device'}
            </button>

            <button
              type="button"
              onClick={onSync}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Sync Cache
            </button>
          </div>
        </div>

        {statusMessage && (
          <div
            role="status"
            className={`mb-4 rounded-md border px-4 py-2.5 text-sm ${
              isError
                ? 'border-red-800 bg-red-950/60 text-red-200'
                : 'border-sky-800 bg-sky-950/60 text-sky-100'
            }`}
          >
            {statusMessage}
          </div>
        )}

        {lastError && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-red-800 bg-red-950/60 px-4 py-2.5 text-sm text-red-200"
          >
            {lastError}
          </div>
        )}

        {devices.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/50 px-6 py-12 text-center text-sm text-zinc-400">
            No BLE peripherals discovered yet. Click Scan Physical BLE Device or Sync Cache.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {devices.map((device) => {
              const isLoading = loadingIds.has(device.device_id);
              const isSelected = selectedDeviceId === device.device_id;
              const isAlerting = alertDeviceIds?.has(device.device_id) ?? false;
              const health = device.device_health;
              const stability = health?.link_stability || 'Standby';
              const stabilityTone = STABILITY_TONE[stability] || 'text-zinc-400';

              const linkLabel = device.is_connected
                ? 'GATT Connected'
                : device.packet_type === 'CONN_REQ_SENT'
                ? 'Handshaking'
                : device.packet_type === 'CONN_FAILED'
                ? 'Handshake Failed'
                : 'Advertising';

              const sourceLabel =
                health?.source === 'web-bluetooth'
                  ? 'Physical WebBLE'
                  : health?.source === 'rust-daemon'
                  ? 'Rust Host'
                  : 'Virtual BLE';

              return (
                <article
                  key={device.device_id}
                  onClick={() => setSelectedDeviceId(device.device_id)}
                  className={`flex cursor-pointer flex-col justify-between rounded-lg border bg-zinc-950 p-4 transition-colors ${
                    isAlerting
                      ? 'border-amber-600/80'
                      : device.is_connected
                      ? 'border-emerald-600/80'
                      : isSelected
                      ? 'border-sky-500/80'
                      : 'border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div>
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold text-zinc-100">
                          {device.device_name || 'Unnamed Peripheral'}
                        </h2>
                        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-zinc-500">
                          <span>{device.mac_address}</span>
                          <span aria-hidden="true">·</span>
                          <span className="capitalize text-sky-400">
                            {classifyDeviceArchetype(device)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{sourceLabel}</span>
                        </div>
                      </div>
                      <RssiText rssi={device.rssi} />
                    </div>

                    {/* Link & Health Summary */}
                    <div className="space-y-2 border-t border-zinc-800/80 py-2.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Link State</span>
                        <span
                          className={`font-semibold ${
                            device.is_connected
                              ? 'text-emerald-400'
                              : device.packet_type === 'CONN_FAILED'
                              ? 'text-red-400'
                              : device.packet_type === 'CONN_REQ_SENT'
                              ? 'text-amber-400'
                              : 'text-zinc-300'
                          }`}
                        >
                          {linkLabel}
                        </span>
                      </div>

                      {health && (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="inline-flex items-center gap-1 text-zinc-400">
                              <ShieldCheck className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
                              Link Health
                            </span>
                            <span className={`font-mono font-medium tabular-nums ${stabilityTone}`}>
                              {stability} · {health.signal_quality_pct}%
                            </span>
                          </div>

                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
                            <div
                              className={`h-full transition-all duration-300 ${
                                health.signal_quality_pct >= 75
                                  ? 'bg-emerald-500'
                                  : health.signal_quality_pct >= 50
                                  ? 'bg-sky-500'
                                  : 'bg-amber-500'
                              }`}
                              style={{ width: `${health.signal_quality_pct}%` }}
                            />
                          </div>

                          <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-[11px] tabular-nums text-zinc-400">
                            <div className="flex items-center gap-1">
                              <Battery className="h-3 w-3 text-zinc-500" aria-hidden="true" />
                              <span>
                                {health.battery_pct !== null ? `${health.battery_pct}%` : '—'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Activity className="h-3 w-3 text-zinc-500" aria-hidden="true" />
                              <span>
                                {health.latency_ms !== null ? `${health.latency_ms}ms` : 'Idle'}
                              </span>
                            </div>
                            <div className="flex items-center justify-end gap-1">
                              <Cpu className="h-3 w-3 text-zinc-500" aria-hidden="true" />
                              <span>MTU {health.mtu_size}</span>
                            </div>
                          </div>

                          <LatencySparkline
                            deviceId={device.device_id}
                            samples={latencyHistory[device.device_id] ?? []}
                            isActive={device.is_connected}
                            currentLatency={health.latency_ms}
                          />

                          <div className="flex items-center justify-between text-[11px] text-zinc-500">
                            <span>{health.firmware_rev}</span>
                            {isAlerting && onOpenAlerts ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenAlerts();
                                }}
                                className="font-mono font-medium text-amber-400 hover:text-amber-300"
                              >
                                Threshold Breach · Inspect
                              </button>
                            ) : (
                              <span className="font-mono tabular-nums">
                                Loss {health.packet_loss_pct.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {device.gatt_services && device.gatt_services.length > 0 && (
                      <div className="mt-2 rounded-md border border-zinc-800/80 bg-zinc-900/70 p-2.5">
                        <div className="mb-1.5 text-xs font-medium text-zinc-400">
                          Discovered GATT Services ({device.gatt_services.length})
                        </div>
                        <ul className="max-h-24 space-y-1 overflow-y-auto">
                          {device.gatt_services.map((uuid) => (
                            <li
                              key={uuid}
                              className="truncate font-mono text-[11px] text-sky-400"
                            >
                              {uuid}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      disabled={device.is_connected || isLoading}
                      onClick={() => void handleAction(device, 'CONNECT')}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-950 disabled:text-blue-300/40"
                    >
                      <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {isLoading && !device.is_connected ? 'Handshaking...' : 'Request Connect'}
                    </button>
                    <button
                      type="button"
                      disabled={!device.is_connected || isLoading}
                      onClick={() => void handleAction(device, 'DISCONNECT')}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-950 disabled:text-red-300/40"
                    >
                      <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
                      {isLoading && device.is_connected ? 'Disconnecting...' : 'Disconnect'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
