import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import helmet from 'helmet';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true, // Buffer logs cho đến khi Winston sẵn sàng
  });

  const config = app.get(ConfigService);
  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
  const isDev = config.get('nodeEnv') === 'development';

  // ─── Dùng Winston làm logger mặc định ──────────
  app.useLogger(logger);

  //cookie
  app.use(cookieParser());

  // ─── Helmet: bảo vệ HTTP headers ───────────────
  app.use(
    helmet({
      contentSecurityPolicy: isDev ? false : undefined, // Tắt CSP khi dev
      crossOriginEmbedderPolicy: false,
    }),
  );

  // ─── CORS ──────────────────────────────────────
  app.enableCors({
    origin: (origin, callback) => {
      const allowedOrigins = config
        .get<string>('frontendUrl', '')
        .split(',')
        .map((o) => o.trim());

      // Dev: cho phép tất cả
      if (isDev || !origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: ${origin}`));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    credentials: true, // Cho phép cookie
    maxAge: 86400, // Cache preflight 24h
  });

  // ─── Global prefix ─────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ─── Validation pipe ───────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Tự loại bỏ fields không khai báo trong DTO
      forbidNonWhitelisted: true, // Throw error nếu gửi field lạ
      transform: true, // Auto transform type (string → number)
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // ─── Swagger (chỉ bật khi không phải production) ─
  if (!isDev === false) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Ecommerce API')
      .setDescription('NestJS E-Commerce API Documentation')
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'JWT',
      )
      .addTag('auth', 'Xác thực')
      .addTag('products', 'Sản phẩm')
      .addTag('orders', 'Đơn hàng')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // ─── Graceful shutdown ─────────────────────────
  app.enableShutdownHooks();

  const port = config.get<number>('port', 3000);
  await app.listen(port);

  logger.log(
    `🚀 Server running on http://localhost:${port}/api/v1`,
    'Bootstrap',
  );
  logger.log(`📚 Swagger at http://localhost:${port}/api/docs`, 'Bootstrap');
}

bootstrap();
