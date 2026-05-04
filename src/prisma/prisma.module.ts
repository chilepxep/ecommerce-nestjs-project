import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // Global = inject PrismaService ở bất kỳ module nào không cần import lại
export class PrismaModule {
  static forRoot() {
    return {
      module: PrismaModule,
      providers: [PrismaService],
      exports: [PrismaService],
    };
  }
}
