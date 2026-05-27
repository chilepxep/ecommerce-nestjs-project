import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RESPONSE_MESSAGE } from '../decorator/response-message.decorator';

// Mọi response đều có cấu trúc chuẩn
export interface StandardResponse<T> {
  statusCode: number;
  message: string;
  data: T;
  timestamp: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  StandardResponse<T>
> {
  constructor(private reflector: Reflector) {}
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<StandardResponse<T>> {
    const statusCode = context.switchToHttp().getResponse().statusCode;
    const message =
      this.reflector.get<string>(RESPONSE_MESSAGE, context.getHandler()) ||
      'Thành công';

    return next.handle().pipe(
      map((data) => ({
        statusCode,
        message: message || 'Success',
        data: data?.data !== undefined ? data.data : data,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
