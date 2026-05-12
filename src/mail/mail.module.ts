import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';
import { BullModule } from '@nestjs/bullmq';
import { MailProcessor } from './mail.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'mail-queue',
    }),
  ],
  controllers: [MailController],
  providers: [MailService, MailProcessor],
  exports: [MailService],
})
export class MailModule {}
