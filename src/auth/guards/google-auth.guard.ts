import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  // Redirect sang Google — không throw exception
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
