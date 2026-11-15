import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-rssi-badge',
  template: `
    <span class="rssi-pill" [ngClass]="signalClass">
      <ng-container *ngIf="isValidRssi; else unavailableTpl">
        {{ rssi }} dBm • {{ label }}
      </ng-container>
      <ng-template #unavailableTpl>N/A • Unknown</ng-template>
    </span>
  `,
  styles: [`
    .rssi-pill {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.3px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .strong  { background: #14532d; color: #4ade80; border: 1px solid #166534; }
    .medium  { background: #713f12; color: #facc15; border: 1px solid #854d0e; }
    .weak    { background: #7f1d1d; color: #f87171; border: 1px solid #991b1b; }
    .unknown { background: #27272a; color: #a1a1aa; border: 1px solid #3f3f46; }
  `]
})
export class RssiBadgeComponent {
  @Input() rssi = -100;

  /** Per BLE HCI spec, 127 (0x7F) indicates RSSI unavailable. */
  get isValidRssi(): boolean {
    return typeof this.rssi === 'number' && !Number.isNaN(this.rssi) && this.rssi >= -127 && this.rssi <= 20;
  }

  get signalClass(): string {
    if (!this.isValidRssi) return 'unknown';
    if (this.rssi >= -55) return 'strong';
    if (this.rssi >= -75) return 'medium';
    return 'weak';
  }

  get label(): string {
    if (!this.isValidRssi) return 'Unknown';
    if (this.rssi >= -55) return 'Immediate';
    if (this.rssi >= -75) return 'Nearby';
    return 'Far';
  }
}
