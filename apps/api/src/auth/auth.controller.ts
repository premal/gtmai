import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).optional(),
});

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Post('register')
  register(@Body() body: unknown) {
    const input = credentials.extend({ name: z.string().min(1) }).parse(body);
    return this.auth.register(input.email, input.password, input.name);
  }

  @Post('login')
  login(@Body() body: unknown) {
    const input = credentials.omit({ name: true }).parse(body);
    return this.auth.login(input.email, input.password);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() request: FastifyRequest & { user: AuthUser }) {
    return this.prisma.user.findUnique({
      where: { id: request.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        memberships: { include: { workspace: true } },
      },
    });
  }
}
