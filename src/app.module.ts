import { Logger, Module } from '@nestjs/common';
import { DrizzleModule } from '@nestjs/drizzle';
import { createObserveModule } from '@nestjs/observe';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';
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
    const url = process.env.DATABASE_URL ?? DEFAULT_URL;

    // Replika start bersamaan, jadi migrasi dikunci advisory lock dan dijalankan
    // di koneksi sendiri. Kunci lepas saat sesi ditutup.
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('select pg_advisory_lock(742001)');
      await migrate(drizzle(client, { schema }), {
        migrationsFolder: 'drizzle',
      });
    } finally {
      await client.end();
    }

    new Logger('Database').log('skema siap');
    return { db: drizzle(url, { schema }) };
  },
});

@Module({
  imports: [...observe, database, EventsModule, BookingsModule, PaymentsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
