import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { DbModule } from './db/db.module.js';
import { EventsModule } from './events/events.module.js';
import { PaymentsModule } from './payments/payments.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

// Tanpa kunci, Observe tidak diaktifkan, supaya test dan container tidak mengirim telemetri palsu.
const observe = process.env.OBSERVE_APP_KEY
  ? [
      ObserveModule.forRoot({
        appKey: process.env.OBSERVE_APP_KEY,
        appSecret: process.env.OBSERVE_APP_SECRET ?? '',
        serviceId: 'ambaticket',
      }),
    ]
  : [];

@Module({
  imports: [...observe, DbModule, EventsModule, BookingsModule, PaymentsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
