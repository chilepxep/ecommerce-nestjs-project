import { IS_PUBLIC_KEY } from '@/common/decorator/public.decorator';
import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }
  canActivate(context: ExecutionContext) {
    //Nếu có public thì bỏ qua auth
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    return super.canActivate(context);
  }
  handleRequest(err: any, user: any) {
    if (err || !user) {
      throw new UnauthorizedException('Vui lòng đăng nhập để tiếp tục');
    }
    return user;
  }
}
