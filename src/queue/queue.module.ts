import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { redisUrl } from '../redis/connection.js';
import { ExpiryProducer } from './expiry.producer.js';
import { ORDER_EXPIRY_QUEUE } from './queue.constants.js';

@Global()
@Module({
  imports: [
    BullModule.forRoot({
      connection: { url: redisUrl(), maxRetriesPerRequest: null, enableOfflineQueue: false },
    }),
    BullModule.registerQueue({ name: ORDER_EXPIRY_QUEUE }),
  ],
  providers: [ExpiryProducer],
  exports: [ExpiryProducer],
})
export class QueueModule {}
