import { MailService } from '@/mail/mail.service';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { RegisterDto, ResendOtpDto, VerifyEmailDto } from './dto/register.dto';
import { ActionType, RoleCode, UserStatus } from '@/generated/prisma/enums';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@/generated/prisma/client';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { IUser } from '@/common/interfaces/user.interface';
import { LoginDto } from './dto/login.dto';
import { randomUUID } from 'crypto';
import { UAParser } from 'ua-parser-js';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyResetOtpDto,
} from './dto/forgot-password.dto';
import e from 'express';
import { use } from 'passport';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly BCRYPT_ROUNDS = 12;
  private readonly OTP_TTL = 300;
  private readonly MAX_OTP_ATTEMPTS = 5;
  private readonly RESET_OTP_TTL = 600; // 10 phút
  private readonly RESET_TOKEN_TTL = 600;
  private readonly MAX_RESET_ATTEMPTS = 5;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private mail: MailService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  private readonly ACCESS_TTL = 15 * 60; // 15 phút (giây)
  private readonly REFRESH_TTL = 7 * 24 * 3600; // 7 ngày (giây)
  private readonly MAX_SESSIONS = 5; // Tối đa 5 thiết bị

  //HELPERS
  //tạo otp
  private generateOtp(): string {
    return randomInt(100000, 999999).toString();
  }
  //ghi log
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

  //so sánh otp
  private async timingSafeCompare(a: string, b: string): Promise<boolean> {
    const { timingSafeEqual } = await import('crypto');
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  //tạo payload access token
  private signAccessToken(payload: IUser): string {
    return this.jwt.sign(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      expiresIn: this.ACCESS_TTL,
    });
  }

  private async enforceSessionLimit(userId: string) {
    const activeSessions = await this.prisma.db.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'asc' }, // Cũ nhất trước
      select: { id: true, jti: true },
    });

    if (activeSessions.length >= this.MAX_SESSIONS) {
      // Xóa session cũ nhất
      const oldest = activeSessions[0];
      await Promise.all([
        this.prisma.db.session.update({
          where: { id: oldest.id },
          data: {
            revokedAt: new Date(),
            revokedReason: 'Session limit exceeded',
          },
        }),
        this.redis.revokeSession(oldest.jti, this.ACCESS_TTL),
      ]);
    }
  }

  private async revokeAllUserSessions(userId: string, reason: string) {
    const sessions = await this.prisma.db.session.findMany({
      where: { userId, revokedAt: null },
      select: { id: true, jti: true },
    });

    await Promise.all([
      this.prisma.db.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      }),
      ...sessions.map((s) => this.redis.revokeSession(s.jti, this.ACCESS_TTL)),
    ]);
  }

  //---------Đăng ký-------------
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

  //----------Đăng nhập------------

  async login(dto: LoginDto, ipAddress: string, userAgent: string) {
    const { email, password, deviceName } = dto;

    // 1. Tìm user kèm role
    const user = await this.prisma.db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        fullName: true,
        password: true,
        status: true,
        deletedAt: true,
        role: { select: { id: true, code: true } },
      },
    });

    // Trả cùng 1 lỗi để tránh user enumeration
    if (!user || !user.password) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    // 2. Kiểm tra trạng thái tài khoản
    if (user.deletedAt) {
      throw new UnauthorizedException('Tài khoản không tồn tại');
    }
    if (user.status === UserStatus.PENDING) {
      throw new UnauthorizedException('Tài khoản chưa xác thực email');
    }
    if (user.status === UserStatus.BANNED) {
      throw new UnauthorizedException('Tài khoản đã bị khóa');
    }

    // 3. Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    // 4. Giới hạn số session — xóa session cũ nhất nếu vượt quá MAX
    await this.enforceSessionLimit(user.id);

    // 5. Parse user agent
    const ua = new UAParser(userAgent);
    const parsedDevice =
      deviceName ??
      `${ua.getBrowser().name ?? 'Unknown'} on ${ua.getOS().name ?? 'Unknown'}`;

    // 6. Tạo token pair
    const jti = randomUUID();
    const refreshToken = randomUUID(); // opaque token
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

    const expiresAt = new Date(Date.now() + this.REFRESH_TTL * 1000);

    // 7. Tạo Session trong DB + cập nhật lastLoginAt SONG SONG
    const [session] = await Promise.all([
      this.prisma.db.session.create({
        data: {
          userId: user.id,
          jti,
          refreshTokenHash,
          tokenVersion: 1,
          deviceName: parsedDevice,
          deviceIp: ipAddress,
          userAgent,
          expiresAt,
        },
      }),
      this.prisma.db.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      }),
    ]);

    // 8. Cache session vào Redis
    await Promise.all([
      this.redis.cacheSession(
        jti,
        { userId: user.id, tokenVersion: 1, roleCode: user.role.code },
        this.REFRESH_TTL,
      ),
      this.redis.addUserSession(user.id, jti),
    ]);

    // 9. Ký accessToken
    const accessToken = this.signAccessToken({
      id: user.id,
      jti,
      email: user.email,
      roleCode: user.role.code,
      tokenVersion: 1,
    });

    // 10. Log
    this.logAction({
      action: ActionType.LOGIN,
      entityName: 'Session',
      entityId: session.id,
      adminId: user.id,
      newValues: { device: parsedDevice, ip: ipAddress },
      ipAddress,
    }).catch((err) => this.logger.error('ActionLog failed', err));

    return { accessToken, refreshToken, jti, sessionId: session.id };
  }

  async refresh(refreshToken: string, jti: string) {
    // 1. Tìm session trong DB (Redis không lưu refreshToken hash)
    const session = await this.prisma.db.session.findUnique({
      where: { jti },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            status: true,
            role: { select: { code: true } },
          },
        },
      },
    });

    if (!session) throw new UnauthorizedException('Phiên không hợp lệ');

    // 2. Kiểm tra các điều kiện
    if (session.revokedAt) {
      throw new UnauthorizedException('Phiên đã bị thu hồi');
    }
    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException('Phiên đã hết hạn');
    }
    if (session.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Tài khoản không hợp lệ');
    }

    // 3. Verify refresh token hash
    const isValid = await bcrypt.compare(
      refreshToken,
      session.refreshTokenHash,
    );
    if (!isValid) {
      // Token không khớp → có thể bị đánh cắp → revoke toàn bộ session
      await this.revokeAllUserSessions(
        session.userId,
        'Phát hiện refresh token bất thường',
      );
      throw new UnauthorizedException(
        'Token không hợp lệ. Tất cả phiên đã bị đăng xuất.',
      );
    }

    // 4. Rotate: tạo refreshToken mới + tăng tokenVersion
    const newRefreshToken = randomUUID();
    const newRefreshTokenHash = await bcrypt.hash(newRefreshToken, 10);
    const newTokenVersion = session.tokenVersion + 1;

    await this.prisma.db.session.update({
      where: { jti },
      data: {
        refreshTokenHash: newRefreshTokenHash,
        tokenVersion: newTokenVersion,
        expiresAt: new Date(Date.now() + this.REFRESH_TTL * 1000),
      },
    });

    // 5. Cập nhật Redis cache
    await this.redis.cacheSession(
      jti,
      {
        userId: session.userId,
        tokenVersion: newTokenVersion,
        roleCode: session.user.role.code,
      },
      this.REFRESH_TTL,
    );

    // 6. Ký accessToken mới
    const accessToken = this.signAccessToken({
      id: session.userId,
      jti,
      email: session.user.email,
      roleCode: session.user.role.code,
      tokenVersion: newTokenVersion,
    });

    return { accessToken, refreshToken: newRefreshToken };
  }

  //Người dùng đăng xuất khỏi thiết bị hiện tại
  async logout(jti: string, userId: string) {
    await Promise.all([
      // Revoke trong DB
      this.prisma.db.session.updateMany({
        where: { jti, userId },
        data: { revokedAt: new Date(), revokedReason: 'User logout' },
      }),
      // Blacklist + xóa cache
      this.redis.revokeSession(jti, this.ACCESS_TTL),
      this.redis.removeUserSession(userId, jti),
    ]);

    return { message: 'Đăng xuất thành công' };
  }

  //lấy danh sách thiết bị
  async getSessions(userId: string) {
    const sessions = await this.prisma.db.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        jti: true,
        deviceName: true,
        deviceIp: true,
        createdAt: true,
        expiresAt: true,
        tokenVersion: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return sessions;
  }

  //logout một thiết bị cụ thể
  async revokeSession(sessionId: string, userId: string) {
    const session = await this.prisma.db.session.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) throw new NotFoundException('Session không tồn tại');
    if (session.revokedAt)
      throw new BadRequestException('Session đã bị thu hồi');

    await Promise.all([
      this.prisma.db.session.update({
        where: { id: sessionId },
        data: { revokedAt: new Date(), revokedReason: 'Revoked by user' },
      }),
      this.redis.revokeSession(session.jti, this.ACCESS_TTL),
      this.redis.removeUserSession(userId, session.jti),
    ]);

    return { message: 'Thu hồi phiên thành công' };
  }

  async logoutOtherSessions(currentJti: string, userId: string) {
    // 1. Lấy tất cả session còn hoạt động ngoại trừ session hiện tại
    const sessions = await this.prisma.db.session.findMany({
      where: {
        userId,
        revokedAt: null,
        NOT: {
          jti: currentJti,
        },
      },
      select: {
        id: true,
        jti: true,
      },
    });

    // Không có session nào khác
    if (sessions.length === 0) {
      return {
        message: 'Không có thiết bị nào khác để đăng xuất',
        revokedCount: 0,
      };
    }

    const sessionJtis = sessions.map((s) => s.jti);

    // 2. Revoke trong database
    await this.prisma.db.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        NOT: {
          jti: currentJti,
        },
      },
      data: {
        revokedAt: new Date(),
        revokedReason: 'Logout other devices',
      },
    });

    // 3. Blacklist tất cả jti trong Redis
    await Promise.all([
      ...sessionJtis.map((jti) =>
        this.redis.revokeSession(jti, this.ACCESS_TTL),
      ),
      // 4. Xóa khỏi danh sách session của user
      ...sessionJtis.map((jti) => this.redis.removeUserSession(userId, jti)),
    ]);

    // 5. Log action (optional)
    this.logAction({
      action: ActionType.LOGOUT,
      entityName: 'Session',
      entityId: userId,
      adminId: userId,
      newValues: {
        revokedCount: sessions.length,
        excludedJti: currentJti,
      },
    }).catch((err) => this.logger.error('ActionLog failed', err));

    return {
      message: 'Đã đăng xuất khỏi tất cả thiết bị khác',
      revokedCount: sessions.length,
    };
  }

  //quen mat khau
  //1 gửi otp
  async forgotPassword(dto: ForgotPasswordDto) {
    const { email } = dto;

    // Kiểm tra Cooldown: Chặn gửi liên tục dưới 60 giây
    const isCooldown = await this.redis.getResetOtpCooldown(email);
    if (isCooldown) {
      throw new HttpException(
        'Vui lòng đợi 60 giây trước khi yêu cầu mã mới.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    //luon tra ve 200 du email co ton tai hay khong
    //chong user enumeration attack
    const user = await this.prisma.db.user.findUnique({
      where: { email },
      select: { id: true, fullName: true, status: true, deletedAt: true },
    });

    //ghi log nhung khong bao loi ra ngoai
    if (!user || user.deletedAt || user.status === UserStatus.BANNED) {
      this.logger.warn(
        `Reset password request cho email không hợp lệ: ${email}`,
      );
      await this.redis.setResetOtpCooldown(email, 60);
      return { message: 'Nếu email tồn tại, mã OTP sẽ được gửi đến hộp thư.' };
    }

    let otp = await this.redis.getResetOtp(email);

    // Chưa có OTP → tạo mới
    if (!otp) {
      otp = this.generateOtp();

      // Chỉ set khi OTP chưa tồn tại
      // -> giữ nguyên TTL nếu resend
      await this.redis.setResetOtp(email, otp, this.RESET_OTP_TTL);

      this.logger.log(`Tạo OTP mới cho email: ${email}`);
    } else {
      this.logger.log(`Gửi lại OTP cũ cho email: ${email}`);
    }

    // =========================================================
    // 5. Gửi mail
    // =========================================================
    try {
      await this.mail.sendPasswordReset(email, user.fullName, otp);
    } catch (error) {
      this.logger.error(
        `Gửi mail reset password thất bại cho ${email}`,
        error instanceof Error ? error.stack : String(error),
      );

      // KHÔNG set cooldown nếu mail fail
      // -> user có thể thử lại ngay
      throw new InternalServerErrorException(
        'Không thể gửi email lúc này. Vui lòng thử lại.',
      );
    }

    // =========================================================
    // 6. Chỉ set cooldown sau khi mail thành công
    // =========================================================
    await this.redis.setResetOtpCooldown(email, 60);

    return {
      message: 'Nếu email tồn tại, mã OTP sẽ được gửi đến hộp thư.',
    };
  }

  //2. xác nhận
  async verifyResetOtp(dto: VerifyResetOtpDto) {
    const { email, otp } = dto;

    //1 kiểm tra số lần thử sai
    const attempts = await this.redis.getOtpAttempts(email);
    if (attempts >= this.MAX_RESET_ATTEMPTS) {
      throw new BadRequestException(
        'Bạn đã nhập sai OTP quá nhiều lần. Vui lòng yêu cầu lại sau 15 phút.',
      );
    }

    //2 lấy otp từ redis
    const storedOtp = await this.redis.getResetOtp(email);
    if (!storedOtp) {
      throw new BadRequestException('OTP đã hết hạn hoặc không tồn tại');
    }

    //3 so sánh timing-safe
    const isValid = await this.timingSafeCompare(otp, storedOtp);
    if (!isValid) {
      const newAttempts = await this.redis.incrementResetOtpAttempts(email);
      const remaining = this.MAX_RESET_ATTEMPTS - newAttempts;
      throw new BadRequestException(
        remaining > 0
          ? `OTP không đúng. Còn ${remaining} lần thử.`
          : 'OTP không đúng. Vui lòng yêu cầu OTP mới.',
      );
    }

    //4. OTP đúng thì tạo resetToken UUID
    const resetToken = randomUUID();

    //5 xoá OTP + lưu resetToken + reset attempts song song
    await Promise.all([
      this.redis.deleteResetOtp(email),
      this.redis.resetResetOtpAttempts(email),
      this.redis.setResetToken(resetToken, email, this.RESET_TOKEN_TTL),
    ]);

    return {
      message: 'Xác thực OTP thành công.',
      resetToken, // Frontend giữ token này để gọi reset-password
      expiresIn: this.RESET_TOKEN_TTL,
    };
  }

  //3. reset Password
  async resetPassword(dto: ResetPasswordDto, ipAddress: string) {
    const { resetToken, newPassword } = dto;

    //1 verify resetToken
    const email = await this.redis.getResetToken(resetToken);
    if (!email) {
      throw new BadRequestException(
        'Token đặt lại mật khẩu không hợp lệ hoặc đã hết hạn',
      );
    }

    //2 tìm user
    const user = await this.prisma.db.user.findUnique({
      where: { email },
      select: { id: true, password: true, status: true },
    });

    if (!user || user.status === UserStatus.BANNED) {
      throw new BadRequestException('Tài khoản không hợp lệ');
    }

    //3. kiểm tra pass mới có trùng pass cũ hong
    if (user.password) {
      const isSame = await bcrypt.compare(newPassword, user.password);
      if (isSame) {
        throw new BadRequestException(
          'Mật khẩu mới không được trùng mật khẩu cũ',
        );
      }
    }
    // 4. Hash password mới
    const hashedPassword = await bcrypt.hash(newPassword, this.BCRYPT_ROUNDS);

    //5 lấy tất cả session active để revoke
    const activeSessions = await this.prisma.db.session.findMany({
      where: { userId: user.id, revokedAt: null },
      select: { id: true, jti: true },
    });

    // 6. Cập nhật password + revoke tất cả sessions SONG SONG
    await Promise.all([
      this.prisma.db.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      }),
      // Revoke tất cả sessions trong DB
      this.prisma.db.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revokedReason: 'Password reset',
        },
      }),
      // Blacklist tất cả JTI trong Redis
      ...activeSessions.map((s) =>
        this.redis.revokeSession(s.jti, this.ACCESS_TTL),
      ),
      // Xóa resetToken
      this.redis.deleteResetToken(resetToken),
    ]);

    // 7. Log
    this.logAction({
      action: ActionType.UPDATE,
      entityName: 'User',
      entityId: user.id,
      newValues: { event: 'password_reset' },
      ipAddress,
    }).catch((err) => this.logger.error('ActionLog failed', err));

    return { message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.' };
  }
}
