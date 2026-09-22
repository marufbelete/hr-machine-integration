import * as dotenv from 'dotenv';
import * as path from 'path';

// __dirname inside pkg resolves to the snapshot path (e.g. /snapshot/hr/dist/)
// __dirname in normal node run resolves to the real dist/ folder
// Either way, '../.env' correctly locates the .env file (bundled asset or project root)
dotenv.config({ path: path.join(__dirname, '../.env') });

import { ClassSerializerInterceptor, ValidationPipe } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { AppModule } from "./app.module";
import helmet from "helmet";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

   app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  );
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.setGlobalPrefix("api");

  const config = new DocumentBuilder()
    .setTitle("API DOCUMENTATION")
    .setDescription("API")
    .setVersion("1.0")
    .addTag("APIs")
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api_doc", app, document);

  app.use(helmet());
  app.enableCors({
    origin: ["http://localhost:3000"],
    credentials: true,
  });
  await app.listen(7000);
}
bootstrap();
