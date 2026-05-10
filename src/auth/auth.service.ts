import { MailService } from '@/mail/mail.service';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RegisterDto, ResendOtpDto, VerifyEmailDto } from './dto/register.dto';
import { ActionType, RoleCode, UserStatus } from '@/generated/prisma/enums';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@/generated/prisma/client';
import { error } from 'console';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly BCRYPT_ROUNDS = 12;
  private readonly OTP_TTL = 300;
  private readonly MAX_OTP_ATTEMPTS = 5;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private mail: MailService,
  ) {}

  //HELPERS
  private generateOtp(): string {
    return randomInt(100000, 999999).toString();
  }

  private async logAction(data: {
    action: ActionType;
    entityName: string;
    entityId: string;
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    ipAddress?: string | null;
    adminId?: string;
  }) {
    return this.prisma.db.actionLog.create({
      data: {
        action: data.action,
        entityName: data.entityName,
        entityId: data.entityId,
        ipAddress: data.ipAddress ?? undefined,

        //Prisma đang gán thẳng khóa ngoại
        adminId: data.adminId,

        //Ép kiểu Record về dạng JSON chuẩn của Prisma
        oldValues: data.oldValues
          ? (data.oldValues as Prisma.InputJsonValue)
          : undefined,
        newValues: data.newValues
          ? (data.newValues as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }
  private async timingSafeCompare(a: string, b: string): Promise<boolean> {
    const { timingSafeEqual } = await import('crypto');
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  async register(dto: RegisterDto, ipAddress?: string) {
    const { email, password, fullName, phone } = dto;

    //1 check cache trước tránh query DB không cần thiết
    const cachedExists = await this.redis.isEmailCached(email);
    if (cachedExists) {
      throw new ConflictException('Email đã được sử dụng');
    }

    //2.Query DB - kiểm tra email tồn tại
    const existingUser = await this.prisma.db.user.findUnique({
      where: { email },
      select: {
        id: true,
        status: true,
      },
    });

    if (existingUser) {
      //Cache kết quả để lần sau không cần query DB
      await this.redis.cacheEmailExists(email);
      if (existingUser.status === UserStatus.PENDING) {
        throw new ConflictException(
          'Email đã đăng ký nhưng chưa xác thực. Vui lòng kiểm tra hộp thư.',
        );
      }
      throw new ConflictException('Email đã được sử dụng');
    }

    if (phone) {
      const existingPhone = await this.prisma.db.user.findUnique({
        where: { phone },
        select: { id: true },
      });
      if (existingPhone) {
        throw new ConflictException('Số điện thoại đã được sử dụng');
      }
    }

    const customerRole = await this.prisma.db.role.findUnique({
      where: { code: RoleCode.CUSTOMER },
      select: { id: true },
    });
    if (!customerRole) {
      throw new InternalServerErrorException(
        'Hệ thống chưa được cấu hình role',
      );
    }

    //5 hash Password + gennerate OTP song song
    const otp = this.generateOtp();
    const [hashedPassword] = await Promise.all([
      bcrypt.hash(password, this.BCRYPT_ROUNDS),
    ]);

    //6. Tạo user trong DB
    let user;
    try {
      user = await this.prisma.db.user.create({
        data: {
          email,
          password: hashedPassword,
          fullName,
          phone,
          status: 'PENDING', // UserStatus.PENDING
          roleId: customerRole.id,
        },
        select: { id: true, email: true, fullName: true, status: true },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          'Email hoặc số điện thoại đã được sử dụng (P2)',
        );
      }
      throw error;
    }

    //7. Luu OTP vao redis va gui mail
    await Promise.all([
      this.redis.setOtp(email, otp, this.OTP_TTL),
      this.redis.cacheEmailExists(email),
    ]);

    //ghi action log khong await, khong block
    this.logAction({
      action: ActionType.CREATE,
      entityName: 'User',
      entityId: user.id,
      newValues: { email, fullName, status: UserStatus.PENDING },
      ipAddress,
    }).catch((err) => this.logger.error('ActionLog failde', err));

    try {
      await this.mail.sendUserConfirmation(email, fullName, otp);
    } catch (mailError) {
      this.logger.error(
        `[Nghiêm trọng] Không thể gửi email tới ${email}`,
        mailError,
      );
      // trả về 201 Created nhưng báo người dùng bấm gửi lại mã
      return {
        message:
          'Đăng ký thành công. Tuy nhiên hệ thống gửi mail đang gián đoạn, vui lòng bấm "Gửi lại OTP" sau ít phút.',
        email: user.email,
      };
    }

    this.logger.log(`Đăng kí thành công: ${email}`);
    return {
      message: 'Đăng ký thành công. Vui lòng kiểm tra email để xác thực OTP.',
      email: user.email,
    };
  }

  async verifyEmail(dto: VerifyEmailDto, ipAddress?: string) {
    const { email, otp } = dto;

    //1 check số lần thử sai
    const attempts = await this.redis.getOtpAttempts(email);
    if (attempts >= this.MAX_OTP_ATTEMPTS) {
      throw new BadRequestException(
        'Bạn đã nhập sai OTP quá nhiều lần. Vui lòng yêu cầu OTP mới sau 15 phút.',
      );
    }
    //2 lấy otp từ redis
    const storedOtp = await this.redis.getOtp(email);
    if (!storedOtp) {
      throw new BadRequestException('OTP đã hết hạn hoặc không tồn tại');
    }

    //3. so sánh OTP
    const isValid = await this.timingSafeCompare(otp, storedOtp);
    if (!isValid) {
      //tăng attempt counter
      const newAttempts = await this.redis.incrementOtpAttempts(email);
      const remaining = this.MAX_OTP_ATTEMPTS - newAttempts;
      throw new BadRequestException(
        remaining > 0
          ? `OTP không đúng. Còn ${remaining} lần thử.`
          : 'OTP không đúng. Tài khoản bị khóa OTP 15 phút.',
      );
    }

    //4 tìm user trong db
    const user = await this.prisma.db.user.findUnique({
      where: { email },
      select: { id: true, status: true, fullName: true },
    });

    if (!user) throw new NotFoundException('Không tìm thấy tài khoản');
    if (user.status === UserStatus.ACTIVE) {
      //cleanup redis nếu đã active
      await Promise.all([
        this.redis.deleteOtp(email),
        this.redis.resetOtpAttempts(email),
      ]);
      throw new BadRequestException('Tài khoản đã được xác định trước đó');
    }

    //5 Update user + cleanup redis song song
    const [updatedUser] = await Promise.all([
      this.prisma.db.user.update({
        where: { email },
        data: {
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
        select: { id: true, email: true, fullName: true, status: true },
      }),
      this.redis.deleteOtp(email),
      this.redis.resetOtpAttempts(email),
      this.redis.invalidateEmailCache(email), //xoá cache cũ
    ]);

    //6 log action (fire and forget)
    this.logAction({
      action: ActionType.UPDATE,
      entityName: 'User',
      entityId: user.id,
      oldValues: { status: UserStatus.PENDING },
      newValues: { status: UserStatus.ACTIVE },
      ipAddress,
    }).catch((err) => this.logger.error('ActionLog failed', err));

    return {
      message: 'Xác thực email thành công!',
      user: {
        email: updatedUser.email,
        fullName: updatedUser.fullName,
      },
    };
  }

  async resendOtp(dto: ResendOtpDto) {
    const { email } = dto;

    //1 kiem tra otp cu con han khong (tranh spam)
    const existingOtp = await this.redis.getOtp(email);
    if (existingOtp) {
      throw new BadRequestException(
        'OTP vẫn còn hiệu lực. Vui lòng kiểm tra email hoặc chờ 5 phút.',
      );
    }

    //2 kiem tra user
    const user = await this.prisma.db.user.findUnique({
      where: { email },
      select: { id: true, status: true, fullName: true },
    });

    if (!user) throw new NotFoundException('Email không tồn tại');
    if (user.status === UserStatus.ACTIVE) {
      throw new BadRequestException('Tài khoản đã được xác thực');
    }
    if (user.status === UserStatus.BANNED) {
      throw new BadRequestException('Tài khoản bị khóa');
    }

    //3 reset attempts va gui otp
    const newOtp = this.generateOtp();
    await Promise.all([
      this.redis.setOtp(email, newOtp, this.OTP_TTL),
      this.redis.resetOtpAttempts(email),
    ]);

    try {
      await this.mail.sendUserConfirmation(email, user.fullName, newOtp);
    } catch (error) {
      this.logger.error(`Lỗi gửi mail Resend OTP cho ${email}:`, error);
      throw new InternalServerErrorException(
        'Không thể gửi email OTP lúc này, vui lòng thử lại sau.',
      );
    }

    return { message: 'OTP mới đã được gửi đến email của bạn.' };
  }
}
