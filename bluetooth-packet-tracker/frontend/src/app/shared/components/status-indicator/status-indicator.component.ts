import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-status-indicator',
  template: `
    <div class="indicator">
      <span class="dot" [class.online]="online"></span>
      <span>{{ online ? onlineText : offlineText }}</span>
    </div>
  `,
  styles: [`
    .indicator { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #a1a1aa; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #ef4444; }
    .dot.online { background: #22c55e; box-shadow: 0 0 8px #22c55e; }
  `]
})
export class StatusIndicatorComponent {
  @Input() online = false;
  @Input() onlineText = 'Daemon Connected';
  @Input() offlineText = 'Daemon Offline';
}
