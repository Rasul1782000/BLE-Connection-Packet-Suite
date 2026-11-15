import { NgModule, Optional, SkipSelf } from '@angular/core';
import {
  HTTP_INTERCEPTORS,
  provideHttpClient,
  withInterceptorsFromDi,
} from '@angular/common/http';
import { BluetoothApiService } from './services/bluetooth-api.service';
import { HttpErrorInterceptor } from './interceptors/http-error.interceptor';

@NgModule({
  providers: [
    provideHttpClient(withInterceptorsFromDi()),
    BluetoothApiService,
    {
      provide: HTTP_INTERCEPTORS,
      useClass: HttpErrorInterceptor,
      multi: true,
    },
  ],
})
export class CoreModule {
  constructor(@Optional() @SkipSelf() parentModule: CoreModule) {
    if (parentModule) {
      throw new Error('CoreModule is already loaded. Import it in AppModule only.');
    }
  }
}
