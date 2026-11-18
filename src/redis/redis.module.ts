import { Global, Injectable, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { redisOptions } from './connection.js';

export const REDIS = Symbol('REDIS');

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor() {
    this.client = new Redis(
      redisOptions({
        // Redis hanya penahan beban. Perintah yang gagal harus gagal cepat, bukan
        // menggantung, supaya penjualan tetap jalan saat Redis mati.
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 500,
        retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
      }),
    );
    this.client.on('error', (error: Error) => this.logger.debug(`Redis: ${error.message}`));
  }

  // Boot tidak boleh gagal hanya karena Redis belum siap. Tunggu sebentar, lalu lanjut.
  async onModuleInit(): Promise<void> {
    if (this.client.status === 'ready') return;
    await Promise.race([
      new Promise<void>((resolve) => this.client.once('ready', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 500).unref()),
    ]);
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}

@Global()
@Module({
  providers: [
    RedisService,
    { provide: REDIS, useFactory: (service: RedisService): Redis => service.client, inject: [RedisService] },
  ],
  exports: [RedisService, REDIS],
})
export class RedisModule {}
