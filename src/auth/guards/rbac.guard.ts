import { IS_PUBLIC_KEY } from '@/common/decorator/public.decorator';
import { SKIP_RBAC_KEY } from '@/common/decorator/skip-rbac.decorator';
import { RoleCode } from '@/generated/prisma/enums';
import { PrismaService } from '@/prisma/prisma.service';
import { CachedPermission, RedisService } from '@/redis/redis.service';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

@Injectable()
export class RbacGuard implements CanActivate {
  private readonly logger = new Logger(RbacGuard.name);

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    //1 Bỏ qua nếu là @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    //2 bỏ qua nếu là @SkipRbac()
    const skipRbac = this.reflector.getAllAndOverride<boolean>(SKIP_RBAC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipRbac) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as { id: string; roleCode: string };

    if (!user?.roleCode) {
      throw new ForbiddenException('Không có thông tin phân quyền');
    }

    //SUPER_ADMIN bypass hoàn toàn
    if (user.roleCode === RoleCode.SUPER_ADMIN) return true;

    //Lấy method + path chuẩn hóa
    const method = request.method.toUpperCase();
    const path = this.normalizePath(request.route?.path ?? request.path);

    // 5. Lấy permissions (Redis → DB)
    const permissions = await this.getPermissions(user.roleCode);

    // 6. Kiểm tra quyền
    const hasPermission = permissions.some(
      (p) => p.method === method && this.matchPath(p.apiPath, path),
    );

    if (!hasPermission) {
      this.logger.warn(
        `Từ chối [${user.roleCode}] truy cập [${method} ${path}]`,
      );
      throw new ForbiddenException(
        'Bạn không có quyền thực hiện hành động này',
      );
    }

    return true;
  }

  private normalizePath(path: string): string {
    return path
      .replace(/\/[0-9a-f-]{36}/gi, '/:id') // UUID
      .replace(/\/\d+/g, '/:id') // Số nguyên
      .toLowerCase();
  }

  //lấy permission: Redis => DB
  private async getPermissions(roleCode: string): Promise<CachedPermission[]> {
    //lấy redis trước
    const cached = await this.redis.getRolePermissions(roleCode);
    if (cached) return cached;

    //cache miss => query db
    const role = await this.prisma.db.role.findUnique({
      where: { code: roleCode as RoleCode },
      select: {
        permissions: {
          select: {
            permission: {
              select: { apiPath: true, method: true },
            },
          },
        },
      },
    });

    const permissions: CachedPermission[] =
      role?.permissions.map((rp) => ({
        apiPath: rp.permission.apiPath,
        method: rp.permission.method,
      })) ?? [];

    // Lưu vào Redis
    await this.redis.cacheRolePermissions(roleCode, permissions);

    return permissions;
  }

  //so sánh khớp path
  private matchPath(permissionPath: string, requestPath: string): boolean {
    //so sánh exact match trước
    if (
      permissionPath.toLocaleLowerCase() === requestPath.toLocaleLowerCase()
    ) {
      return true;
    }

    // Pattern match: /api/v1/users/:id khớp /api/v1/users/123
    const permParts = permissionPath.toLowerCase().split('/');
    const reqParts = requestPath.toLowerCase().split('/');

    if (permParts.length !== reqParts.length) return false;

    return permParts.every(
      (part, i) => part.startsWith(':') || part === reqParts[i],
    );
  }
}
