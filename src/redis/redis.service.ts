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

  //------Session keys---------------------------
  private sessionKey(jti: string) {
    return `session:${jti}`;
  }

  private revokedKey(jti: string) {
    return `revoked:${jti}`;
  }

  private userSessionsKey(userId: string) {
    return `user:sessions:${userId}`;
  }

  // ─── Cache session info (tránh query DB mỗi request) ──────────
  async cacheSession(
    jti: string,
    data: {
      userId: string;
      tokenVersion: number;
      roleCode: string;
    },
    ttlSeconds: number,
  ): Promise<void> {
    await this.cache.set(
      this.sessionKey(jti),
      JSON.stringify(data),
      ttlSeconds * 1000,
    );
  }

  async getSession(jti: string): Promise<{
    userId: string;
    tokenVersion: number;
    roleCode: string;
  } | null> {
    const raw = await this.cache.get<string>(this.sessionKey(jti));
    return raw ? JSON.parse(raw) : null;
  }

  async deleteSession(jti: string): Promise<void> {
    await this.cache.del(this.sessionKey(jti));
  }

  // ─── Revoked token blacklist ───────────────────────────────────
  // Chỉ cần lưu đến khi accessToken hết hạn (15 phút)
  async revokeSession(jti: string, ttlSeconds = 900): Promise<void> {
    await Promise.all([
      this.cache.set(this.revokedKey(jti), true, ttlSeconds * 1000),
      this.deleteSession(jti),
    ]);
  }

  async isSessionRevoked(jti: string): Promise<boolean> {
    return (await this.cache.get<boolean>(this.revokedKey(jti))) ?? false;
  }

  // ─── Track user sessions (để hiển thị danh sách thiết bị) ──────
  async addUserSession(userId: string, jti: string): Promise<void> {
    const key = this.userSessionsKey(userId);
    const raw = await this.cache.get<string>(key);
    const sessions: string[] = raw ? JSON.parse(raw) : [];

    if (!sessions.includes(jti)) sessions.push(jti);

    // TTL 30 ngày — bằng refresh token max
    await this.cache.set(key, JSON.stringify(sessions), 30 * 24 * 3600 * 1000);
  }

  async removeUserSession(userId: string, jti: string): Promise<void> {
    const key = this.userSessionsKey(userId);
    const raw = await this.cache.get<string>(key);
    if (!raw) return;

    const sessions: string[] = JSON.parse(raw);
    const updated = sessions.filter((s) => s !== jti);
    await this.cache.set(key, JSON.stringify(updated), 30 * 24 * 3600 * 1000);
  }

  //Forgot Password
  private resetOtpKey(email: string) {
    return `otp:reset:${email}`;
  }

  private resetOtpAttemptKey(email: string) {
    return `otp:reset:attempts:${email}`;
  }

  private resetTokenKey(token: string) {
    return `reset:token:${token}`;
  }

  private resetOtpCooldownKey(email: string) {
    return `otp:reset:cooldown:${email}`;
  }

  //Reset OTP
  async setResetOtp(
    email: string,
    otp: string,
    ttlSeconds: 600,
  ): Promise<void> {
    await this.cache.set(this.resetOtpKey(email), otp, ttlSeconds * 1000);
  }

  async getResetOtp(email: string): Promise<string | null> {
    const otp = await this.cache.get<string>(this.resetOtpKey(email));
    return otp ?? null;
  }

  async deleteResetOtp(email: string): Promise<void> {
    await this.cache.del(this.resetOtpKey(email));
  }

  async incrementResetOtpAttempts(email: string): Promise<number> {
    const key = this.resetOtpAttemptKey(email);
    const current = (await this.cache.get<number>(key)) ?? 0;
    const next = current + 1;
    await this.cache.set(key, next, 15 * 60 * 1000);
    return next;
  }

  async resetResetOtpAttempts(email: string): Promise<void> {
    await this.cache.del(this.resetOtpAttemptKey(email));
  }

  async setResetOtpCooldown(email: string, ttlSeconds = 60): Promise<void> {
    await this.cache.set(
      this.resetOtpCooldownKey(email),
      '1',
      ttlSeconds * 1000,
    );
  }

  async getResetOtpCooldown(email: string): Promise<boolean> {
    try {
      const exists = await this.cache.get(this.resetOtpCooldownKey(email));
      return !!exists;
    } catch {
      return false;
    }
  }
  // ─── Reset Token (sau khi verify OTP thành công) ───────────────
  async setResetToken(
    token: string,
    email: string,
    ttlSeconds = 600,
  ): Promise<void> {
    await this.cache.set(this.resetTokenKey(token), email, ttlSeconds * 1000);
  }

  async getResetToken(token: string): Promise<string | null> {
    const resetToken = await this.cache.get<string>(this.resetTokenKey(token));
    return resetToken ?? null;
  }

  async deleteResetToken(token: string): Promise<void> {
    await this.cache.del(this.resetTokenKey(token));
  }

  ///-------------------------------------------
  // RBAC

  private rolePermissionsKey(roleCode: string) {
    return `rbac:role:${roleCode}`;
  }

  async cacheRolePermissions(
    roleCode: string,
    permissions: CachedPermission[],
    ttlSeconds = 300, // 5 phút
  ): Promise<void> {
    await this.cache.set(
      this.rolePermissionsKey(roleCode),
      JSON.stringify(permissions),
      ttlSeconds * 1000,
    );
  }

  async getRolePermissions(
    roleCode: string,
  ): Promise<CachedPermission[] | null> {
    try {
      const raw = await this.cache.get<string>(
        this.rolePermissionsKey(roleCode),
      );
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async invalidateRolePermissions(roleCode: string): Promise<void> {
    await this.cache.del(this.rolePermissionsKey(roleCode));
  }
}

export interface CachedPermission {
  apiPath: string;
  method: string;
}
