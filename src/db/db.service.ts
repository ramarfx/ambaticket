import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const DEFAULT_URL = 'postgres://ambaticket:ambaticket@localhost:5432/ambaticket';

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  private readonly pool: Pool;
  readonly db: Db;

  constructor() {
    this.pool = new Pool({ connectionString: process.env.DATABASE_URL ?? DEFAULT_URL });
    this.db = drizzle(this.pool, { schema });
  }

  async onModuleInit(): Promise<void> {
    await migrate(this.db, { migrationsFolder: 'drizzle' });
    this.logger.log('skema siap');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
