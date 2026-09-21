import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { setupApp } from './app.setup.js';
import { NodeEnv } from './config/env.validation.js';

const bootstrap = async () => {
  // bodyParser off: setupApp registers the parsers with an explicit size limit instead.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  app.useLogger(app.get(Logger));
  setupApp(app);

  const config = app.get(ConfigService);

  if (config.getOrThrow<NodeEnv>('NODE_ENV') !== NodeEnv.Production) {
    const docConfig = new DocumentBuilder().setTitle('Template Backend').setVersion('0.0.1').addBearerAuth().build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, docConfig));
  }

  await app.listen(config.getOrThrow<number>('PORT'));
};
await bootstrap();
