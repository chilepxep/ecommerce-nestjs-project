import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import appConfig from './config/app.config';
import { WinstonModule } from 'nest-winston';
import { winstonConfig } from './config/winston.config';
import { PrismaModule } from './prisma/prisma.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { MailModule } from './mail/mail.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { BullModule } from '@nestjs/bullmq';
import { PermissionsModule } from './permissions/permissions.module';
import { RolesModule } from './roles/roles.module';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RbacGuard } from './auth/guards/rbac.guard';

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

    //cấu hình BullModule để gửi mail
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD'),
        },
      }),
    }),

    JwtModule.register({}),

    MailModule,

    RedisModule,

    AuthModule,

    PermissionsModule,

    RolesModule,
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
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RbacGuard,
    },
  ],
})
export class AppModule {}
