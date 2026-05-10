// src/redis/redis.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

@Injectable()
export class RedisService {
  constructor(@Inject(CACHE_MANAGER) private cache: Cache) {}

  // ─── OTP Keys ─────────────────────────────────────────────
  private otpKey(email: string) {
    return `otp:register:${email}`;
  }

  private otpAttemptKey(email: string) {
    return `otp:attempts:${email}`;
  }

  private emailExistsKey(email: string) {
    return `email:exists:${email}`;
  }

  // ─── OTP Operations ───────────────────────────────────────
  async setOtp(email: string, otp: string, ttlSeconds = 300): Promise<void> {
    await this.cache.set(this.otpKey(email), otp, ttlSeconds * 1000);
  }

  async getOtp(email: string): Promise<string | null> {
    return (await this.cache.get<string>(this.otpKey(email))) ?? null;
  }
  async deleteOtp(email: string): Promise<void> {
    await this.cache.del(this.otpKey(email));
  }

  // ─── Brute-force protection ───────────────────────────────
  async incrementOtpAttempts(email: string): Promise<number> {
    const key = this.otpAttemptKey(email);
    const current = (await this.cache.get<number>(key)) ?? 0;
    const next = current + 1;
    // Reset attempts sau 15 phút
    await this.cache.set(key, next, 15 * 60 * 1000);
    return next;
  }

  async getOtpAttempts(email: string): Promise<number> {
    return (await this.cache.get<number>(this.otpAttemptKey(email))) ?? 0;
  }

  async resetOtpAttempts(email: string): Promise<void> {
    await this.cache.del(this.otpAttemptKey(email));
  }

  // ─── Email exists cache (tránh query DB liên tục) ─────────
  async cacheEmailExists(email: string): Promise<void> {
    // Cache 10 phút: email này đã tồn tại trong DB
    await this.cache.set(this.emailExistsKey(email), true, 10 * 60 * 1000);
  }

  async isEmailCached(email: string): Promise<boolean> {
    return (await this.cache.get<boolean>(this.emailExistsKey(email))) ?? false;
  }

  async invalidateEmailCache(email: string): Promise<void> {
    await this.cache.del(this.emailExistsKey(email));
  }
}
