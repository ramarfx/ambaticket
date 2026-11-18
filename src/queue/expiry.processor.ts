import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { BookingsService } from '../bookings/bookings.service.js';
import { JOB_SWEEP, ORDER_EXPIRY_QUEUE } from './queue.constants.js';

@Processor(ORDER_EXPIRY_QUEUE)
export class ExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(ExpiryProcessor.name);

  constructor(private readonly bookings: BookingsService) {
    super();
  }

  async process(job: Job<{ orderId?: string }>): Promise<void> {
    if (job.name === JOB_SWEEP) {
      const expired = await this.bookings.expireStale(500);
      if (expired) this.logger.log(`sweeper menandai ${expired} pesanan kedaluwarsa`);
      return;
    }
    const orderId = job.data.orderId;
    if (!orderId) {
      this.logger.warn(`job ${job.id} tanpa orderId`);
      return;
    }
    await this.bookings.expireOrder(orderId);
  }
}
