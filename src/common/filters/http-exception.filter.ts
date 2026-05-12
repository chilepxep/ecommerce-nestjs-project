import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: 'Internal server error' };

    // Bóc tách chính xác message báo lỗi
    let errorMessage: string | string[] = 'Internal server error';
    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      errorMessage = (exceptionResponse as any).message || exceptionResponse;
    }

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message: errorMessage,
    };

    // ==========================================
    // KHU VỰC FORMAT LOG CHO TERMINAL ĐẸP MẮT
    // ==========================================

    // Nếu là mảng lỗi (Validation Pipe thường trả về mảng), ta map nó xuống dòng cho dễ đọc
    const formattedMessage = Array.isArray(errorMessage)
      ? `\n    - ` + errorMessage.join(`\n    - `)
      : errorMessage;

    const logPrefix = `[${request.method} ${request.url}] | Status: ${status}`;

    if (status >= 500) {
      // Lỗi Server: In màu Đỏ (error) kèm theo Stack Trace để debug
      const stack =
        exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(
        `${logPrefix} | Error: ${formattedMessage}`,
        stack,
        'ExceptionsFilter',
      );
    } else {
      // Lỗi Client/Nghiệp vụ (4xx): In màu Vàng (warn), KHÔNG cần Stack Trace làm rác Terminal
      this.logger.warn(
        `${logPrefix} | Error: ${formattedMessage}`,
        'ExceptionsFilter',
      );
    }

    response.status(status).json(errorResponse);
  }
}
