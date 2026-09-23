import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** The device session the access token belongs to, as attached by JwtAuthGuard. */
export const CurrentSessionId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    context.switchToHttp().getRequest<{ sessionId: string }>().sessionId,
);
