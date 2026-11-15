import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { BluetoothApiService } from '../../core/services/bluetooth-api.service';
import { PacketTelemetry } from '../../core/models/bluetooth.model';

@Component({
  selector: 'app-packet-tracker',
  template: `
    <section class="panel">
      <div class="header-row">
        <div>
          <h2>Real-Time BLE Packet Sniffer &amp; Telemetry</h2>
          <p class="subtitle">Live HCI/ATT event stream captured from the host Bluetooth adapter.</p>
        </div>
        <div class="controls">
          <button type="button" (click)="togglePause()">{{ isPaused ? 'Resume Stream' : 'Pause Stream' }}</button>
          <button type="button" (click)="clearLogs()">Clear Buffer ({{ allPackets.length }})</button>
        </div>
      </div>

      <app-packet-filter (filterChanged)="onFilterChanged($event)"></app-packet-filter>

      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Timestamp (UTC)</th>
              <th>Packet Type</th>
              <th>Peripheral</th>
              <th>Signal</th>
              <th>Raw Hex Payload</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngIf="filteredPackets.length === 0">
              <td colspan="5" class="empty-cell">
                {{ allPackets.length === 0 ? 'Waiting for live BLE telemetry packets...' : 'No packets match the active filter.' }}
              </td>
            </tr>
            <tr *ngFor="let pkt of filteredPackets; trackBy: trackByPacketId">
              <td class="mono">{{ pkt.timestamp | date:'HH:mm:ss.SSS':'UTC' }}</td>
              <td>
                <span class="type-tag" [ngClass]="(pkt.packet_type || 'adv_ind').toLowerCase()">
                  {{ pkt.packet_type }}
                </span>
              </td>
              <td>
                <div>{{ pkt.device_name || 'Unnamed Peripheral' }}</div>
                <div class="mac-sub">{{ pkt.mac_address }}</div>
              </td>
              <td><app-rssi-badge [rssi]="pkt.rssi"></app-rssi-badge></td>
              <td class="mono hex">{{ pkt.payload_hex | hexFormat }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles: [`
    .panel { background: #18181b; padding: 24px; border-radius: 10px; border: 1px solid #27272a; }
    .header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    h2 { font-size: 18px; margin-bottom: 4px; }
    .subtitle { font-size: 13px; color: #a1a1aa; }
    .controls { display: flex; gap: 8px; }
    button { background: #27272a; color: #e4e4e7; border: 1px solid #3f3f46; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
    .table-wrapper { max-height: 520px; overflow-y: auto; border: 1px solid #27272a; border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #27272a; }
    th { color: #a1a1aa; position: sticky; top: 0; background: #09090b; font-size: 12px; z-index: 1; }
    .empty-cell { text-align: center; color: #71717a; padding: 28px 12px; }
    .mono { font-family: 'Courier New', monospace; font-variant-numeric: tabular-nums; }
    .mac-sub { font-family: monospace; font-size: 11px; color: #71717a; }
    .hex { color: #38bdf8; }
    .type-tag { background: #312e81; color: #a5b4fc; padding: 3px 7px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .type-tag.conn_established { background: #14532d; color: #4ade80; }
    .type-tag.conn_terminated { background: #7f1d1d; color: #fca5a5; }
    .type-tag.conn_failed { background: #7f1d1d; color: #fca5a5; }
    .type-tag.conn_req_sent { background: #713f12; color: #fde047; }
  `]
})
export class PacketTrackerComponent implements OnInit, OnDestroy {
  allPackets: PacketTelemetry[] = [];
  filteredPackets: PacketTelemetry[] = [];
  isPaused = false;

  private searchTerm = '';
  private packetType = 'ALL';
  private destroy$ = new Subject<void>();

  constructor(private btService: BluetoothApiService) {}

  ngOnInit(): void {
    this.btService
      .getPacketHistory()
      .pipe(takeUntil(this.destroy$))
      .subscribe((history) => {
        if (this.isPaused) return;
        this.allPackets = history;
        this.applyFilter();
      });
  }

  trackByPacketId(_index: number, pkt: PacketTelemetry): string {
    return pkt.packet_id;
  }

  onFilterChanged(filter: { searchTerm: string; packetType: string }): void {
    this.searchTerm = filter.searchTerm;
    this.packetType = filter.packetType;
    this.applyFilter();
  }

  applyFilter(): void {
    const normalizedSearch = this.searchTerm.replace(/[\s-]+/g, '');
    this.filteredPackets = this.allPackets.filter((pkt) => {
      const matchesType = this.packetType === 'ALL' || pkt.packet_type === this.packetType;
      if (!this.searchTerm) return matchesType;

      const name = (pkt.device_name || '').toLowerCase();
      const mac = (pkt.mac_address || '').toLowerCase();
      const packetUuid = (pkt.packet_id || '').toLowerCase();
      const deviceId = (pkt.device_id || '').toLowerCase();
      const gattServices = (pkt.gatt_services || []).map((u) => u.toLowerCase());
      const hexRaw = (pkt.payload_hex || '').toLowerCase();
      const hexCompact = hexRaw.replace(/\s+/g, '');

      const matchesUuid =
        packetUuid.includes(this.searchTerm) ||
        deviceId.includes(this.searchTerm) ||
        gattServices.some(
          (uuid) =>
            uuid.includes(this.searchTerm) ||
            (normalizedSearch.length > 0 && uuid.replace(/-/g, '').includes(normalizedSearch))
        ) ||
        (normalizedSearch.length > 0 && packetUuid.replace(/-/g, '').includes(normalizedSearch));

      const matchesSearch =
        name.includes(this.searchTerm) ||
        matchesUuid ||
        mac.includes(this.searchTerm) ||
        hexRaw.includes(this.searchTerm) ||
        (normalizedSearch.length > 0 && hexCompact.includes(normalizedSearch));

      return matchesType && matchesSearch;
    });
  }

  togglePause(): void {
    this.isPaused = !this.isPaused;
    if (!this.isPaused) {
      // Immediately sync to latest history when resuming
      this.btService
        .getPacketHistory()
        .pipe(takeUntil(this.destroy$))
        .subscribe((history) => {
          if (!this.isPaused) {
            this.allPackets = history;
            this.applyFilter();
          }
        })
        .unsubscribe();
    }
  }

  clearLogs(): void {
    this.btService.clearPacketHistory();
    this.allPackets = [];
    this.filteredPackets = [];
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
