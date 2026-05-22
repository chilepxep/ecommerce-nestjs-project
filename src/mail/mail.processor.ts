// src/mail/mail.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import * as handlebars from 'handlebars';
import * as nodemailer from 'nodemailer';

@Processor('mail-queue')
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    super();
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('MAIL_HOST'),
      port: Number(this.configService.get<string>('MAIL_PORT')),
      secure: false,
      auth: {
        user: this.configService.get<string>('MAIL_USER'),
        pass: this.configService.get<string>('MAIL_PASSWORD'),
      },
    });
  }

  // ─── BỘ ĐỊNH TUYẾN JOB (ROUTER) ───────────────────────────────
  async process(job: Job<any, any, string>): Promise<any> {
    const { toEmail, fullName, otp } = job.data;

    switch (job.name) {
      case 'send-otp':
        this.logger.debug(
          `[Worker] Xử lý Job Xác thực tài khoản cho: ${toEmail}`,
        );
        await this.sendMailHelper(
          toEmail,
          fullName,
          otp,
          'confirmation.hbs',
          'Mã xác thực OTP tài khoản',
        );
        break;

      case 'send-reset-password':
        this.logger.debug(`[Worker] Xử lý Job Quên mật khẩu cho: ${toEmail}`);
        // Chuyển template thành resetpassword.hbs
        await this.sendMailHelper(
          toEmail,
          fullName,
          otp,
          'resetpassword.hbs',
          'Yêu cầu đặt lại mật khẩu',
        );
        break;

      default:
        this.logger.warn(`[Worker] Nhận được job không hợp lệ: ${job.name}`);
    }
  }

  // ─── HÀM DÙNG CHUNG: ĐỌC TEMPLATE & GỬI ────────────────────────
  private async sendMailHelper(
    toEmail: string,
    fullName: string,
    otp: string,
    templateFileName: string,
    subjectLine: string,
  ) {
    try {
      // 1. Tìm trong build
      let templatePath = path.join(__dirname, 'templates', templateFileName);

      // 2. Fallback tìm trong src
      if (!fs.existsSync(templatePath)) {
        this.logger.warn(
          `[Worker] Đang đọc ${templateFileName} từ source code gốc...`,
        );
        templatePath = path.join(
          process.cwd(),
          'src',
          'mail',
          'templates',
          templateFileName,
        );
      }

      // 3. Compile Handlebars
      const templateSource = fs.readFileSync(templatePath, 'utf8');
      const compiledTemplate = handlebars.compile(templateSource);
      const htmlContent = compiledTemplate({ fullName, otp });

      // 4. Bắn mail đi
      await this.transporter.sendMail({
        from: this.configService.get<string>('MAIL_FROM'),
        to: toEmail,
        subject: subjectLine,
        html: htmlContent,
      });

      this.logger.log(
        `[Worker] Đã gửi ${templateFileName} thành công tới ${toEmail}`,
      );
    } catch (error: any) {
      this.logger.error(
        `[Worker] Gửi ${templateFileName} thất bại: ${error.message}`,
      );
      // Ném lỗi để BullMQ biết mà retry
      throw new InternalServerErrorException('Không thể gửi email lúc này.');
    }
  }
}
