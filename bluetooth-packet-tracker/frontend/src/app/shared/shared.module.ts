import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RssiBadgeComponent } from './components/rssi-badge/rssi-badge.component';
import { StatusIndicatorComponent } from './components/status-indicator/status-indicator.component';
import { HexFormatPipe } from './pipes/hex-format.pipe';

@NgModule({
  declarations: [
    RssiBadgeComponent,
    StatusIndicatorComponent,
    HexFormatPipe,
  ],
  imports: [CommonModule, FormsModule],
  exports: [
    CommonModule,
    FormsModule,
    RssiBadgeComponent,
    StatusIndicatorComponent,
    HexFormatPipe,
  ],
})
export class SharedModule {}
