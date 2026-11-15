import { useState } from 'react';
import { Bell, RefreshCw, ShieldCheck } from 'lucide-react';
import { useBluetoothClient } from './hooks/useBluetoothClient';
import { useHealthAlerts } from './hooks/useHealthAlerts';
import { ConnectionManager } from './components/ConnectionManager';
import { PacketTracker } from './components/PacketTracker';
import { HealthAlertCenter } from './components/HealthAlertCenter';

type ActiveView = 'connections' | 'packets';

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>('connections');
  const [alertsDrawerOpen, setAlertsDrawerOpen] = useState(false);

  const {
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
    simulateHealthSpike,
    clearPacketHistory,
  } = useBluetoothClient('workbench');

  const {
    thresholds,
    alerts,
    toasts,
    unreadCount,
    activeBreachCount,
    criticalBreachCount,
    activeBreachDeviceIds,
    updateThresholds,
    resetThresholds,
    acknowledgeAlert,
    acknowledgeAll,
    clearAlerts,
    dismissToast,
  } = useHealthAlerts(devices);

  const connectedCount = devices.filter((d) => d.is_connected).length;
  const latestPacket = packetHistory[0] ?? null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Three-Zone Top Bar Contract */}
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-4">
          <a
            href="#connections"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('connections');
            }}
            className="whitespace-nowrap shrink-0 text-base font-bold tracking-tight text-sky-400"
          >
            BLE Connection &amp; Packet Suite
          </a>

          <nav className="flex items-center gap-6 text-sm font-medium">
            <button
              type="button"
              onClick={() => setActiveView('connections')}
              className={`whitespace-nowrap shrink-0 border-b-2 pb-1 transition-colors ${
                activeView === 'connections'
                  ? 'border-blue-500 text-white'
                  : 'border-transparent text-zinc-400 hover:text-zinc-100'
              }`}
            >
              Radar and Connection
            </button>
            <button
              type="button"
              onClick={() => setActiveView('packets')}
              className={`whitespace-nowrap shrink-0 border-b-2 pb-1 transition-colors ${
                activeView === 'packets'
                  ? 'border-blue-500 text-white'
                  : 'border-transparent text-zinc-400 hover:text-zinc-100'
              }`}
            >
              Packet Stream
            </button>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => void syncDevicesAndHealth()}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Sync Cache
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-5 space-y-5">
        {/* Adapter & System Health Strip */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-zinc-800 bg-zinc-900/70 px-4 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-2.5 text-zinc-300">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span
                className={`h-2 w-2 rounded-full ${
                  wsConnected ? 'bg-emerald-500' : 'bg-red-500'
                }`}
              />
              {wsConnected ? 'Live Stream Online' : 'Reconnecting'}
            </span>
            <span className="text-zinc-600" aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Health: {health?.adapter_health || (wsConnected ? 'Optimal' : 'Offline')}
            </span>
            <span className="text-zinc-600" aria-hidden="true">·</span>
            <span className="text-zinc-400">
              {health?.adapter_info || 'BLE Controller Pending'}
            </span>
            <span className="text-zinc-600" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-zinc-300">
              {devices.length} Nodes · {connectedCount} Linked · Avg RSSI{' '}
              {health?.avg_rssi ?? '—'} dBm
              {health?.avg_latency_ms !== null && health?.avg_latency_ms !== undefined
                ? ` · Avg Latency ${health.avg_latency_ms}ms`
                : ''}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setAlertsDrawerOpen(true)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                criticalBreachCount > 0
                  ? 'border-red-700/80 bg-red-950/60 text-red-200 hover:bg-red-900/60'
                  : activeBreachCount > 0 || unreadCount > 0
                  ? 'border-amber-700/80 bg-amber-950/50 text-amber-200 hover:bg-amber-900/50'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
              }`}
            >
              <Bell className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Health Alerts</span>
              <span className="font-mono tabular-nums text-[11px]">
                ({unreadCount > 0 ? `${unreadCount} new` : `${activeBreachCount} active`})
              </span>
            </button>
          </div>
        </div>

        {activeView === 'connections' && (
          <ConnectionManager
            devices={devices}
            latestPacket={latestPacket}
            latencyHistory={latencyHistory}
            lastError={lastError}
            onSync={() => void syncDevicesAndHealth()}
            onConnectionAction={sendConnectionRequest}
            onScanPhysicalDevice={scanPhysicalBluetoothDevice}
            alertDeviceIds={activeBreachDeviceIds}
            onOpenAlerts={() => setAlertsDrawerOpen(true)}
          />
        )}

        {activeView === 'packets' && (
          <PacketTracker
            packetHistory={packetHistory}
            isPaused={isPaused}
            onTogglePause={() => setIsPaused((p) => !p)}
            onClearBuffer={clearPacketHistory}
          />
        )}
      </main>

      <HealthAlertCenter
        isOpen={alertsDrawerOpen}
        onClose={() => setAlertsDrawerOpen(false)}
        onOpen={() => setAlertsDrawerOpen(true)}
        devices={devices}
        thresholds={thresholds}
        alerts={alerts}
        toasts={toasts}
        unreadCount={unreadCount}
        activeBreachCount={activeBreachCount}
        onUpdateThresholds={updateThresholds}
        onResetThresholds={resetThresholds}
        onAcknowledgeAlert={acknowledgeAlert}
        onAcknowledgeAll={acknowledgeAll}
        onClearAlerts={clearAlerts}
        onDismissToast={dismissToast}
        onSimulateSpike={simulateHealthSpike}
      />
    </div>
  );
}
