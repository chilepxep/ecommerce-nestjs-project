import { HttpMethod } from '@/generated/prisma/enums';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePermissionDto {
  @ApiProperty({ example: 'xem danh sách người dùng' })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  @Transform(({ value }) => value?.trim())
  name!: string;

  @ApiProperty({ example: '/api/v1/users' })
  @IsString()
  @Transform(({ value }) => value?.trim().toLowerCase())
  apiPath!: string;

  @ApiProperty({ enum: HttpMethod })
  @IsEnum(HttpMethod)
  method!: HttpMethod;

  @ApiProperty({ example: 'USER' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(({ value }) => value?.trim().toUpperCase())
  module!: string;
}
