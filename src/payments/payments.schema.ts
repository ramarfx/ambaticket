import { z } from 'zod';

export const paymentWebhookSchema = z.object({
  eventId: z.string().min(1).max(128),
  orderId: z.uuid(),
  type: z.literal('payment.succeeded'),
  amountIdr: z.int().min(0),
});

export type PaymentWebhookInput = z.infer<typeof paymentWebhookSchema>;
