import { IUser } from '@/common/interfaces/user.interface';
import { RedisService } from '@/redis/redis.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private redis: RedisService,
  ) {
    super({
      //đọc token từ httpOnly cookie
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req) => req?.cookies?.['access_token'],
        // Fallback: Bearer token (cho Swagger test)
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      ignoreExpiration: false,
    });
  }

  async validate(payload: IUser) {
    const isRevoked = await this.redis.isSessionRevoked(payload.jti);
    if (isRevoked) {
      throw new UnauthorizedException('Phiên đăng nhập đã bị thu hồi');
    }
    return payload; // Gắn vào request.user
  }
}
