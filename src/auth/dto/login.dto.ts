import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty({ message: 'Không được để trống email' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email!: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString()
  @MinLength(1)
  @IsNotEmpty({ message: 'Không được để trống password' })
  password!: string;

  @ApiProperty({ example: 'Chrome on Windows', required: false })
  @IsOptional()
  @IsString()
  deviceName?: string;
}
