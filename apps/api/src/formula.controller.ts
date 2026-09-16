import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { evaluateFormula, resolveBindings } from '@gtmai/shared';
import { JwtAuthGuard } from './common/jwt-auth.guard';

@Controller('formula')
@UseGuards(JwtAuthGuard)
export class FormulaController {
  @Post('preview')
  preview(@Body() body: object) {
    const input = z.object({ expression: z.string(), row: z.record(z.unknown()) }).parse(body);
    try {
      return { value: evaluateFormula(input.expression, input.row) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Formula error' };
    }
  }
}
