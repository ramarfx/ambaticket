import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { z } from 'zod';

// Identitas pembeli seadanya untuk latihan ini: header, bukan autentikasi sungguhan.
export const buyerIdSchema = z.string().trim().min(1).max(64);

export const Buyer = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined> }>().headers[
      'x-buyer-id'
    ],
);
