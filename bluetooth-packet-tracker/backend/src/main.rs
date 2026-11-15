use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use btleplug::api::{Central, CentralEvent, Manager as _, Peripheral as _, ScanFilter};
use btleplug::platform::{Adapter, Manager, Peripheral, PeripheralId};
use chrono::{DateTime, Utc};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    env,
    sync::Arc,
    time::Duration,
};
use tokio::sync::{
    broadcast::{self, error::RecvError},
    RwLock,
};
use tower_http::cors::CorsLayer;
use uuid::Uuid;

// ============================================================================
// 1. MONOLITHIC DATA MODELS & DTOs
// ============================================================================

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PacketTelemetry {
    pub packet_id: String,
    pub device_id: String,
    pub device_name: String,
    pub mac_address: String,
    pub rssi: i16,
    pub packet_type: String, // "ADV_IND", "CONN_REQ_SENT", "CONN_ESTABLISHED", "CONN_TERMINATED", "CONN_FAILED"
    pub payload_hex: String,
    pub gatt_services: Vec<String>,
    pub is_connected: bool,
    pub timestamp: DateTime<Utc>,
}

#[derive(Deserialize, Debug)]
pub struct ConnectionRequestPayload {
    pub device_id: String,
    pub action: String, // "CONNECT" | "DISCONNECT"
}

#[derive(Serialize, Debug)]
pub struct ActionResponse {
    pub status: String,
    pub message: String,
    pub device_id: String,
    pub discovered_services: Vec<String>,
}

#[derive(Serialize, Debug)]
pub struct HealthStatus {
    pub status: String,
    pub adapter_info: String,
    pub cached_device_count: usize,
    pub active_connections: usize,
    pub timestamp: DateTime<Utc>,
}

// ============================================================================
// 2. MONOLITHIC SHARED APPLICATION STATE
// ============================================================================

pub struct AppState {
    pub tx: broadcast::Sender<PacketTelemetry>,
    pub adapter: Adapter,
    pub adapter_name: String,
    pub tracked_devices: RwLock<HashMap<String, PacketTelemetry>>,
    /// Guards against concurrent CONNECT/DISCONNECT requests on the same peripheral
    /// and suppresses duplicate CONN_ESTABLISHED events while service discovery runs.
    pub pending_handshakes: RwLock<HashSet<String>>,
}

// ============================================================================
// 3. APPLICATION ENTRY POINT
// ============================================================================

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("==================================================================");
    println!("[Monolith] Booting Bluetooth Connection & Packet Tracker Daemon");
    println!("==================================================================");

    // Initialize Host Bluetooth Manager & Primary Adapter
    let manager = Manager::new().await?;
    let adapters = manager.adapters().await?;
    let adapter = adapters
        .into_iter()
        .next()
        .ok_or("Fatal: No Bluetooth hardware adapter detected on host machine.")?;

    let adapter_info = adapter
        .adapter_info()
        .await
        .unwrap_or_else(|_| "Primary Host BLE Adapter".to_string());
    println!("[Hardware] Bound to adapter: {}", adapter_info);

    // Create Broadcast Channel for Real-Time Packet Telemetry
    let (tx, _rx) = broadcast::channel::<PacketTelemetry>(1024);

    let shared_state = Arc::new(AppState {
        tx,
        adapter: adapter.clone(),
        adapter_name: adapter_info,
        tracked_devices: RwLock::new(HashMap::new()),
        pending_handshakes: RwLock::new(HashSet::new()),
    });

    // Spawn Background BLE Packet Sniffer & Event Loop with automatic recovery
    let scanner_state = Arc::clone(&shared_state);
    tokio::spawn(async move {
        loop {
            if let Err(e) = run_ble_packet_engine(Arc::clone(&scanner_state)).await {
                eprintln!("[BLE Engine Error]: {}. Restarting scanner in 3s...", e);
            } else {
                eprintln!("[BLE Engine] Event stream ended unexpectedly. Restarting in 3s...");
            }
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
    });

    // Configure Monolithic HTTP REST & WebSocket Router
    let app = Router::new()
        .route("/api/health", get(health_check))
        .route("/api/devices", get(get_discovered_devices))
        .route("/api/connection", post(handle_connection_request))
        .route("/ws/packets", get(ws_packet_handler))
        .layer(CorsLayer::permissive())
        .with_state(Arc::clone(&shared_state));

    let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let bind_addr = format!("{}:{}", host, port);

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    println!("[Server] HTTP API active at http://{}", bind_addr);
    println!("[Server] WebSocket Stream active at ws://{}/ws/packets", bind_addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal(shared_state))
        .await?;

    Ok(())
}

async fn shutdown_signal(state: Arc<AppState>) {
    let _ = tokio::signal::ctrl_c().await;
    println!("\n[Shutdown] Stopping BLE adapter scan cleanly...");
    let _ = state.adapter.stop_scan().await;
}

// ============================================================================
// 4. BLUETOOTH PACKET CAPTURE & CONNECTION ENGINE
// ============================================================================

/// Sanitizes BLE HCI RSSI readings.
/// Per Bluetooth Core Spec, 127 (0x7F) indicates "RSSI is not available".
fn sanitize_rssi(raw: Option<i16>) -> i16 {
    match raw {
        Some(v) if (-127..=20).contains(&v) => v,
        _ => -100,
    }
}

/// Builds deterministic BLE Advertising Data (AD) payload hex bytes
/// following [Length, AD Type, Data...] framing.
fn build_ad_payload_hex(
    manufacturer_data: &HashMap<u16, Vec<u8>>,
    service_data: &HashMap<Uuid, Vec<u8>>,
    local_name: Option<&str>,
) -> String {
    let mut ad_bytes: Vec<u8> = Vec::new();

    // Standard Flags AD Structure (LE General Discoverable + BR/EDR Not Supported)
    ad_bytes.extend_from_slice(&[0x02, 0x01, 0x06]);

    // Deterministic Manufacturer Specific Data (AD Type 0xFF)
    let ordered_mfg: BTreeMap<u16, &Vec<u8>> =
        manufacturer_data.iter().map(|(k, v)| (*k, v)).collect();
    for (company_id, data) in ordered_mfg {
        let field_len = 1 + 2 + data.len();
        if field_len <= 255 {
            ad_bytes.push(field_len as u8);
            ad_bytes.push(0xFF);
            ad_bytes.extend_from_slice(&company_id.to_le_bytes());
            ad_bytes.extend_from_slice(data);
        }
    }

    // Deterministic Service Data (AD Type 0x16 for 16-bit UUIDs / 0x21 for 128-bit UUIDs)
    let ordered_svc: BTreeMap<String, (&Uuid, &Vec<u8>)> = service_data
        .iter()
        .map(|(k, v)| (k.to_string(), (k, v)))
        .collect();
    for (_, (uuid, data)) in ordered_svc {
        let uuid_bytes = uuid.as_bytes();
        let field_len = 1 + uuid_bytes.len() + data.len();
        if field_len <= 255 {
            ad_bytes.push(field_len as u8);
            ad_bytes.push(0x21); // Service Data - 128-bit UUID
            ad_bytes.extend_from_slice(uuid_bytes);
            ad_bytes.extend_from_slice(data);
        }
    }

    // Complete Local Name (AD Type 0x09) if no mfg/service payload bytes were present
    if ad_bytes.len() == 3 {
        if let Some(name) = local_name {
            let name_bytes = name.as_bytes();
            let take_len = name_bytes.len().min(29);
            if take_len > 0 {
                ad_bytes.push((1 + take_len) as u8);
                ad_bytes.push(0x09);
                ad_bytes.extend_from_slice(&name_bytes[..take_len]);
            }
        }
    }

    ad_bytes
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<String>>()
        .join(" ")
}

async fn extract_peripheral_snapshot(
    peripheral: &Peripheral,
    id: &PeripheralId,
    existing: Option<&PacketTelemetry>,
) -> PacketTelemetry {
    let props = peripheral.properties().await.unwrap_or(None);
    let is_connected = peripheral
        .is_connected()
        .await
        .unwrap_or_else(|_| existing.map(|e| e.is_connected).unwrap_or(false));

    let (name, mac, rssi, raw_hex) = if let Some(p) = props {
        let payload = build_ad_payload_hex(
            &p.manufacturer_data,
            &p.service_data,
            p.local_name.as_deref(),
        );

        // Preserve previously known local_name if scan response omits it
        let resolved_name = match p.local_name {
            Some(ref n) if !n.trim().is_empty() => n.clone(),
            _ => existing
                .map(|e| e.device_name.clone())
                .filter(|n| n != "Unnamed Peripheral" && n != "Unknown Device")
                .unwrap_or_else(|| "Unnamed Peripheral".to_string()),
        };

        let resolved_rssi = match p.rssi {
            Some(r) if (-127..=20).contains(&r) => r,
            _ => existing.map(|e| e.rssi).unwrap_or_else(|| sanitize_rssi(p.rssi)),
        };

        (resolved_name, p.address.to_string(), resolved_rssi, payload)
    } else {
        (
            existing
                .map(|e| e.device_name.clone())
                .unwrap_or_else(|| "Unknown Device".to_string()),
            existing
                .map(|e| e.mac_address.clone())
                .unwrap_or_else(|| id.to_string()),
            existing.map(|e| e.rssi).unwrap_or(-100),
            existing
                .map(|e| e.payload_hex.clone())
                .unwrap_or_else(|| "02 01 06".to_string()),
        )
    };

    let existing_services = existing
        .map(|d| d.gatt_services.clone())
        .unwrap_or_default();

    // Preserve active connection status on packet_type if device is already connected
    let packet_type = if is_connected {
        existing
            .map(|e| e.packet_type.clone())
            .filter(|t| t == "CONN_ESTABLISHED")
            .unwrap_or_else(|| "ADV_IND".to_string())
    } else {
        "ADV_IND".to_string()
    };

    PacketTelemetry {
        packet_id: Uuid::new_v4().to_string(),
        device_id: id.to_string(),
        device_name: name,
        mac_address: mac,
        rssi,
        packet_type,
        payload_hex: raw_hex,
        gatt_services: existing_services,
        is_connected,
        timestamp: Utc::now(),
    }
}

async fn run_ble_packet_engine(state: Arc<AppState>) -> Result<(), Box<dyn std::error::Error>> {
    state.adapter.start_scan(ScanFilter::default()).await?;
    println!("[BLE Engine] Active scanning started...");

    let mut events = state.adapter.events().await?;

    while let Some(event) = events.next().await {
        match event {
            CentralEvent::DeviceDiscovered(id) | CentralEvent::DeviceUpdated(id) => {
                if let Ok(peripheral) = state.adapter.peripheral(&id).await {
                    let id_str = id.to_string();
                    let existing = state.tracked_devices.read().await.get(&id_str).cloned();
                    let packet =
                        extract_peripheral_snapshot(&peripheral, &id, existing.as_ref()).await;

                    state
                        .tracked_devices
                        .write()
                        .await
                        .insert(id_str, packet.clone());

                    let _ = state.tx.send(packet);
                }
            }
            CentralEvent::DeviceConnected(id) => {
                let id_str = id.to_string();
                println!("[BLE Engine] Link established with {}", id_str);

                // If an API handshake is currently executing discover_services(),
                // avoid emitting a premature duplicate CONN_ESTABLISHED without services.
                let handshake_in_progress = state.pending_handshakes.read().await.contains(&id_str);
                if !handshake_in_progress {
                    broadcast_state_packet(&state, &id, "CONN_ESTABLISHED", true, None).await;
                }
            }
            CentralEvent::DeviceDisconnected(id) => {
                let id_str = id.to_string();
                println!("[BLE Engine] Link terminated with {}", id_str);
                broadcast_state_packet(&state, &id, "CONN_TERMINATED", false, Some(vec![])).await;
            }
            _ => {}
        }
    }

    Ok(())
}

async fn broadcast_state_packet(
    state: &Arc<AppState>,
    id: &PeripheralId,
    event_type: &str,
    connected: bool,
    updated_services: Option<Vec<String>>,
) {
    let device_id = id.to_string();

    // Ensure device exists in tracked_devices even if CentralEvent::DeviceConnected
    // arrived before DeviceDiscovered was processed.
    let existing = state.tracked_devices.read().await.get(&device_id).cloned();
    let mut telemetry = if let Some(prev) = existing {
        prev
    } else if let Ok(peripheral) = state.adapter.peripheral(id).await {
        extract_peripheral_snapshot(&peripheral, id, None).await
    } else {
        PacketTelemetry {
            packet_id: Uuid::new_v4().to_string(),
            device_id: device_id.clone(),
            device_name: "Unknown Device".to_string(),
            mac_address: device_id.clone(),
            rssi: -100,
            packet_type: event_type.to_string(),
            payload_hex: "02 01 06".to_string(),
            gatt_services: vec![],
            is_connected: connected,
            timestamp: Utc::now(),
        }
    };

    telemetry.is_connected = connected;
    telemetry.packet_type = event_type.to_string();
    telemetry.timestamp = Utc::now();
    telemetry.packet_id = Uuid::new_v4().to_string();
    if let Some(services) = updated_services {
        telemetry.gatt_services = services;
    }

    state
        .tracked_devices
        .write()
        .await
        .insert(device_id, telemetry.clone());
    let _ = state.tx.send(telemetry);
}

// ============================================================================
// 5. HTTP REST & WEBSOCKET HANDLERS
// ============================================================================

async fn health_check(State(state): State<Arc<AppState>>) -> Json<HealthStatus> {
    let devices = state.tracked_devices.read().await;
    let count = devices.len();
    let active_connections = devices.values().filter(|d| d.is_connected).count();
    Json(HealthStatus {
        status: "OPERATIONAL".to_string(),
        adapter_info: state.adapter_name.clone(),
        cached_device_count: count,
        active_connections,
        timestamp: Utc::now(),
    })
}

async fn get_discovered_devices(State(state): State<Arc<AppState>>) -> Json<Vec<PacketTelemetry>> {
    let devices = state.tracked_devices.read().await;
    let mut list: Vec<PacketTelemetry> = devices.values().cloned().collect();
    list.sort_by(|a, b| b.rssi.cmp(&a.rssi)); // Sort strongest signal first
    Json(list)
}

async fn handle_connection_request(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ConnectionRequestPayload>,
) -> (StatusCode, Json<ActionResponse>) {
    let action = payload.action.trim().to_uppercase();
    if action != "CONNECT" && action != "DISCONNECT" {
        return (
            StatusCode::BAD_REQUEST,
            Json(ActionResponse {
                status: "INVALID_ACTION".to_string(),
                message: "Action must be CONNECT or DISCONNECT".to_string(),
                device_id: payload.device_id,
                discovered_services: vec![],
            }),
        );
    }

    let peripherals = match state.adapter.peripherals().await {
        Ok(list) => list,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ActionResponse {
                    status: "ERROR".to_string(),
                    message: format!("Adapter peripheral query failed: {}", e),
                    device_id: payload.device_id,
                    discovered_services: vec![],
                }),
            );
        }
    };

    let Some(peripheral) = peripherals
        .into_iter()
        .find(|p| p.id().to_string() == payload.device_id)
    else {
        return (
            StatusCode::NOT_FOUND,
            Json(ActionResponse {
                status: "NOT_FOUND".to_string(),
                message: "Target peripheral not found in active scan cache".to_string(),
                device_id: payload.device_id,
                discovered_services: vec![],
            }),
        );
    };

    let peripheral_id = peripheral.id();

    // Prevent concurrent handshakes on the same peripheral
    {
        let mut pending = state.pending_handshakes.write().await;
        if pending.contains(&payload.device_id) {
            return (
                StatusCode::CONFLICT,
                Json(ActionResponse {
                    status: "IN_PROGRESS".to_string(),
                    message: "Another connection operation is already in progress for this device"
                        .to_string(),
                    device_id: payload.device_id,
                    discovered_services: vec![],
                }),
            );
        }
        pending.insert(payload.device_id.clone());
    }

    let response = match action.as_str() {
        "CONNECT" => {
            let already_connected = peripheral.is_connected().await.unwrap_or(false);
            if already_connected {
                let _ = peripheral.discover_services().await;
                let services: Vec<String> = peripheral
                    .services()
                    .into_iter()
                    .map(|s| s.uuid.to_string())
                    .collect();

                broadcast_state_packet(
                    &state,
                    &peripheral_id,
                    "CONN_ESTABLISHED",
                    true,
                    Some(services.clone()),
                )
                .await;

                (
                    StatusCode::OK,
                    Json(ActionResponse {
                        status: "CONNECTED".to_string(),
                        message: format!(
                            "Peripheral already connected ({} services active)",
                            services.len()
                        ),
                        device_id: payload.device_id.clone(),
                        discovered_services: services,
                    }),
                )
            } else {
                println!(
                    "[API] Initiating GATT CONNECT request to {}",
                    payload.device_id
                );
                broadcast_state_packet(&state, &peripheral_id, "CONN_REQ_SENT", false, None).await;

                match tokio::time::timeout(Duration::from_secs(10), peripheral.connect()).await {
                    Ok(Ok(_)) => {
                        if let Err(err) = peripheral.discover_services().await {
                            eprintln!(
                                "[GATT] Service discovery warning for {}: {}",
                                payload.device_id, err
                            );
                        }
                        let services: Vec<String> = peripheral
                            .services()
                            .into_iter()
                            .map(|s| s.uuid.to_string())
                            .collect();

                        broadcast_state_packet(
                            &state,
                            &peripheral_id,
                            "CONN_ESTABLISHED",
                            true,
                            Some(services.clone()),
                        )
                        .await;

                        (
                            StatusCode::OK,
                            Json(ActionResponse {
                                status: "CONNECTED".to_string(),
                                message: format!(
                                    "GATT connection established ({} services discovered)",
                                    services.len()
                                ),
                                device_id: payload.device_id.clone(),
                                discovered_services: services,
                            }),
                        )
                    }
                    Ok(Err(e)) => {
                        // Reset state out of CONN_REQ_SENT on rejection
                        broadcast_state_packet(
                            &state,
                            &peripheral_id,
                            "CONN_FAILED",
                            false,
                            Some(vec![]),
                        )
                        .await;

                        (
                            StatusCode::BAD_GATEWAY,
                            Json(ActionResponse {
                                status: "REJECTED".to_string(),
                                message: format!("Peripheral rejected connection: {}", e),
                                device_id: payload.device_id.clone(),
                                discovered_services: vec![],
                            }),
                        )
                    }
                    Err(_) => {
                        // Reset state out of CONN_REQ_SENT on timeout
                        broadcast_state_packet(
                            &state,
                            &peripheral_id,
                            "CONN_FAILED",
                            false,
                            Some(vec![]),
                        )
                        .await;

                        (
                            StatusCode::GATEWAY_TIMEOUT,
                            Json(ActionResponse {
                                status: "TIMEOUT".to_string(),
                                message: "Connection handshake timed out after 10 seconds"
                                    .to_string(),
                                device_id: payload.device_id.clone(),
                                discovered_services: vec![],
                            }),
                        )
                    }
                }
            }
        }
        "DISCONNECT" => {
            println!(
                "[API] Initiating DISCONNECT request for {}",
                payload.device_id
            );
            let is_connected = peripheral.is_connected().await.unwrap_or(false);
            if !is_connected {
                broadcast_state_packet(
                    &state,
                    &peripheral_id,
                    "CONN_TERMINATED",
                    false,
                    Some(vec![]),
                )
                .await;

                (
                    StatusCode::OK,
                    Json(ActionResponse {
                        status: "DISCONNECTED".to_string(),
                        message: "Peripheral was already disconnected".to_string(),
                        device_id: payload.device_id.clone(),
                        discovered_services: vec![],
                    }),
                )
            } else {
                match peripheral.disconnect().await {
                    Ok(_) => {
                        broadcast_state_packet(
                            &state,
                            &peripheral_id,
                            "CONN_TERMINATED",
                            false,
                            Some(vec![]),
                        )
                        .await;

                        (
                            StatusCode::OK,
                            Json(ActionResponse {
                                status: "DISCONNECTED".to_string(),
                                message: "Peripheral disconnected cleanly".to_string(),
                                device_id: payload.device_id.clone(),
                                discovered_services: vec![],
                            }),
                        )
                    }
                    Err(e) => (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ActionResponse {
                            status: "ERROR".to_string(),
                            message: format!("Disconnect failed: {}", e),
                            device_id: payload.device_id.clone(),
                            discovered_services: vec![],
                        }),
                    ),
                }
            }
        }
        _ => unreachable!(),
    };

    state.pending_handshakes.write().await.remove(&payload.device_id);
    response
}

async fn ws_packet_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_client(socket, state))
}

async fn handle_ws_client(socket: WebSocket, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.tx.subscribe();

    loop {
        tokio::select! {
            recv_res = rx.recv() => {
                match recv_res {
                    Ok(packet) => {
                        if let Ok(json) = serde_json::to_string(&packet) {
                            if sender.send(Message::Text(json)).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(RecvError::Lagged(skipped)) => {
                        eprintln!("[WS] Slow client lagged; skipped {} packets", skipped);
                        continue;
                    }
                    Err(RecvError::Closed) => break,
                }
            }
            incoming = receiver.next() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(payload))) => {
                        if sender.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }
}
