import { PartialType } from '@nestjs/swagger';
import { CreateAuthDto } from './register.dto';

export class UpdateAuthDto extends PartialType(CreateAuthDto) {}
