import { z } from 'zod';

export const createOrderSchema = z.object({
  ticketTypeId: z.uuid(),
  quantity: z.int().min(1).max(4),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
