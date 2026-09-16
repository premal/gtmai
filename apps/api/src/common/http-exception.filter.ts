import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { ZodError } from 'zod';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).send(exception.getResponse());
      return;
    }
    if (exception instanceof ZodError) {
      response.status(HttpStatus.BAD_REQUEST).send({
        statusCode: HttpStatus.BAD_REQUEST,
        message: exception.issues
          .map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`)
          .join('; '),
      });
      return;
    }
    const message = exception instanceof Error ? exception.message : 'Internal server error';
    const status = /not found/i.test(message) ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST;
    response.status(status).send({ statusCode: status, message });
  }
}
