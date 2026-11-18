import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { ExpiryProcessor } from './queue/expiry.processor.js';
import { ORDER_EXPIRY_QUEUE } from './queue/queue.constants.js';
import { QueueModule } from './queue/queue.module.js';
import { SweepScheduler } from './queue/sweep.scheduler.js';

// Proses terpisah dari API: hanya mengerjakan antrean dan job terjadwal.
// BullMQ mengharuskan tiap modul yang menyuntik queue ikut registerQueue sendiri.
@Module({
  imports: [AppModule, BookingsModule, QueueModule, BullModule.registerQueue({ name: ORDER_EXPIRY_QUEUE })],
  providers: [ExpiryProcessor, SweepScheduler],
})
export class WorkerModule {}
