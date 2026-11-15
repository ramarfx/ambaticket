import { z } from 'zod';

export const createEventSchema = z.object({
  name: z.string().trim().min(3).max(200),
  venue: z.string().trim().min(3).max(200),
  startsAt: z.iso.datetime({ offset: true }),
  ticketTypes: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        priceIdr: z.int().min(0),
        quota: z.int().min(1).max(1_000_000),
      }),
    )
    .min(1),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
