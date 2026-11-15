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
    | string;
  payload_hex: string;
  gatt_services: string[];
  is_connected: boolean;
  timestamp: string;
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
  timestamp: string;
}
