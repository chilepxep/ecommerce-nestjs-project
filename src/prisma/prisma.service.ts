import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb'; // ← adapter MySQL/MariaDB
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { PrismaClient, Prisma } from '@/generated/prisma/client';
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private prisma!: PrismaClient;

  constructor(
    private readonly config: ConfigService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.connectWithRetry(5, 3000);
    await this.healthCheck();
  }

  private async connectWithRetry(
    retries: number,
    delayMs: number,
  ): Promise<void> {
    const adapter = new PrismaMariaDb({
      host: this.config.get<string>('DB_HOST', 'localhost'),
      port: this.config.get<number>('DB_PORT', 3306),
      user: this.config.get<string>('DB_USERNAME', 'root'),
      password: this.config.get<string>('DB_PASSWORD', ''),
      database: this.config.get<string>(
        'DB_DATABASE',
        'ecommerce-api-application',
      ),
      connectionLimit: this.config.get<number>('DB_POOL_SIZE', 10),
      allowPublicKeyRetrieval: true,
      ssl: false,
    });

    // ── Closure variable — accessible bên trong $extends callback ────────
    const slowQueries: Array<{
      model?: string;
      operation: string;
      duration: number;
    }> = [];
    const logger = this.logger; // capture this.logger vào closure

    this.prisma = new PrismaClient({ adapter }).$extends({
      query: {
        async $allOperations({ model, operation, args, query }) {
          const start = performance.now();
          const result = await query(args);
          const duration = Math.round(performance.now() - start);

          if (duration > 300) {
            slowQueries.push({ model, operation, duration });
            logger.warn(`🐢 Slow query (${duration}ms): ${model}.${operation}`);
          }
          return result;
        },
      },
    }) as unknown as PrismaClient;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.prisma.$queryRaw`SELECT 1`;

        // Sau khi connect xong mới log — logger đã sẵn sàng
        this.flushSlowQueries(slowQueries, logger);

        this.logger.log(
          `✅ MySQL connected via Prisma 7 (attempt ${attempt})`,
          'PrismaService',
        );
        return;
      } catch (err) {
        this.logger.warn(
          `DB connection attempt ${attempt}/${retries} failed: ${(err as Error).message}`,
          'PrismaService',
        );
        if (attempt === retries) {
          this.logger.error(
            '❌ Cannot connect to MySQL after max retries',
            (err as Error).stack,
            'PrismaService',
          );
          throw err;
        }
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  private flushSlowQueries(
    buffer: Array<{ model?: string; operation: string; duration: number }>,
    logger: LoggerService,
  ): void {
    for (const entry of buffer) {
      logger.warn(
        `🐢 Slow query (${entry.duration}ms): ${entry.model ?? 'raw'}.${entry.operation}`,
        'PrismaService',
      );
    }
    buffer.length = 0;
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
    this.logger.log('🔌 MySQL disconnected', 'PrismaService');
  }

  get db(): PrismaClient {
    return this.prisma;
  }

  async $transaction<T>(
    fn: (
      tx: Omit<
        PrismaClient,
        '$connect' | '$disconnect' | '$transaction' | '$extends'
      >,
    ) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T> {
    return this.prisma.$transaction(
      fn as Parameters<typeof this.prisma.$transaction>[0],
      options,
    ) as Promise<T>;
  }

  private async healthCheck(): Promise<void> {
    try {
      // Query thật — Prisma 7 sẽ mở kết nối tại đây
      await this.prisma.$queryRaw`SELECT 1`;
      this.logger.log('✅ DB health check passed', 'PrismaService');
    } catch (err) {
      this.logger.error(
        '❌ DB health check failed — check DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD',
        (err as Error).message,
        'PrismaService',
      );
      throw err; // throw để app không start được nếu DB lỗi
    }
  }
}
