import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Ip,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import type { IUser } from '@/common/interfaces/user.interface';
import { query } from 'winston';
import { PermissionsQueryDto } from './dto/query-permissions.dto';
import { CurrentUser } from '@/common/decorator/current-user.decorator';

@Controller('permissions')
@ApiBearerAuth('JWT')
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Post()
  @ApiOperation({ summary: 'Tạo permission mới' })
  create(
    @Body() dto: CreatePermissionDto,
    @Ip() ip: string,
    @CurrentUser() user: IUser,
    // TODO: sau khi có JWT → lấy adminId từ @CurrentUser()
    // Tạm thời hardcode để test
  ) {
    const adminId = 'system';
    return this.permissionsService.create(dto, user, ip);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Lấy chi tiết permission' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.permissionsService.findOne(id);
  }

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách permissions' })
  findAll(@Query() query: PermissionsQueryDto) {
    return this.permissionsService.findAll(query);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật permission' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePermissionDto,
    @Ip() ip: string,
    @CurrentUser() user: IUser,
  ) {
    return this.permissionsService.update(id, dto, user, ip);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xóa permission' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @CurrentUser() user: IUser,
  ) {
    return this.permissionsService.remove(id, user, ip);
  }
}
