import React, { useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Bell,
  Check,
  CheckCheck,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import type { HealthAlert, HealthThresholds, PacketTelemetry } from '../types/bluetooth';

interface HealthAlertCenterProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
  devices: PacketTelemetry[];
  thresholds: HealthThresholds;
  alerts: HealthAlert[];
  toasts: HealthAlert[];
  unreadCount: number;
  activeBreachCount: number;
  onUpdateThresholds: (next: Partial<HealthThresholds>) => void;
  onResetThresholds: () => void;
  onAcknowledgeAlert: (alertId: string) => void;
  onAcknowledgeAll: () => void;
  onClearAlerts: () => void;
  onDismissToast: (alertId: string) => void;
  onSimulateSpike: (deviceId?: string, recover?: boolean) => Promise<unknown>;
}

function formatUtcTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(11, 19);
}

export const HealthAlertCenter: React.FC<HealthAlertCenterProps> = ({
  isOpen,
  onClose,
  onOpen,
  devices,
  thresholds,
  alerts,
  toasts,
  unreadCount,
  activeBreachCount,
  onUpdateThresholds,
  onResetThresholds,
  onAcknowledgeAlert,
  onAcknowledgeAll,
  onClearAlerts,
  onDismissToast,
  onSimulateSpike,
}) => {
  const [showRules, setShowRules] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [simStatus, setSimStatus] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');

  const handleSpike = async (recover = false) => {
    setSimulating(true);
    setSimStatus(null);
    try {
      await onSimulateSpike(selectedTargetId || undefined, recover);
      setSimStatus(
        recover
          ? 'Cleared simulated RF/latency degradation.'
          : 'Injected 68 ms GATT latency & -89 dBm RF spike.'
      );
    } catch (err) {
      setSimStatus(err instanceof Error ? err.message : 'Unable to trigger spike simulation');
    } finally {
      setSimulating(false);
    }
  };

  return (
    <>
      {/* Non-blocking Floating Health Alert Toasts */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          aria-label="Bluetooth device health notifications"
          className="pointer-events-none fixed bottom-5 right-5 z-40 flex w-[372px] max-w-[calc(100vw-2rem)] flex-col gap-2.5"
        >
          {toasts.map((toast) => {
            const isCritical = toast.severity === 'critical';
            return (
              <div
                key={toast.id}
                role="alert"
                className={`pointer-events-auto rounded-lg border bg-zinc-950 p-3.5 shadow-2xl ${
                  isCritical ? 'border-red-700/80' : 'border-amber-700/80'
                }`}
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-start gap-2.5 min-w-0">
                    {isCritical ? (
                      <AlertOctagon
                        className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
                        aria-hidden="true"
                      />
                    ) : (
                      <AlertTriangle
                        className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span
                          className={`font-mono font-semibold uppercase tracking-wide ${
                            isCritical ? 'text-red-400' : 'text-amber-400'
                          }`}
                        >
                          {toast.severity}
                        </span>
                        <span className="text-zinc-600" aria-hidden="true">·</span>
                        <span className="truncate font-semibold text-zinc-100">
                          {toast.title}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-300">
                        {toast.message}
                      </p>
                      <div className="mt-2 flex items-center gap-3 font-mono text-[11px] tabular-nums text-zinc-400">
                        <span>Measured: <strong className="text-zinc-200">{toast.valueLabel}</strong></span>
                        <span>Limit: {toast.thresholdLabel}</span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDismissToast(toast.id)}
                    aria-label="Dismiss notification"
                    className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>

                <div className="mt-2.5 flex items-center justify-end gap-2 border-t border-zinc-900 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      onAcknowledgeAlert(toast.id);
                    }}
                    className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                  >
                    Acknowledge
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDismissToast(toast.id);
                      onOpen();
                    }}
                    className="rounded bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-blue-500"
                  >
                    Inspect Alerts
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Slide-over Health Alerts & Threshold Configuration Drawer */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/70"
          role="dialog"
          aria-modal="true"
          aria-labelledby="health-alert-drawer-title"
        >
          <div className="flex h-full w-full max-w-xl flex-col border-l border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl">
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <Bell className="h-4 w-4 text-sky-400" aria-hidden="true" />
                <div>
                  <h2
                    id="health-alert-drawer-title"
                    className="text-sm font-semibold text-zinc-100"
                  >
                    Health Alerts &amp; Threshold Rules
                  </h2>
                  <p className="font-mono text-[11px] tabular-nums text-zinc-400">
                    {unreadCount} unacknowledged · {activeBreachCount} active threshold{' '}
                    {activeBreachCount === 1 ? 'breach' : 'breaches'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close alerts drawer"
                className="rounded-md border border-zinc-800 bg-zinc-950 p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* Simulator & Rule Controls Bar */}
            <div className="border-b border-zinc-800 bg-zinc-900/50 px-5 py-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRules((s) => !s)}
                    className="inline-flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
                    {showRules ? 'Hide Thresholds' : 'Configure Thresholds'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSpike(false)}
                    disabled={simulating || devices.length === 0}
                    className="inline-flex items-center gap-1.5 rounded border border-amber-700/70 bg-amber-950/50 px-2.5 py-1.5 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-900/50 disabled:opacity-50"
                  >
                    <Zap className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                    Simulate Spike
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSpike(true)}
                    disabled={simulating || devices.length === 0}
                    className="inline-flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-50"
                  >
                    <Activity className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                    Recover
                  </button>
                </div>

                <select
                  aria-label="Target device for spike simulation"
                  value={selectedTargetId}
                  onChange={(e) => setSelectedTargetId(e.target.value)}
                  className="max-w-[175px] rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Auto-select Peripheral</option>
                  {devices.map((d) => (
                    <option key={d.device_id} value={d.device_id}>
                      {d.device_name || d.mac_address}
                    </option>
                  ))}
                </select>
              </div>

              {simStatus && (
                <p className="font-mono text-[11px] text-sky-300">{simStatus}</p>
              )}
            </div>

            {/* Configurable Threshold Inputs */}
            {showRules && (
              <div className="border-b border-zinc-800 bg-zinc-900/30 px-5 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Active Alert Thresholds
                  </span>
                  <button
                    type="button"
                    onClick={onResetThresholds}
                    className="inline-flex items-center gap-1 text-xs text-zinc-400 transition-colors hover:text-zinc-100"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                    Reset Defaults
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
                    <span className="block text-[11px] text-zinc-400">
                      Min Signal Quality (%)
                    </span>
                    <input
                      type="number"
                      min={10}
                      max={90}
                      step={5}
                      value={thresholds.minSignalQualityPct}
                      onChange={(e) =>
                        onUpdateThresholds({
                          minSignalQualityPct: Math.max(10, Math.min(90, Number(e.target.value) || 45)),
                        })
                      }
                      className="mt-1 w-full bg-transparent font-mono text-sm font-semibold tabular-nums text-zinc-100 focus:outline-none"
                    />
                  </label>

                  <label className="block rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
                    <span className="block text-[11px] text-zinc-400">
                      Max GATT Latency (ms)
                    </span>
                    <input
                      type="number"
                      min={10}
                      max={250}
                      step={5}
                      value={thresholds.maxLatencyMs}
                      onChange={(e) =>
                        onUpdateThresholds({
                          maxLatencyMs: Math.max(10, Math.min(250, Number(e.target.value) || 35)),
                        })
                      }
                      className="mt-1 w-full bg-transparent font-mono text-sm font-semibold tabular-nums text-zinc-100 focus:outline-none"
                    />
                  </label>

                  <label className="block rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
                    <span className="block text-[11px] text-zinc-400">
                      Max Packet Loss (%)
                    </span>
                    <input
                      type="number"
                      min={0.1}
                      max={20}
                      step={0.1}
                      value={thresholds.maxPacketLossPct}
                      onChange={(e) =>
                        onUpdateThresholds({
                          maxPacketLossPct: Math.max(0.1, Math.min(20, Number(e.target.value) || 1.0)),
                        })
                      }
                      className="mt-1 w-full bg-transparent font-mono text-sm font-semibold tabular-nums text-zinc-100 focus:outline-none"
                    />
                  </label>

                  <label className="block rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
                    <span className="block text-[11px] text-zinc-400">
                      Min Battery (%)
                    </span>
                    <input
                      type="number"
                      min={5}
                      max={80}
                      step={5}
                      value={thresholds.minBatteryPct}
                      onChange={(e) =>
                        onUpdateThresholds({
                          minBatteryPct: Math.max(5, Math.min(80, Number(e.target.value) || 25)),
                        })
                      }
                      className="mt-1 w-full bg-transparent font-mono text-sm font-semibold tabular-nums text-zinc-100 focus:outline-none"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-zinc-300">
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={thresholds.alertOnUnstableLink}
                      onChange={(e) =>
                        onUpdateThresholds({ alertOnUnstableLink: e.target.checked })
                      }
                      className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-900 accent-blue-600"
                    />
                    Alert on Fair / Degraded link state
                  </label>

                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={thresholds.connectedOnly}
                      onChange={(e) =>
                        onUpdateThresholds({ connectedOnly: e.target.checked })
                      }
                      className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-900 accent-blue-600"
                    />
                    Connected devices only
                  </label>
                </div>
              </div>
            )}

            {/* Alert History Toolbar */}
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-2.5 text-xs">
              <span className="font-medium text-zinc-300">
                Notification Log ({alerts.length})
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onAcknowledgeAll}
                  disabled={unreadCount === 0}
                  className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-40"
                >
                  <CheckCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                  Ack All
                </button>
                <button
                  type="button"
                  onClick={onClearAlerts}
                  disabled={alerts.length === 0}
                  className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                  Clear
                </button>
              </div>
            </div>

            {/* Alert Event Feed */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
              {alerts.length === 0 ? (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 text-center">
                  <p className="text-sm font-medium text-zinc-200">
                    All monitored BLE health metrics are within bounds
                  </p>
                  <p className="mt-1.5 text-xs text-zinc-400">
                    Alerts automatically fire when RF quality, GATT latency, packet loss,
                    battery, or link stability crosses your configured thresholds.
                  </p>
                </div>
              ) : (
                alerts.map((alert) => {
                  const isCritical = alert.severity === 'critical';
                  return (
                    <div
                      key={alert.id}
                      className={`rounded-lg border p-3.5 transition-colors ${
                        alert.acknowledged
                          ? 'border-zinc-800/80 bg-zinc-900/40 opacity-75'
                          : isCritical
                          ? 'border-red-800/80 bg-zinc-900'
                          : 'border-amber-800/80 bg-zinc-900'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span
                              className={`font-mono font-semibold uppercase ${
                                isCritical ? 'text-red-400' : 'text-amber-400'
                              }`}
                            >
                              {alert.severity}
                            </span>
                            <span className="text-zinc-600" aria-hidden="true">·</span>
                            <span className="font-semibold text-zinc-100">
                              {alert.title}
                            </span>
                            <span className="text-zinc-600" aria-hidden="true">·</span>
                            <span className="font-mono text-[11px] tabular-nums text-zinc-400">
                              {formatUtcTime(alert.timestamp)} UTC
                            </span>
                          </div>

                          <p className="mt-1 text-xs text-zinc-300">{alert.message}</p>

                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums text-zinc-400">
                            <span>Device: {alert.device_name}</span>
                            <span>MAC: {alert.mac_address}</span>
                            <span>
                              Value: <strong className="text-zinc-200">{alert.valueLabel}</strong>{' '}
                              (limit {alert.thresholdLabel})
                            </span>
                          </div>
                        </div>

                        {!alert.acknowledged ? (
                          <button
                            type="button"
                            onClick={() => onAcknowledgeAlert(alert.id)}
                            className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
                          >
                            <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                            Ack
                          </button>
                        ) : (
                          <span className="shrink-0 font-mono text-[11px] text-zinc-500">
                            ACKED
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
