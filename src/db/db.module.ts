import { Global, Inject, Module } from '@nestjs/common';
import type { Db } from './db.service.js';
import { DbService } from './db.service.js';

export const DB = Symbol('DB');

export const injectDb = () => Inject(DB);

@Global()
@Module({
  providers: [
    DbService,
    { provide: DB, useFactory: (service: DbService): Db => service.db, inject: [DbService] },
  ],
  exports: [DbService, DB],
})
export class DbModule {}
