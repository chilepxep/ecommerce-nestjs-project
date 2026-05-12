import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { PrismaService } from '@/prisma/prisma.service';
import { ActionType } from '@/generated/prisma/enums';
import { Prisma } from '@/generated/prisma/client';
import { IUser } from '@/common/interfaces/user.interface';

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(private prisma: PrismaService) {}

  private defaultSelect() {
    return {
      id: true,
      code: true,
      name: true,
      description: true,
      permissions: {
        select: {
          assignedAt: true,
          permission: {
            select: {
              id: true,
              name: true,
              apiPath: true,
              method: true,
              module: true,
            },
          },
        },
      },
    };
  }

  private async logAction(data: {
    action: ActionType;
    entityId: string;
    adminId: string;
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    ipAddress?: string;
  }) {
    return this.prisma.db.actionLog.create({
      data: {
        action: data.action,
        entityName: 'Role',
        entityId: data.entityId,
        adminId: data.adminId,
        oldValues: data.oldValues as Prisma.InputJsonValue,
        newValues: data.newValues as Prisma.InputJsonValue,
        ipAddress: data.ipAddress,
      },
    });
  }

  private async validatePermissionIds(permissionIds: string[]) {
    const found = await this.prisma.db.permission.findMany({
      where: { id: { in: permissionIds } },
      select: { id: true },
    });

    if (found.length !== permissionIds.length) {
      const foundIds = found.map((p) => p.id);
      const missing = permissionIds.filter((id) => !foundIds.includes(id));
      throw new BadRequestException(
        `Các permission không tồn tại: ${missing.join(', ')}`,
      );
    }
  }

  async create(dto: CreateRoleDto, user: IUser, ipAddress?: string) {
    const { permissionIds = [], ...roleData } = dto;

    // Check duplicate code
    const existing = await this.prisma.db.role.findUnique({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException(`Role [${dto.code}] đã tồn tại`);
    }

    // Validate permissionIds tồn tại
    if (permissionIds.length > 0) {
      await this.validatePermissionIds(permissionIds);
    }

    const role = await this.prisma.db.role.create({
      data: {
        ...roleData,
        isSystem: false,
        permissions: {
          create: permissionIds.map((permissionId) => ({ permissionId })),
        },
      },
      select: this.defaultSelect(),
    });

    this.logAction({
      action: ActionType.CREATE,
      entityId: String(role.id),
      adminId: user.id,
      newValues: { ...roleData, permissionIds },
      ipAddress,
    }).catch((err) => this.logger.error('ActionLog failed', err));

    return role;
  }

  async findAll() {
    return this.prisma.db.role.findMany({
      select: this.defaultSelect(),
      orderBy: { id: 'asc' },
    });
  }

  async findOne(id: number) {
    const role = await this.prisma.db.role.findUnique({
      where: { id },
      select: {
        ...this.defaultSelect(),
        users: {
          select: { id: true, email: true, fullName: true },
          take: 10, // Preview 10 users đầu
        },
      },
    });
    if (!role) throw new NotFoundException('Role không tồn tại');
    return role;
  }

  async update(
    id: number,
    dto: UpdateRoleDto,
    user: IUser,
    ipAddress?: string,
  ) {
    const existing = await this.prisma.db.role.findUnique({
      where: { id },
      select: {
        ...this.defaultSelect(),
        permissions: { select: { permissionId: true } },
      },
    });
    if (!existing) throw new NotFoundException('Role không tồn tại');

    const { permissionIds, ...roleData } = dto;

    // Validate permissionIds mới nếu có
    if (permissionIds) {
      await this.validatePermissionIds(permissionIds);
    }

    const role = await this.prisma.db.role.update({
      where: { id },
      data: {
        ...roleData,
        // Nếu có truyền permissionIds → sync lại toàn bộ
        ...(permissionIds !== undefined && {
          permissions: {
            deleteMany: {}, // Xóa hết permissions cũ
            create: permissionIds.map((permissionId) => ({ permissionId })),
          },
        }),
      },
      select: this.defaultSelect(),
    });

    this.logAction({
      action: ActionType.UPDATE,
      entityId: String(id),
      adminId: user.id,
      oldValues: {
        ...existing,
        permissionIds: existing.permissions.map((p) => p.permissionId),
      } as Record<string, unknown>,
      newValues: dto as Record<string, unknown>,
      ipAddress,
    }).catch((err) => this.logger.error('ActionLog failed', err));

    return role;
  }

  async remove(id: number, user: IUser, ipAddress?: string) {
    const existing = await this.prisma.db.role.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        _count: { select: { users: true } },
      },
    });
    if (!existing) throw new NotFoundException('Role không tồn tại');

    // Không cho xóa nếu còn user đang dùng
    if (existing._count.users > 0) {
      throw new BadRequestException(
        `Không thể xóa role đang được dùng bởi ${existing._count.users} người dùng`,
      );
    }

    await this.prisma.db.role.delete({ where: { id } });

    this.logAction({
      action: ActionType.DELETE,
      entityId: String(id),
      adminId: user.id,
      oldValues: existing as Record<string, unknown>,
      ipAddress,
    }).catch((err) => this.logger.error('ActionLog failed', err));

    return { message: 'Xóa role thành công' };
  }

  //thêm quyền
  async assignPermissions(
    roleId: number,
    permissionIds: string[],
    user: IUser,
    ipAddress?: string,
  ) {
    const role = await this.prisma.db.role.findUnique({
      where: { id: roleId },
    });
    if (!role) throw new NotFoundException('Role không tồn tại');

    await this.validatePermissionIds(permissionIds);

    // 1. CHỤP TRẠNG THÁI CŨ (Lấy danh sách các Permission ID hiện tại)
    const existingRoles = await this.prisma.db.rolePermission.findMany({
      where: { roleId },
      select: { permissionId: true },
    });
    const oldPermissionIds = existingRoles.map((rp) => rp.permissionId);

    // 2. THỰC HIỆN THÊM MỚI
    await this.prisma.db.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
      skipDuplicates: true, // Bỏ qua nếu đã tồn tại
    });

    // 3. TÍNH TOÁN TRẠNG THÁI MỚI (Dùng Set để gộp mảng cũ và mảng mới, tự động loại bỏ trùng lặp)
    const newPermissionIds = Array.from(
      new Set([...oldPermissionIds, ...permissionIds]),
    );

    // 4. GHI LOG
    this.logAction({
      action: ActionType.UPDATE,
      entityId: String(roleId),
      adminId: user.id,
      // Lưu toàn bộ danh sách cũ
      oldValues: { permissions: oldPermissionIds },
      // Lưu toàn bộ danh sách mới + Delta (những cái vừa được thêm) để dễ nhìn
      newValues: {
        permissions: newPermissionIds,
        deltaAdded: permissionIds,
      },
      ipAddress,
    }).catch((err) => this.logger.error('ActionLog failed', err));

    return this.findOne(roleId);
  }

  //xoá quyền
  async revokePermissions(
    roleId: number,
    permissionIds: string[],
    user: IUser,
    ipAddress?: string,
  ) {
    const role = await this.prisma.db.role.findUnique({
      where: { id: roleId },
    });
    if (!role) throw new NotFoundException('Role không tồn tại');

    // 1. CHỤP TRẠNG THÁI CŨ
    const existingRoles = await this.prisma.db.rolePermission.findMany({
      where: { roleId },
      select: { permissionId: true },
    });
    const oldPermissionIds = existingRoles.map((rp) => rp.permissionId);

    // 2. THỰC HIỆN XÓA
    await this.prisma.db.rolePermission.deleteMany({
      where: {
        roleId,
        permissionId: { in: permissionIds },
      },
    });

    // 3. TÍNH TOÁN TRẠNG THÁI MỚI (Lấy mảng cũ LỌC BỎ đi những ID nằm trong mảng bị xóa)
    const newPermissionIds = oldPermissionIds.filter(
      (id) => !permissionIds.includes(id),
    );

    // 4. GHI LOG
    this.logAction({
      action: ActionType.UPDATE,
      entityId: String(roleId),
      adminId: user.id,
      // Lưu toàn bộ danh sách cũ
      oldValues: { permissions: oldPermissionIds },
      // Lưu toàn bộ danh sách mới + Delta (những cái vừa bị xóa)
      newValues: {
        permissions: newPermissionIds,
        deltaRevoked: permissionIds,
      },
      ipAddress,
    }).catch((err) => this.logger.error('ActionLog failed', err));

    return this.findOne(roleId);
  }
}
