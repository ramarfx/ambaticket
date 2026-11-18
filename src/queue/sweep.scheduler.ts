import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { JOB_SWEEP, ORDER_EXPIRY_QUEUE, SWEEP_INTERVAL_MS } from './queue.constants.js';

// Sweeper adalah jaring kedua: job per pesanan bisa hilang kalau Redis dibersihkan,
// sedangkan kursi tetap harus dilepas.
@Injectable()
export class SweepScheduler implements OnModuleInit {
  private readonly logger = new Logger(SweepScheduler.name);

  constructor(@InjectQueue(ORDER_EXPIRY_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        'order-sweep',
        { every: SWEEP_INTERVAL_MS },
        {
          name: JOB_SWEEP,
          data: {},
          // Worker bisa start sebelum API selesai memigrasi. Retry singkat
          // menghindari satu sweep pertama yang gagal karena tabel belum ada.
          opts: { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
        },
      );
    } catch (error) {
      this.logger.warn(`sweeper tidak terjadwal: ${(error as Error).message}`);
    }
  }
}
