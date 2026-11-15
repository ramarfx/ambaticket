import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { Buyer, buyerIdSchema } from '../common/buyer.decorator.js';
import { createOrderSchema, type CreateOrderInput } from './bookings.schema.js';
import { BookingsService } from './bookings.service.js';

@Controller()
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post('orders')
  create(
    @Buyer({ schema: buyerIdSchema }) buyerId: string,
    @Body({ schema: createOrderSchema }) body: CreateOrderInput,
  ) {
    return this.bookings.reserve(buyerId, body);
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
