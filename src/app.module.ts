import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import appConfig from './config/app.config';
import { WinstonModule } from 'nest-winston';
import { winstonConfig } from './config/winston.config';
import { PrismaModule } from './prisma/prisma.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

@Module({
  imports: [
    // ─── Config ───────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: [`.env.${process.env.NODE_ENV || 'development'}`],
    }),

    // ─── Logger ───────────────────────────────────
    WinstonModule.forRoot(winstonConfig),

    //─── Prisma database ───────────────────────────────────
    PrismaModule.forRoot(),

    ThrottlerModule.forRoot([
      {
        name: 'short', // 10 request / 1 giây
        ttl: 1000,
        limit: 10,
      },
      {
        name: 'medium', // 100 request / 1 phút
        ttl: 60000,
        limit: 100,
      },
      {
        name: 'long', // 1000 request / 1 giờ
        ttl: 3600000,
        limit: 1000,
      },
    ]),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Rate limit guard áp dụng toàn bộ
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Exception filter toàn bộ
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    // Response transform toàn bộ
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    // Request logging toàn bộ
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
