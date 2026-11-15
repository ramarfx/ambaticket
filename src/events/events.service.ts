import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type SQL, desc, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../db/db.module.js';
import type { Db } from '../db/db.service.js';
import { events, orders, ticketTypes } from '../db/schema.js';
import type { CreateEventInput } from './events.schema.js';

export type TicketTypeView = {
  eventId: string;
  id: string;
  name: string;
  priceIdr: number;
  quota: number;
  sold: number;
  held: number;
  remaining: number;
};

export type EventView = {
  id: string;
  name: string;
  venue: string;
  startsAt: Date;
  createdAt: Date;
  ticketTypes: TicketTypeView[];
};

// sold dan held hanya menghitung pesanan yang masih memegang kursi. Pesanan
// pending yang lewat 15 menit berhenti dihitung tanpa job apa pun.
const typeStats = {
  eventId: ticketTypes.eventId,
  id: ticketTypes.id,
  name: ticketTypes.name,
  priceIdr: ticketTypes.priceIdr,
  quota: ticketTypes.quota,
  sold: sql<number>`coalesce(sum(${orders.quantity}) filter (where ${orders.status} = 'paid'), 0)::int`,
  held: sql<number>`coalesce(sum(${orders.quantity}) filter (
    where ${orders.status} = 'pending' and ${orders.expiresAt} > now()
  ), 0)::int`,
};

@Injectable()
export class EventsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async create(input: CreateEventInput): Promise<EventView> {
    const eventId = await this.db.transaction(async (tx) => {
      const [event] = await tx
        .insert(events)
        .values({ name: input.name, venue: input.venue, startsAt: new Date(input.startsAt) })
        .returning({ id: events.id });
      await tx
        .insert(ticketTypes)
        .values(input.ticketTypes.map((type) => ({ eventId: event.id, ...type })));
      return event.id;
    });
    return this.findOne(eventId);
  }

  async findAll(): Promise<EventView[]> {
    const rows = await this.db
      .select({
        id: events.id,
        name: events.name,
        venue: events.venue,
        startsAt: events.startsAt,
        createdAt: events.createdAt,
      })
      .from(events)
      .orderBy(events.startsAt, events.createdAt);
    if (rows.length === 0) return [];

    const stats = await this.statsOf(inArray(ticketTypes.eventId, rows.map((row) => row.id)));
    return rows.map((event) => ({
      ...event,
      ticketTypes: stats.filter((type) => type.eventId === event.id).map(toTicketTypeView),
    }));
  }

  async findOne(id: string): Promise<EventView> {
    const [event] = await this.db
      .select({
        id: events.id,
        name: events.name,
        venue: events.venue,
        startsAt: events.startsAt,
        createdAt: events.createdAt,
      })
      .from(events)
      .where(eq(events.id, id));
    if (!event) {
      throw new NotFoundException({ code: 'event_not_found', message: 'Event tidak ditemukan.' });
    }
    return { ...event, ticketTypes: (await this.statsOf(eq(ticketTypes.eventId, id))).map(toTicketTypeView) };
  }

  private statsOf(where: SQL) {
    return this.db
      .select(typeStats)
      .from(ticketTypes)
      .leftJoin(orders, eq(orders.ticketTypeId, ticketTypes.id))
      .where(where)
      .groupBy(ticketTypes.id)
      .orderBy(desc(ticketTypes.priceIdr));
  }
}

const toTicketTypeView = (row: Omit<TicketTypeView, 'remaining'>): TicketTypeView => ({
  ...row,
  remaining: row.quota - row.sold - row.held,
});
