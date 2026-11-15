import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getStatus() {
    return { service: 'ambaticket', status: 'ok' };
  }
}
