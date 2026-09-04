import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

/** The single error shape every client-facing error is normalized to. */
export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string;
  details?: string[];
  timestamp: string;
  path: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body: ErrorResponseBody = {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Something went wrong',
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (exception instanceof HttpException) {
      body.statusCode = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        body.error = exception.name;
        body.message = res;
      } else {
        const { error, message } = res as { error?: string; message?: string | string[] };
        body.error = error ?? exception.name;
        if (Array.isArray(message)) {
          // ValidationPipe reports each failed rule as a separate message.
          body.message = 'Validation failed';
          body.details = message;
        } else {
          body.message = message ?? exception.message;
        }
      }
    } else {
      // Unexpected errors: log the full details, never leak them to the client.
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }

    response.status(body.statusCode).json(body);
  }
}
