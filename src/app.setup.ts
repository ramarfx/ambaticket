import { type INestApplication, StandardSchemaValidationPipe } from '@nestjs/common';

// Dipakai main.ts dan test, supaya perilaku HTTP di test sama dengan di container.
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(new StandardSchemaValidationPipe({ validateCustomDecorators: true }));
}
