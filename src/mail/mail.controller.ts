import { Controller, Post, Body } from '@nestjs/common';
import { MailService } from './mail.service';

@Controller('mail') // Tiền tố route, kết hợp với global prefix sẽ thành /api/v1/mail
export class MailController {
  // Inject MailService vào Controller
  constructor(private readonly mailService: MailService) {}

  @Post('test-mail')
  async testMail(@Body() body: { email: string; fullName: string }) {
    // 1. Hardcode một mã OTP để test
    const testOtp = '123456';

    // 2. Gọi hàm gửi thư từ Service
    await this.mailService.sendUserConfirmation(
      body.email,
      body.fullName,
      testOtp,
    );

    // 3. Trả về kết quả
    return {
      success: true,
      message: `Đã gửi email test thành công tới ${body.email}`,
      data: {
        otpMoc: testOtp,
      },
    };
  }
}
