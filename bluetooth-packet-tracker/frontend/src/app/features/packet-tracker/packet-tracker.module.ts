import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { PacketTrackerComponent } from './packet-tracker.component';
import { PacketFilterComponent } from './components/packet-filter/packet-filter.component';

const routes: Routes = [{ path: '', component: PacketTrackerComponent }];

@NgModule({
  declarations: [PacketTrackerComponent, PacketFilterComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class PacketTrackerModule {}
