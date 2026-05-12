import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Ip,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Put,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto, PermissionIdsDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IUser } from '@/common/interfaces/user.interface';

@Controller('roles')
@ApiBearerAuth('JWT')
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @ApiOperation({ summary: 'Tạo role mới' })
  create(@Body() dto: CreateRoleDto, @Ip() ip: string) {
    const currentUser: IUser = {
      id: '4ec92eab-4dd8-11f1-9d78-088fc30ad3d5',
      email: 'admin@example.com',
      role: {
        id: 1,
        name: 'Administrator',
      },
    };
    return this.rolesService.create(dto, currentUser, ip);
  }

  @Get()
  @ApiOperation({ summary: 'Lấy tất cả roles' })
  findAll() {
    return this.rolesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Lấy chi tiết role' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.rolesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật role' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoleDto,
    @Ip() ip: string,
  ) {
    const currentUser: IUser = {
      id: '4ec92eab-4dd8-11f1-9d78-088fc30ad3d5',
      email: 'admin@example.com',
      role: {
        id: 1,
        name: 'Administrator',
      },
    };
    return this.rolesService.update(id, dto, currentUser, ip);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xóa role' })
  remove(@Param('id', ParseIntPipe) id: number, @Ip() ip: string) {
    const currentUser: IUser = {
      id: '4ec92eab-4dd8-11f1-9d78-088fc30ad3d5',
      email: 'admin@example.com',
      role: {
        id: 1,
        name: 'Administrator',
      },
    };
    return this.rolesService.remove(id, currentUser, ip);
  }

  @Put(':id/permissions')
  @ApiOperation({ summary: 'Thêm permissions vào role' })
  assignPermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PermissionIdsDto,
    @Ip() ip: string,
  ) {
    const currentUser: IUser = {
      id: '4ec92eab-4dd8-11f1-9d78-088fc30ad3d5',
      email: 'admin@example.com',
      role: {
        id: 1,
        name: 'Administrator',
      },
    };
    return this.rolesService.assignPermissions(
      id,
      dto.permissionIds,
      currentUser,
      ip,
    );
  }

  @Delete(':id/permissions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gỡ permissions khỏi role' })
  revokePermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PermissionIdsDto,
    @Ip() ip: string,
  ) {
    const currentUser: IUser = {
      id: '4ec92eab-4dd8-11f1-9d78-088fc30ad3d5',
      email: 'admin@example.com',
      role: {
        id: 1,
        name: 'Administrator',
      },
    };
    return this.rolesService.revokePermissions(
      id,
      dto.permissionIds,
      currentUser,
      ip,
    );
  }
}
