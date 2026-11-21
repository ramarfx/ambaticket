import { Logger, Module } from '@nestjs/common';
import { DrizzleModule } from '@nestjs/drizzle';
import { createObserveModule } from '@nestjs/observe';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { BookingsModule } from './bookings/bookings.module.js';
import * as schema from './db/schema.js';
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

const DEFAULT_URL =
  'postgres://ambaticket:ambaticket@localhost:5432/ambaticket';

// DrizzleModule membuat koneksi sekali per aplikasi, jadi tiap app e2e punya pool sendiri
// yang ditutup saat app.close(). Migrasi dijalankan di sini supaya skema siap sebelum query.
const database = DrizzleModule.forRootAsync({
  useFactory: async () => {
    const db = drizzle(process.env.DATABASE_URL ?? DEFAULT_URL, { schema });
    await migrate(db, { migrationsFolder: 'drizzle' });
    new Logger('Database').log('skema siap');
    return { db };
  },
});

@Module({
  imports: [...observe, database, EventsModule, BookingsModule, PaymentsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
