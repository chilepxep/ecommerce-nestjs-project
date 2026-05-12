import { HttpMethod } from '@/generated/prisma/enums';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PermissionsQueryDto {
  @ApiPropertyOptional({
    description: 'Số trang hiện tại (mặc định: 1)',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number) // Bắt buộc ép kiểu từ String URL sang Number
  @IsInt({ message: 'Page phải là số nguyên' })
  @Min(1, { message: 'Page không được nhỏ hơn 1' })
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Số lượng bản ghi trên một trang (mặc định: 20)',
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Limit phải là số nguyên' })
  @Min(1, { message: 'Limit không được nhỏ hơn 1' })
  @Max(100, { message: 'Limit tối đa là 100 để tránh sập RAM' })
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Lọc theo tên Module' })
  @IsOptional()
  @IsString()
  module?: string;

  @ApiPropertyOptional({
    description: 'Lọc theo phương thức HTTP',
    enum: HttpMethod,
  })
  @IsOptional()
  @Transform(({ value }) => value?.toUpperCase())
  @IsEnum(HttpMethod, {
    message: 'Method phải thuộc GET, POST, PUT, PATCH, DELETE',
  })
  method?: HttpMethod;

  @ApiPropertyOptional({ description: 'Từ khóa tìm kiếm (tên hoặc đường dẫn)' })
  @IsOptional()
  @IsString()
  search?: string;
}
