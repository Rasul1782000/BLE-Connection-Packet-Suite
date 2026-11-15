import { Component, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-packet-filter',
  template: `
    <div class="filter-bar">
      <input
        type="search"
        aria-label="Search packet logs by UUID or device name"
        [(ngModel)]="searchTerm"
        (ngModelChange)="emitFilter()"
        placeholder="Search by UUID (GATT service / packet UUID), device name, MAC, or hex..."
      />
      <select [(ngModel)]="packetType" (ngModelChange)="emitFilter()">
        <option value="ALL">All Packet Types</option>
        <option value="ADV_IND">ADV_IND (Advertising)</option>
        <option value="CONN_REQ_SENT">CONN_REQ_SENT</option>
        <option value="CONN_ESTABLISHED">CONN_ESTABLISHED</option>
        <option value="CONN_TERMINATED">CONN_TERMINATED</option>
        <option value="CONN_FAILED">CONN_FAILED</option>
      </select>
      <button
        type="button"
        class="btn-reset"
        *ngIf="searchTerm || packetType !== 'ALL'"
        (click)="resetFilter()">
        Reset
      </button>
    </div>
  `,
  styles: [`
    .filter-bar { display: flex; gap: 10px; margin-bottom: 14px; }
    input, select {
      background: #09090b;
      border: 1px solid #27272a;
      color: #f4f4f5;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;
    }
    input { flex: 1; }
    .btn-reset {
      background: #27272a;
      color: #e4e4e7;
      border: 1px solid #3f3f46;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
    }
  `]
})
export class PacketFilterComponent {
  searchTerm = '';
  packetType = 'ALL';

  @Output() filterChanged = new EventEmitter<{ searchTerm: string; packetType: string }>();

  emitFilter(): void {
    this.filterChanged.emit({
      searchTerm: this.searchTerm.trim().toLowerCase(),
      packetType: this.packetType,
    });
  }

  resetFilter(): void {
    this.searchTerm = '';
    this.packetType = 'ALL';
    this.emitFilter();
  }
}
