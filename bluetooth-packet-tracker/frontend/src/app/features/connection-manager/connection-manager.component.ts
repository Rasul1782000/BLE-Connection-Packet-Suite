import { Component, OnInit, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { BluetoothApiService } from '../../core/services/bluetooth-api.service';
import { PacketTelemetry } from '../../core/models/bluetooth.model';

@Component({
  selector: 'app-connection-manager',
  template: `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Bluetooth Connection Request Manager</h2>
          <p class="subtitle">Select a discovered peripheral to initiate a GATT connection handshake.</p>
        </div>
        <button type="button" class="btn-refresh" (click)="refresh()">Sync Cache</button>
      </div>

      <div class="status-banner" *ngIf="statusMessage" [class.error]="isError">
        {{ statusMessage }}
      </div>

      <div class="status-banner error" *ngIf="(apiError$ | async) as apiError">
        {{ apiError }}
      </div>

      <ng-container *ngIf="(devices$ | async) as devices">
        <div class="empty-state" *ngIf="devices.length === 0">
          No BLE peripherals discovered yet. Ensure Bluetooth is enabled on the host adapter and click Sync Cache.
        </div>

        <div class="device-grid" *ngIf="devices.length > 0">
          <app-device-card
            *ngFor="let device of devices; trackBy: trackByDeviceId"
            [device]="device"
            [isLoading]="loadingIds.has(device.device_id)"
            (actionRequested)="onActionRequested($event)">
          </app-device-card>
        </div>
      </ng-container>
    </section>
  `,
  styles: [`
    .panel { background: #18181b; padding: 24px; border-radius: 10px; border: 1px solid #27272a; }
    .panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    h2 { font-size: 18px; margin-bottom: 4px; }
    .subtitle { font-size: 13px; color: #a1a1aa; }
    .btn-refresh { background: #27272a; color: #e4e4e7; border: 1px solid #3f3f46; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 12px; }
    .status-banner { background: #0c4a6e; border: 1px solid #0284c7; color: #e0f2fe; padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 16px; }
    .status-banner.error { background: #7f1d1d; border-color: #dc2626; color: #fee2e2; }
    .empty-state { border: 1px dashed #27272a; border-radius: 8px; padding: 32px 16px; text-align: center; color: #a1a1aa; font-size: 13px; }
    .device-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
  `]
})
export class ConnectionManagerComponent implements OnInit, OnDestroy {
  devices$!: Observable<PacketTelemetry[]>;
  apiError$!: Observable<string | null>;
  loadingIds = new Set<string>();
  statusMessage = '';
  isError = false;

  private destroy$ = new Subject<void>();

  constructor(private btService: BluetoothApiService) {}

  ngOnInit(): void {
    this.devices$ = this.btService.getTrackedDevices();
    this.apiError$ = this.btService.getLastError();
  }

  trackByDeviceId(_index: number, device: PacketTelemetry): string {
    return device.device_id;
  }

  refresh(): void {
    this.btService.loadInitialDevices();
  }

  onActionRequested(event: { device: PacketTelemetry; action: 'CONNECT' | 'DISCONNECT' }): void {
    const id = event.device.device_id;
    if (this.loadingIds.has(id)) return;

    this.loadingIds = new Set(this.loadingIds).add(id);
    this.isError = false;
    this.statusMessage = `Transmitting ${event.action} request to ${event.device.device_name || event.device.mac_address}...`;

    this.btService
      .sendConnectionRequest(id, event.action)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.statusMessage = `[${res.status}] ${res.message}`;
          const nextSet = new Set(this.loadingIds);
          nextSet.delete(id);
          this.loadingIds = nextSet;
        },
        error: (err) => {
          this.isError = true;
          this.statusMessage = `[FAILED] ${err.error?.message || 'Connection request failed'}`;
          const nextSet = new Set(this.loadingIds);
          nextSet.delete(id);
          this.loadingIds = nextSet;
        },
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
