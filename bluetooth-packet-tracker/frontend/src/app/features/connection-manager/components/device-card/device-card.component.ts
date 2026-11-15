import { Component, Input, Output, EventEmitter } from '@angular/core';
import { PacketTelemetry } from '../../../../core/models/bluetooth.model';

@Component({
  selector: 'app-device-card',
  template: `
    <div class="device-card" [class.active-link]="device.is_connected">
      <div class="card-header">
        <div>
          <h3>{{ device.device_name || 'Unnamed Peripheral' }}</h3>
          <span class="mac">{{ device.mac_address }}</span>
        </div>
        <app-rssi-badge [rssi]="device.rssi"></app-rssi-badge>
      </div>

      <div class="state-row">
        <span>Link State:</span>
        <strong [class.connected]="device.is_connected">
          {{ device.is_connected ? 'GATT CONNECTED' : (device.packet_type === 'CONN_REQ_SENT' ? 'HANDSHAKING' : 'ADVERTISING') }}
        </strong>
      </div>

      <div class="services-box" *ngIf="device.gatt_services?.length">
        <div class="services-title">Discovered GATT Services ({{ device.gatt_services.length }}):</div>
        <div class="service-uuid" *ngFor="let uuid of device.gatt_services; trackBy: trackByUuid">{{ uuid }}</div>
      </div>

      <div class="actions">
        <button
          type="button"
          class="btn-connect"
          [disabled]="device.is_connected || isLoading"
          (click)="actionRequested.emit({ device, action: 'CONNECT' })">
          {{ isLoading && !device.is_connected ? 'Handshaking...' : 'Request Connect' }}
        </button>
        <button
          type="button"
          class="btn-disconnect"
          [disabled]="!device.is_connected || isLoading"
          (click)="actionRequested.emit({ device, action: 'DISCONNECT' })">
          {{ isLoading && device.is_connected ? 'Disconnecting...' : 'Disconnect' }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .device-card {
      background: #09090b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: border-color 0.2s;
    }
    .device-card.active-link { border-color: #22c55e; }
    .card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 12px; }
    h3 { font-size: 15px; color: #f4f4f5; margin-bottom: 2px; }
    .mac { font-family: monospace; font-size: 11px; color: #71717a; }
    .state-row { display: flex; justify-content: space-between; font-size: 12px; color: #a1a1aa; padding: 8px 0; border-top: 1px solid #18181b; }
    .connected { color: #4ade80; }
    .services-box { background: #18181b; padding: 8px; border-radius: 4px; margin-top: 8px; max-height: 90px; overflow-y: auto; }
    .services-title { font-size: 11px; color: #a1a1aa; margin-bottom: 4px; }
    .service-uuid { font-family: monospace; font-size: 10px; color: #38bdf8; }
    .actions { display: flex; gap: 8px; margin-top: 14px; }
    button { flex: 1; padding: 8px 12px; border: none; border-radius: 5px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .btn-connect { background: #2563eb; color: #fff; }
    .btn-connect:disabled { background: #1e3a8a; opacity: 0.45; cursor: not-allowed; }
    .btn-disconnect { background: #dc2626; color: #fff; }
    .btn-disconnect:disabled { background: #7f1d1d; opacity: 0.45; cursor: not-allowed; }
  `]
})
export class DeviceCardComponent {
  @Input() device!: PacketTelemetry;
  @Input() isLoading = false;
  @Output() actionRequested = new EventEmitter<{
    device: PacketTelemetry;
    action: 'CONNECT' | 'DISCONNECT';
  }>();

  trackByUuid(_index: number, uuid: string): string {
    return uuid;
  }
}
