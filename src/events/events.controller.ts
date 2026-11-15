import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { createEventSchema, type CreateEventInput } from './events.schema.js';
import { EventsService } from './events.service.js';

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  create(@Body({ schema: createEventSchema }) body: CreateEventInput) {
    return this.events.create(body);
  }

  @Get()
  findAll() {
    return this.events.findAll();
  }

  @Get(':id')
  findOne(@Param('id', { schema: z.uuid() }) id: string) {
    return this.events.findOne(id);
  }
}
