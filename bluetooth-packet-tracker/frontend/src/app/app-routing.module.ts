import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  { path: '', redirectTo: 'connections', pathMatch: 'full' },
  {
    path: 'connections',
    loadChildren: () =>
      import('./features/connection-manager/connection-manager.module').then(
        (m) => m.ConnectionManagerModule
      ),
  },
  {
    path: 'packets',
    loadChildren: () =>
      import('./features/packet-tracker/packet-tracker.module').then(
        (m) => m.PacketTrackerModule
      ),
  },
  { path: '**', redirectTo: 'connections' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
