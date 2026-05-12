import { RoleCode } from '@/generated/prisma/enums';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({
    example: 'HR_MANAGER',
    description: 'Mã vai trò (sẽ tự động in hoa và thêm gạch dưới)',
  })
  @IsNotEmpty({ message: 'Mã role không được để trống' })
  @IsString({ message: 'Mã role phải là chuỗi' })
  @MaxLength(50, { message: 'Mã role không được vượt quá 50 ký tự' })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim().toUpperCase().replace(/\s+/g, '_');
    }
    return value;
  })
  code!: string;

  @ApiProperty({ example: 'Quản trị viên' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    type: [String],
    description: 'Danh sách Permission IDs',
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  permissionIds?: string[];
}

export class PermissionIdsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  permissionIds!: string[];
}
