import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { ConnectionManagerComponent } from './connection-manager.component';
import { DeviceCardComponent } from './components/device-card/device-card.component';

const routes: Routes = [{ path: '', component: ConnectionManagerComponent }];

@NgModule({
  declarations: [ConnectionManagerComponent, DeviceCardComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class ConnectionManagerModule {}
