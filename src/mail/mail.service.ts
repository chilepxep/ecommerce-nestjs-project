import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';
import * as handlebars from 'handlebars';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(@InjectQueue('mail-queue') private mailQueue: Queue) {}
  async sendUserConfirmation(toEmail: string, fullName: string, otp: string) {
    try {
      await this.mailQueue.add(
        'send-otp', // Tên của công việc (Job Name)
        { toEmail, fullName, otp }, // Dữ liệu của công việc (Job Data)
        {
          attempts: 3, // Nếu gửi mail lỗi (do rớt mạng), tự động thử lại 3 lần
          backoff: { type: 'exponential', delay: 3000 }, // Mỗi lần thử lại cách nhau lâu hơn (3s, 9s, 27s...)
          removeOnComplete: true, // Gửi xong thì xóa khỏi Redis cho nhẹ máy
        },
      );
      this.logger.log(
        `Đã đẩy nhiệm vụ gửi OTP cho ${toEmail} vào hàng đợi ngầm.`,
      );
    } catch (error: any) {
      this.logger.error(`Lỗi khi đưa mail vào Queue: ${error.message}`);
    }
  }

  async sendPasswordReset(toEmail: string, fullName: string, otp: string) {
    try {
      await this.mailQueue.add(
        'send-reset-password', // Tên Job mới
        { toEmail, fullName, otp },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 3000 },
          removeOnComplete: true,
        },
      );
      this.logger.log(
        `Đã đẩy nhiệm vụ gửi OTP Đặt Lại Mật Khẩu cho ${toEmail} vào hàng đợi.`,
      );
    } catch (error: any) {
      this.logger.error(`Lỗi khi đưa mail reset vào Queue: ${error.message}`);
    }
  }
}
