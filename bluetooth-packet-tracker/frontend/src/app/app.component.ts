import { Component, OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import { BluetoothApiService } from './core/services/bluetooth-api.service';

@Component({
  selector: 'app-root',
  template: `
    <div class="shell">
      <nav class="navbar">
        <div class="brand-group">
          <span class="brand">BLE Connection &amp; Packet Suite</span>
          <app-status-indicator [online]="(isConnected$ | async) || false"></app-status-indicator>
        </div>
        <div class="links">
          <a routerLink="/connections" routerLinkActive="active">Connection Requests</a>
          <a routerLink="/packets" routerLinkActive="active">Packet Stream</a>
        </div>
      </nav>
      <main class="content">
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
  styles: [`
    .shell { min-height: 100vh; background: #09090b; color: #f4f4f5; }
    .navbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 32px;
      background: #18181b;
      border-bottom: 1px solid #27272a;
    }
    .brand-group { display: flex; align-items: center; gap: 16px; }
    .brand { font-weight: 700; font-size: 16px; color: #38bdf8; }
    .links { display: flex; gap: 12px; }
    .links a {
      color: #a1a1aa;
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      padding: 7px 14px;
      border-radius: 6px;
      transition: all 0.15s;
    }
    .links a:hover { color: #fff; background: #27272a; }
    .links a.active { background: #2563eb; color: #fff; }
    .content { padding: 28px 32px; max-width: 1280px; margin: 0 auto; }
  `]
})
export class AppComponent implements OnInit {
  isConnected$!: Observable<boolean>;

  constructor(private btService: BluetoothApiService) {}

  ngOnInit(): void {
    this.isConnected$ = this.btService.getConnectionStatus();
  }
}
