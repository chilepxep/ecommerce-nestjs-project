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

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly configService: ConfigService) {
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

  /**
   * @param toEmail Email người nhận
   * @param fullName Tên người dùng
   * @param otp Mã OTP 6 số
   */
  async sendUserConfirmation(toEmail: string, fullName: string, otp: string) {
    try {
      // 1. Cố gắng tìm file trong thư mục build (dist)
      let templatePath = path.join(__dirname, 'templates', 'confirmation.hbs');

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
    } catch (error) {
      this.logger.log(
        `MAIL_USER=${this.configService.get<string>('MAIL_USER')}`,
      );
      this.logger.log(
        `MAIL_PASS length=${this.configService.get<string>('MAIL_PASS')?.length}`,
      );
      this.logger.error(`Lỗi khi gửi email tới ${toEmail}:`, error);
      throw new InternalServerErrorException(
        'Không thể gửi email OTP lúc này.',
      );
    }
  }
}
