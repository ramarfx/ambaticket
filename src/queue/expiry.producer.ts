import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { JOB_EXPIRE, ORDER_EXPIRY_QUEUE } from './queue.constants.js';

const SCHEDULE_TIMEOUT_MS = 500;

@Injectable()
export class ExpiryProducer {
  private readonly logger = new Logger(ExpiryProducer.name);

  constructor(@InjectQueue(ORDER_EXPIRY_QUEUE) private readonly queue: Queue) {}

  // Antrean hanya mempercepat pelepasan kursi. Kalau Redis lambat atau mati,
  // pesanan tetap kedaluwarsa lewat sweeper dan perbaikan saat reservasi.
  async schedule(orderId: string, expiresAt: Date): Promise<void> {
    const delay = Math.max(0, expiresAt.getTime() - Date.now());
    const job = this.queue
      .add(
        JOB_EXPIRE,
        { orderId },
        {
          jobId: `${JOB_EXPIRE}:${orderId}`,
          delay,
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 1_000,
          removeOnFail: 5_000,
        },
      )
      .catch((error: Error) => {
        this.logger.warn(`job kedaluwarsa gagal dijadwalkan: ${error.message}`);
        return undefined;
      });

    await Promise.race([
      job,
      new Promise<void>((resolve) => setTimeout(resolve, SCHEDULE_TIMEOUT_MS).unref()),
    ]);
  }
}
