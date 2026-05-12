import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { PrismaService } from '@/prisma/prisma.service';
import { ActionType } from '@/generated/prisma/enums';
import { Prisma } from '@/generated/prisma/client';
import { IUser } from '@/common/interfaces/user.interface';

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);
  constructor(private prisma: PrismaService) {}
  //--Heper ----------
  private defaultSelect() {
    return {
      id: true,
      name: true,
      apiPath: true,
      method: true,
      module: true,
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
        entityName: 'Permission',
        entityId: data.entityId,
        adminId: data.adminId,
        oldValues: data.oldValues as Prisma.InputJsonValue,
        newValues: data.newValues as Prisma.InputJsonValue,
        ipAddress: data.ipAddress,
      },
    });
  }

  async create(
    createPermissionDto: CreatePermissionDto,
    user: IUser,
    ipAddress?: string,
  ) {
    //kiểm tra trùng apiPath + method
    const existing = await this.prisma.db.permission.findUnique({
      where: {
        apiPath_method: {
          apiPath: createPermissionDto.apiPath,
          method: createPermissionDto.method,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        `Permission [${createPermissionDto.method} ${createPermissionDto.apiPath}] đã tồn tại`,
      );
    }

    const permission = await this.prisma.db.permission.create({
      data: createPermissionDto,
      select: this.defaultSelect(),
    });

    this.logAction({
      action: ActionType.CREATE,
      entityId: permission.id,
      adminId: user.id,
      newValues: { ...createPermissionDto } as Record<string, unknown>,
      ipAddress,
    }).catch((err) => this.logger.error('ActionLog failed', err));

    return permission;
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    module?: string;
    method?: string;
    search?: string;
  }) {
    const { page = 1, limit = 20, module, method, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.PermissionWhereInput = {
      ...(module && { module }),
      ...(method && { method: method.toUpperCase() as any }),
      ...(search && {
        OR: [{ name: { contains: search } }, { apiPath: { contains: search } }],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.db.permission.findMany({
        where,
        select: this.defaultSelect(),
        orderBy: [{ module: 'asc' }, { apiPath: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.db.permission.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const permission = await this.prisma.db.permission.findUnique({
      where: { id },
      select: {
        ...this.defaultSelect(),
        //roles đang dùng permission này
        roles: {
          select: {
            role: { select: { id: true, code: true, name: true } },
            assignedAt: true,
          },
        },
      },
    });

    if (!permission) throw new NotFoundException('Permission không tồn tại');
    return permission;
  }

  async update(
    id: string,
    dto: UpdatePermissionDto,
    user: IUser,
    ipAddress?: string,
  ) {
    const existing = await this.prisma.db.permission.findUnique({
      where: { id },
      select: this.defaultSelect(),
    });
    if (!existing) throw new NotFoundException('Permission không tồn tại');

    // Check duplicate nếu đổi apiPath hoặc method
    if (dto.apiPath || dto.method) {
      const duplicate = await this.prisma.db.permission.findUnique({
        where: {
          apiPath_method: {
            apiPath: dto.apiPath ?? existing.apiPath,
            method: dto.method ?? existing.method,
          },
        },
      });
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(
          `Permission [${dto.method ?? existing.method} ${dto.apiPath ?? existing.apiPath}] đã tồn tại`,
        );
      }
    }

    const updated = await this.prisma.db.permission.update({
      where: { id },
      data: dto,
      select: this.defaultSelect(),
    });

    this.logAction({
      action: ActionType.UPDATE,
      entityId: id,
      adminId: user.id,
      oldValues: existing as Record<string, unknown>,
      newValues: dto as Record<string, unknown>,
      ipAddress,
    }).catch((err) => this.logger.error('ActionLog failed', err));

    return updated;
  }

  async remove(id: string, user: IUser, ipAddress?: string) {
    const existing = await this.prisma.db.permission.findUnique({
      where: { id },
      select: {
        ...this.defaultSelect(),
        roles: { select: { roleId: true } }, // Kiểm tra đang được dùng
      },
    });
    if (!existing) throw new NotFoundException('Permission không tồn tại');

    // Cảnh báo nếu đang được assign cho role (vẫn xóa, cascade tự xử lý)
    if (existing.roles.length > 0) {
      this.logger.warn(
        `Permission ${id} đang được dùng bởi ${existing.roles.length} role(s), tiến hành xóa cascade`,
      );
    }

    await this.prisma.db.permission.delete({ where: { id } });

    this.logAction({
      action: ActionType.DELETE,
      entityId: id,
      adminId: user.id,
      oldValues: existing as Record<string, unknown>,
      ipAddress,
    }).catch((err) => this.logger.error('ActionLog failed', err));

    return { message: 'Xóa permission thành công' };
  }
}
