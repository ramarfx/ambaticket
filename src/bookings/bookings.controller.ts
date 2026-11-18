import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Buyer, buyerIdSchema } from '../common/buyer.decorator.js';
import { RateLimitGuard } from '../redis/rate-limit.guard.js';
import { createOrderSchema, type CreateOrderInput } from './bookings.schema.js';
import { BookingsService } from './bookings.service.js';

const MAX_IDEMPOTENCY_KEY = 120;

@Controller()
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post('orders')
  @UseGuards(RateLimitGuard)
  create(
    @Buyer({ schema: buyerIdSchema }) buyerId: string,
    @Body({ schema: createOrderSchema }) body: CreateOrderInput,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const key = idempotencyKey?.trim();
    if (key && key.length > MAX_IDEMPOTENCY_KEY) {
      throw new BadRequestException({
        code: 'invalid_idempotency_key',
        message: `Idempotency-Key maksimal ${MAX_IDEMPOTENCY_KEY} karakter.`,
      });
    }
    return this.bookings.reserve(buyerId, body, key || undefined);
  }

  @Get('orders')
  list(@Buyer({ schema: buyerIdSchema }) buyerId: string) {
    return this.bookings.listMine(buyerId);
  }

  @Get('orders/:id')
  findOne(
    @Buyer({ schema: buyerIdSchema }) buyerId: string,
    @Param('id', { schema: z.uuid() }) id: string,
  ) {
    return this.bookings.findMine(buyerId, id);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  cancel(
    @Buyer({ schema: buyerIdSchema }) buyerId: string,
    @Param('id', { schema: z.uuid() }) id: string,
  ) {
    return this.bookings.cancel(buyerId, id);
  }

  @Get('tickets')
  tickets(@Buyer({ schema: buyerIdSchema }) buyerId: string) {
    return this.bookings.ticketsOf(buyerId);
  }
}
