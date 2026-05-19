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
import type { IUser } from '@/common/interfaces/user.interface';
import { CurrentUser } from '@/common/decorator/current-user.decorator';

@Controller('roles')
@ApiBearerAuth('JWT')
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @ApiOperation({ summary: 'Tạo role mới' })
  create(
    @Body() dto: CreateRoleDto,
    @Ip() ip: string,
    @CurrentUser() user: IUser,
  ) {
    return this.rolesService.create(dto, user, ip);
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
    @CurrentUser() user: IUser,
  ) {
    return this.rolesService.update(id, dto, user, ip);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xóa role' })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Ip() ip: string,
    @CurrentUser() user: IUser,
  ) {
    return this.rolesService.remove(id, user, ip);
  }

  @Put(':id/permissions')
  @ApiOperation({ summary: 'Thêm permissions vào role' })
  assignPermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PermissionIdsDto,
    @Ip() ip: string,
    @CurrentUser() user: IUser,
  ) {
    return this.rolesService.assignPermissions(id, dto.permissionIds, user, ip);
  }

  @Delete(':id/permissions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gỡ permissions khỏi role' })
  revokePermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PermissionIdsDto,
    @Ip() ip: string,
    @CurrentUser() user: IUser,
  ) {
    return this.rolesService.revokePermissions(id, dto.permissionIds, user, ip);
  }
}
