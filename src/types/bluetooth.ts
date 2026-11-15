export type PacketType =
  | 'ADV_IND'
  | 'CONN_REQ_SENT'
  | 'CONN_ESTABLISHED'
  | 'CONN_TERMINATED'
  | 'CONN_FAILED'
  | 'READ'
  | 'WRITE'
  | 'NOTIFY'
  | string;

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
  packet_type: PacketType;
  payload_hex: string;
  gatt_services: string[];
  is_connected: boolean;
  timestamp: string;
  device_health?: DeviceHealth;
}

export interface ConnectionActionResponse {
  status: string;
  message: string;
  device_id: string;
  discovered_services: string[];
}

export interface HealthStatus {
  status: string;
  adapter_info: string;
  cached_device_count: number;
  active_connections?: number;
  adapter_health?: 'Optimal' | 'Busy' | 'Offline';
  avg_rssi?: number | null;
  avg_latency_ms?: number | null;
  timestamp: string;
}

export interface WorkspaceFileEntry {
  path: string;
  size: number;
}

export interface BugFixRecord {
  id: string;
  layer: 'backend' | 'frontend';
  severity: 'Critical' | 'High' | 'Medium';
  file: string;
  title: string;
  symptom: string;
  fix: string;
}

export type AlertSeverity = 'critical' | 'warning';

export type AlertMetric =
  | 'signal_quality'
  | 'latency'
  | 'packet_loss'
  | 'stability'
  | 'battery';

export interface HealthThresholds {
  minSignalQualityPct: number;
  maxLatencyMs: number;
  maxPacketLossPct: number;
  minBatteryPct: number;
  alertOnUnstableLink: boolean;
  connectedOnly: boolean;
}

export interface HealthAlert {
  id: string;
  device_id: string;
  device_name: string;
  mac_address: string;
  metric: AlertMetric;
  severity: AlertSeverity;
  title: string;
  message: string;
  valueLabel: string;
  thresholdLabel: string;
  timestamp: string;
  acknowledged: boolean;
}

