import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AlertMetric,
  AlertSeverity,
  HealthAlert,
  HealthThresholds,
  PacketTelemetry,
} from '../types/bluetooth';
import { deriveDeviceHealth } from './useBluetoothClient';

const STORAGE_KEY = 'ble_health_thresholds_v1';
const MAX_ALERT_HISTORY = 60;
const MAX_VISIBLE_TOASTS = 3;
const TOAST_TTL_MS = 6500;
const ALERT_COOLDOWN_MS = 18000;

export const DEFAULT_THRESHOLDS: HealthThresholds = {
  minSignalQualityPct: 45,
  maxLatencyMs: 35,
  maxPacketLossPct: 1.0,
  minBatteryPct: 25,
  alertOnUnstableLink: true,
  connectedOnly: false,
};

interface BreachCandidate {
  key: string;
  device_id: string;
  device_name: string;
  mac_address: string;
  metric: AlertMetric;
  severity: AlertSeverity;
  title: string;
  message: string;
  valueLabel: string;
  thresholdLabel: string;
}

function loadSavedThresholds(): HealthThresholds {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THRESHOLDS;
    const parsed = JSON.parse(raw) as Partial<HealthThresholds>;
    return {
      minSignalQualityPct:
        typeof parsed.minSignalQualityPct === 'number'
          ? Math.max(10, Math.min(90, parsed.minSignalQualityPct))
          : DEFAULT_THRESHOLDS.minSignalQualityPct,
      maxLatencyMs:
        typeof parsed.maxLatencyMs === 'number'
          ? Math.max(10, Math.min(250, parsed.maxLatencyMs))
          : DEFAULT_THRESHOLDS.maxLatencyMs,
      maxPacketLossPct:
        typeof parsed.maxPacketLossPct === 'number'
          ? Math.max(0.1, Math.min(20, parsed.maxPacketLossPct))
          : DEFAULT_THRESHOLDS.maxPacketLossPct,
      minBatteryPct:
        typeof parsed.minBatteryPct === 'number'
          ? Math.max(5, Math.min(80, parsed.minBatteryPct))
          : DEFAULT_THRESHOLDS.minBatteryPct,
      alertOnUnstableLink:
        typeof parsed.alertOnUnstableLink === 'boolean'
          ? parsed.alertOnUnstableLink
          : DEFAULT_THRESHOLDS.alertOnUnstableLink,
      connectedOnly:
        typeof parsed.connectedOnly === 'boolean'
          ? parsed.connectedOnly
          : DEFAULT_THRESHOLDS.connectedOnly,
    };
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

function evaluateDeviceBreaches(
  devices: PacketTelemetry[],
  thresholds: HealthThresholds
): BreachCandidate[] {
  const breaches: BreachCandidate[] = [];

  for (const device of devices) {
    const health = device.device_health ?? deriveDeviceHealth(device);
    const labelName = device.device_name || device.mac_address;
    const evaluatePassive = !thresholds.connectedOnly || device.is_connected;

    if (evaluatePassive && health.signal_quality_pct < thresholds.minSignalQualityPct) {
      const criticalFloor = Math.max(15, thresholds.minSignalQualityPct - 18);
      breaches.push({
        key: `${device.device_id}:signal_quality`,
        device_id: device.device_id,
        device_name: labelName,
        mac_address: device.mac_address,
        metric: 'signal_quality',
        severity: health.signal_quality_pct <= criticalFloor ? 'critical' : 'warning',
        title: 'Low RF Signal Quality',
        message: `${labelName} signal dropped to ${health.signal_quality_pct}% (${device.rssi} dBm), below the ${thresholds.minSignalQualityPct}% floor.`,
        valueLabel: `${health.signal_quality_pct}% (${device.rssi} dBm)`,
        thresholdLabel: `>= ${thresholds.minSignalQualityPct}%`,
      });
    }

    if (
      device.is_connected &&
      health.latency_ms !== null &&
      health.latency_ms > thresholds.maxLatencyMs
    ) {
      breaches.push({
        key: `${device.device_id}:latency`,
        device_id: device.device_id,
        device_name: labelName,
        mac_address: device.mac_address,
        metric: 'latency',
        severity: health.latency_ms >= thresholds.maxLatencyMs * 1.5 ? 'critical' : 'warning',
        title: 'GATT Latency Spike',
        message: `${labelName} round-trip latency spiked to ${health.latency_ms} ms (threshold ${thresholds.maxLatencyMs} ms).`,
        valueLabel: `${health.latency_ms} ms`,
        thresholdLabel: `<= ${thresholds.maxLatencyMs} ms`,
      });
    }

    if (device.is_connected && health.packet_loss_pct > thresholds.maxPacketLossPct) {
      breaches.push({
        key: `${device.device_id}:packet_loss`,
        device_id: device.device_id,
        device_name: labelName,
        mac_address: device.mac_address,
        metric: 'packet_loss',
        severity:
          health.packet_loss_pct >= Math.max(2.0, thresholds.maxPacketLossPct * 2)
            ? 'critical'
            : 'warning',
        title: 'Elevated Packet Loss',
        message: `${labelName} packet loss reached ${health.packet_loss_pct.toFixed(1)}% (limit ${thresholds.maxPacketLossPct.toFixed(1)}%).`,
        valueLabel: `${health.packet_loss_pct.toFixed(1)}%`,
        thresholdLabel: `<= ${thresholds.maxPacketLossPct.toFixed(1)}%`,
      });
    }

    if (
      thresholds.alertOnUnstableLink &&
      device.is_connected &&
      (health.link_stability === 'Degraded' || health.link_stability === 'Fair')
    ) {
      breaches.push({
        key: `${device.device_id}:stability`,
        device_id: device.device_id,
        device_name: labelName,
        mac_address: device.mac_address,
        metric: 'stability',
        severity: health.link_stability === 'Degraded' ? 'critical' : 'warning',
        title: 'Connection Instability',
        message: `${labelName} GATT link state transitioned to ${health.link_stability}.`,
        valueLabel: `${health.link_stability} Link`,
        thresholdLabel: 'Good / Excellent',
      });
    }

    if (
      evaluatePassive &&
      health.battery_pct !== null &&
      health.battery_pct < thresholds.minBatteryPct
    ) {
      breaches.push({
        key: `${device.device_id}:battery`,
        device_id: device.device_id,
        device_name: labelName,
        mac_address: device.mac_address,
        metric: 'battery',
        severity: health.battery_pct <= 15 ? 'critical' : 'warning',
        title: 'Low Peripheral Battery',
        message: `${labelName} battery fell to ${health.battery_pct}% (minimum ${thresholds.minBatteryPct}%).`,
        valueLabel: `${health.battery_pct}%`,
        thresholdLabel: `>= ${thresholds.minBatteryPct}%`,
      });
    }
  }

  return breaches;
}

export function useHealthAlerts(devices: PacketTelemetry[]) {
  const [thresholds, setThresholds] = useState<HealthThresholds>(() => loadSavedThresholds());
  const [alerts, setAlerts] = useState<HealthAlert[]>([]);
  const [toasts, setToasts] = useState<HealthAlert[]>([]);

  const activeBreachKeysRef = useRef<Set<string>>(new Set());
  const cooldownMapRef = useRef<Map<string, number>>(new Map());
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((alertId: string) => {
    const timer = toastTimersRef.current.get(alertId);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(alertId);
    }
    setToasts((prev) => prev.filter((t) => t.id !== alertId));
  }, []);

  const updateThresholds = useCallback((next: Partial<HealthThresholds>) => {
    setThresholds((prev) => {
      const merged = { ...prev, ...next };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      } catch {
        // Ignore storage quota / privacy mode errors
      }
      return merged;
    });
    activeBreachKeysRef.current.clear();
    cooldownMapRef.current.clear();
  }, []);

  const resetThresholds = useCallback(() => {
    setThresholds(DEFAULT_THRESHOLDS);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_THRESHOLDS));
    } catch {
      // Ignore storage errors
    }
    activeBreachKeysRef.current.clear();
    cooldownMapRef.current.clear();
  }, []);

  const acknowledgeAlert = useCallback(
    (alertId: string) => {
      setAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a))
      );
      dismissToast(alertId);
    },
    [dismissToast]
  );

  const acknowledgeAll = useCallback(() => {
    setAlerts((prev) => prev.map((a) => ({ ...a, acknowledged: true })));
    for (const timer of toastTimersRef.current.values()) {
      clearTimeout(timer);
    }
    toastTimersRef.current.clear();
    setToasts([]);
  }, []);

  const clearAlerts = useCallback(() => {
    setAlerts([]);
    for (const timer of toastTimersRef.current.values()) {
      clearTimeout(timer);
    }
    toastTimersRef.current.clear();
    setToasts([]);
  }, []);

  const currentBreaches = useMemo(
    () => evaluateDeviceBreaches(devices, thresholds),
    [devices, thresholds]
  );

  useEffect(() => {
    const now = Date.now();
    const nextBreachKeys = new Set(currentBreaches.map((b) => b.key));

    // Clear resolved breaches so future regressions can trigger fresh notifications
    for (const existingKey of Array.from(activeBreachKeysRef.current)) {
      if (!nextBreachKeys.has(existingKey)) {
        activeBreachKeysRef.current.delete(existingKey);
      }
    }

    const newlyTriggered: HealthAlert[] = [];

    for (const breach of currentBreaches) {
      const alreadyActive = activeBreachKeysRef.current.has(breach.key);
      const lastFiredAt = cooldownMapRef.current.get(breach.key) ?? 0;

      if (!alreadyActive && now - lastFiredAt >= ALERT_COOLDOWN_MS) {
        activeBreachKeysRef.current.add(breach.key);
        cooldownMapRef.current.set(breach.key, now);

        newlyTriggered.push({
          id: `${breach.key}-${now}-${Math.random().toString(36).slice(2, 7)}`,
          device_id: breach.device_id,
          device_name: breach.device_name,
          mac_address: breach.mac_address,
          metric: breach.metric,
          severity: breach.severity,
          title: breach.title,
          message: breach.message,
          valueLabel: breach.valueLabel,
          thresholdLabel: breach.thresholdLabel,
          timestamp: new Date(now).toISOString(),
          acknowledged: false,
        });
      } else {
        activeBreachKeysRef.current.add(breach.key);
      }
    }

    if (newlyTriggered.length > 0) {
      setAlerts((prev) => [...newlyTriggered, ...prev].slice(0, MAX_ALERT_HISTORY));
      setToasts((prev) => [...newlyTriggered, ...prev].slice(0, MAX_VISIBLE_TOASTS));

      for (const alert of newlyTriggered) {
        const timer = setTimeout(() => {
          toastTimersRef.current.delete(alert.id);
          setToasts((prev) => prev.filter((t) => t.id !== alert.id));
        }, TOAST_TTL_MS);
        toastTimersRef.current.set(alert.id, timer);
      }
    }
  }, [currentBreaches]);

  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const unreadCount = useMemo(
    () => alerts.filter((a) => !a.acknowledged).length,
    [alerts]
  );

  const criticalBreachCount = useMemo(
    () => currentBreaches.filter((b) => b.severity === 'critical').length,
    [currentBreaches]
  );

  return {
    thresholds,
    alerts,
    toasts,
    unreadCount,
    activeBreachCount: currentBreaches.length,
    criticalBreachCount,
    activeBreachDeviceIds: new Set(currentBreaches.map((b) => b.device_id)),
    updateThresholds,
    resetThresholds,
    acknowledgeAlert,
    acknowledgeAll,
    clearAlerts,
    dismissToast,
  };
}
