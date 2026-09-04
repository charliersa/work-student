import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserRole } from '@ws/shared';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  studentNo: string | null;
  role: UserRole;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
