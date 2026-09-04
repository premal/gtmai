import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { z } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== 'body' || !value || typeof value !== 'object') return value;
    return z.record(z.unknown()).parse(value);
  }
}
