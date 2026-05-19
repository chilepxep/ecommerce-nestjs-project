import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  Ip,
  Res,
  Req,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RegisterDto, ResendOtpDto, VerifyEmailDto } from './dto/register.dto';
import { Public } from '@/common/decorator/public.decorator';
import { LoginDto } from './dto/login.dto';
import type { Response, Request } from 'express';
import { CurrentUser } from '@/common/decorator/current-user.decorator';
import type { IUser } from '@/common/interfaces/user.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  // Override throttle: 3 lần / 60 giây cho endpoint nhạy cảm
  @Throttle({ short: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Đăng ký tài khoản mới' })
  @ApiResponse({ status: 201, description: 'Đăng ký thành công' })
  @ApiResponse({ status: 409, description: 'Email đã tồn tại' })
  async register(@Body() dto: RegisterDto, @Ip() ip: string) {
    return this.authService.register(dto, ip);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Xác thực OTP qua email' })
  async verifyEmail(@Body() dto: VerifyEmailDto, @Ip() ip: string) {
    return this.authService.verifyEmail(dto, ip);
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 2, ttl: 60000 } }) // Rất hạn chế
  @ApiOperation({ summary: 'Gửi lại OTP' })
  async resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, jti, sessionId } =
      await this.authService.login(dto, ip, ua ?? '');

    // Set httpOnly cookies — không để JS đọc được
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000, // 15 phút
    });

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 ngày
      path: '/api/v1/auth/refresh', // Chỉ gửi lên endpoint refresh
    });

    res.cookie('jti', jti, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth/refresh',
    });

    return { message: 'Đăng nhập thành công', accessToken, sessionId };
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.['refresh_token'];
    const jti = req.cookies?.['jti'];

    if (!refreshToken || !jti) {
      throw new UnauthorizedException('Không tìm thấy refresh token');
    }

    const { accessToken, refreshToken: newRefresh } =
      await this.authService.refresh(refreshToken, jti);

    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000,
    });

    res.cookie('refresh_token', newRefresh, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth/refresh',
    });

    return { message: 'Làm mới token thành công' };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: IUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user.jti, user.id);

    // Xóa cookies
    res.clearCookie('access_token');
    res.clearCookie('refresh_token', { path: '/api/v1/auth/refresh' });
    res.clearCookie('jti', { path: '/api/v1/auth/refresh' });

    return { message: 'Đăng xuất thành công' };
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Danh sách thiết bị đang đăng nhập' })
  getSessions(@CurrentUser() user: IUser) {
    return this.authService.getSessions(user.id);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Thu hồi phiên đăng nhập cụ thể' })
  revokeSession(@Param('id') sessionId: string, @CurrentUser() user: IUser) {
    return this.authService.revokeSession(sessionId, user.id);
  }

  @Post('logout-others')
  @ApiOperation({
    summary: 'Đăng xuất tất cả thiết bị khác, giữ nguyên thiết bị hiện tại',
  })
  logoutOtherDevices(@CurrentUser() user: IUser) {
    return this.authService.logoutOtherSessions(user.jti, user.id);
  }
}
