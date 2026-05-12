import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InternalServerErrorException, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as nodemailer from 'nodemailer';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as handlebars from 'handlebars';

@Processor('mail-queue') // Lắng nghe hàng đợi này
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

  // Hàm process bắt buộc phải có, tự động được gọi khi có Job mới
  async process(job: Job<any, any, string>): Promise<any> {
    const { toEmail, fullName, otp } = job.data;
    if (job.name === 'send-otp') {
      this.logger.debug(`[Worker] Bắt đầu gửi mail OTP cho: ${toEmail}...`);

      try {
        // 1. Cố gắng tìm file trong thư mục build (dist)
        let templatePath = path.join(
          __dirname,
          'templates',
          'confirmation.hbs',
        );

        // 2. CHIẾN THUẬT FALLBACK: Nếu trong dist không có, quay về đọc thẳng từ src gốc
        if (!fs.existsSync(templatePath)) {
          this.logger.warn(
            'Không tìm thấy template trong dist, đang đọc từ src...',
          );
          // process.cwd() sẽ lấy thư mục gốc của dự án (ecommerce-api)
          templatePath = path.join(
            process.cwd(),
            'src',
            'mail',
            'templates',
            'confirmation.hbs',
          );
        }

        // 3. Đọc nội dung file
        const templateSource = fs.readFileSync(templatePath, 'utf8');
        const compiledTemplate = handlebars.compile(templateSource);

        const htmlContent = compiledTemplate({
          fullName: fullName,
          otp: otp,
        });

        await this.transporter.sendMail({
          from: this.configService.get<string>('MAIL_FROM'),
          to: toEmail,
          subject: 'Mã xác thực OTP tài khoản',
          html: htmlContent,
        });

        this.logger.log(`Đã gửi email chứa mã OTP thành công tới: ${toEmail}`);
        this.logger.debug(`[Worker] Đã gửi mail thành công tới ${toEmail}!`);
      } catch (error: any) {
        this.logger.error(`[Worker] Gửi mail thất bại: ${error.message}`);
        throw new InternalServerErrorException(
          'Không thể gửi email OTP lúc này.',
        );
      }
    }
  }
}
