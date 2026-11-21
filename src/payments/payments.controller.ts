import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  paymentWebhookSchema,
  type PaymentWebhookInput,
} from './payments.schema.js';
import { PaymentsService } from './payments.service.js';

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('orders/:id/pay')
  @HttpCode(200)
  pay(@Param('id', { schema: z.uuid() }) id: string) {
    return this.payments.pay(id);
  }

  @Post('webhooks/payments')
  @HttpCode(200)
  webhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-payment-signature') signature: string | undefined,
    @Body({ schema: paymentWebhookSchema }) body: PaymentWebhookInput,
  ) {
    return this.payments.handleWebhook(request.rawBody, signature, body);
  }
}
