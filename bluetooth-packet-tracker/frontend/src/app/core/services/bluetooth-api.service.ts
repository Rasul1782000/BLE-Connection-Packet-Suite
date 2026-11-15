import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, BehaviorSubject } from 'rxjs';
import {
  PacketTelemetry,
  ConnectionActionResponse,
  HealthStatus,
} from '../models/bluetooth.model';

const MAX_PACKET_HISTORY = 250;

@Injectable()
export class BluetoothApiService implements OnDestroy {
  private readonly baseUrl = 'http://127.0.0.1:8080/api';
  private readonly wsUrl = 'ws://127.0.0.1:8080/ws/packets';

  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isDestroyed = false;

  private packetStream$ = new Subject<PacketTelemetry>();
  private packetHistory: PacketTelemetry[] = [];
  private packetHistory$ = new BehaviorSubject<PacketTelemetry[]>([]);

  private deviceMap = new Map<string, PacketTelemetry>();
  private devicesSubject$ = new BehaviorSubject<PacketTelemetry[]>([]);
  private wsConnected$ = new BehaviorSubject<boolean>(false);
  private lastError$ = new BehaviorSubject<string | null>(null);

  constructor(private http: HttpClient) {
    this.initWebSocket();
    this.loadInitialDevices();
  }

  private initWebSocket(): void {
    if (this.isDestroyed) return;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
        this.socket.close();
      }
      this.socket = null;
    }

    try {
      this.socket = new WebSocket(this.wsUrl);
    } catch (err) {
      console.error('[WebSocket] Failed to initialize connection:', err);
      this.wsConnected$.next(false);
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.wsConnected$.next(true);
      this.lastError$.next(null);
      this.loadInitialDevices();
    };

    this.socket.onmessage = (event: MessageEvent) => {
      try {
        const packet: PacketTelemetry = JSON.parse(event.data);
        if (!packet || !packet.device_id) return;

        this.packetStream$.next(packet);

        // Persist packet ring buffer in singleton service so lazy-loaded routes retain history
        this.packetHistory = [packet, ...this.packetHistory].slice(0, MAX_PACKET_HISTORY);
        this.packetHistory$.next(this.packetHistory);

        this.upsertDevice(packet);
        this.emitSortedDevices();
      } catch (err) {
        console.warn('[WebSocket] Ignoring malformed telemetry frame:', err);
      }
    };

    this.socket.onclose = () => {
      this.wsConnected$.next(false);
      this.scheduleReconnect();
    };

    this.socket.onerror = () => {
      this.wsConnected$.next(false);
    };
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed || this.reconnectTimer !== null) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.initWebSocket();
    }, 2500);
  }

  private upsertDevice(incoming: PacketTelemetry): void {
    const existing = this.deviceMap.get(incoming.device_id);
    if (!existing) {
      this.deviceMap.set(incoming.device_id, incoming);
      return;
    }

    const existingTs = Date.parse(existing.timestamp) || 0;
    const incomingTs = Date.parse(incoming.timestamp) || 0;
    if (incomingTs >= existingTs) {
      this.deviceMap.set(incoming.device_id, incoming);
    }
  }

  private emitSortedDevices(): void {
    const sorted = Array.from(this.deviceMap.values()).sort((a, b) => b.rssi - a.rssi);
    this.devicesSubject$.next(sorted);
  }

  public getConnectionStatus(): Observable<boolean> {
    return this.wsConnected$.asObservable();
  }

  public getLastError(): Observable<string | null> {
    return this.lastError$.asObservable();
  }

  public getBackendHealth(): Observable<HealthStatus> {
    return this.http.get<HealthStatus>(`${this.baseUrl}/health`);
  }

  public loadInitialDevices(): void {
    const requestStartedAt = Date.now();
    this.http.get<PacketTelemetry[]>(`${this.baseUrl}/devices`).subscribe({
      next: (list) => {
        this.lastError$.next(null);
        const incomingIds = new Set(list.map((d) => d.device_id));

        // Prune stale devices that are no longer in backend cache unless updated via WS after request started
        for (const [id, existing] of this.deviceMap.entries()) {
          const existingTs = Date.parse(existing.timestamp) || 0;
          if (!incomingIds.has(id) && existingTs < requestStartedAt) {
            this.deviceMap.delete(id);
          }
        }

        // Only overwrite if backend snapshot is newer than in-flight WS packets
        list.forEach((d) => this.upsertDevice(d));
        this.emitSortedDevices();
      },
      error: (err) => {
        const msg = err?.error?.message || err?.message || 'Unable to reach BLE daemon at 127.0.0.1:8080';
        this.lastError$.next(msg);
      },
    });
  }

  public getLivePackets(): Observable<PacketTelemetry> {
    return this.packetStream$.asObservable();
  }

  public getPacketHistory(): Observable<PacketTelemetry[]> {
    return this.packetHistory$.asObservable();
  }

  public clearPacketHistory(): void {
    this.packetHistory = [];
    this.packetHistory$.next([]);
  }

  public getTrackedDevices(): Observable<PacketTelemetry[]> {
    return this.devicesSubject$.asObservable();
  }

  public sendConnectionRequest(
    deviceId: string,
    action: 'CONNECT' | 'DISCONNECT'
  ): Observable<ConnectionActionResponse> {
    return this.http.post<ConnectionActionResponse>(`${this.baseUrl}/connection`, {
      device_id: deviceId,
      action,
    });
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.close();
      this.socket = null;
    }
  }
}
