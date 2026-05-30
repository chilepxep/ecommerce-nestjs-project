// src/auth/strategies/google.strategy.ts
import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

export interface GoogleProfile {
  providerId: string;
  email: string;
  fullName: string;
  avatar: string | null;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(
    config: ConfigService,
    private authService: AuthService,
  ) {
    super({
      clientID: config.getOrThrow<string>('google.clientId')!,
      clientSecret: config.getOrThrow<string>('google.clientSecret')!,
      callbackURL: config.getOrThrow<string>('google.callbackUrl'),
      scope: ['email', 'profile'], // Chỉ xin email + tên, không xin quyền khác
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) {
    try {
      const email = profile.emails?.[0]?.value;
      if (!email) {
        return done(new Error('Không lấy được email từ Google'), undefined);
      }

      const googleProfile: GoogleProfile = {
        providerId: profile.id,
        email: email.toLowerCase(),
        fullName: profile.displayName ?? email.split('@')[0],
        avatar: profile.photos?.[0]?.value ?? null,
      };

      // Trả về profile, xử lý logic ở AuthService
      return done(null, googleProfile);
    } catch (error) {
      this.logger.error('Google strategy error:', error);
      return done(error, undefined);
    }
  }
}
