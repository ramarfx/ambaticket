import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  // rawBody dibutuhkan untuk memverifikasi tanda tangan webhook.
  const app = await NestFactory.create(AppModule, { instrument: ObserveInstrument, rawBody: true });
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
  console.log(`API siap di ${await app.getUrl()}`);
}
await bootstrap();
