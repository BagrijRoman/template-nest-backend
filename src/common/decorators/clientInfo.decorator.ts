import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { ClientInfo } from '../../auth/sessions.service.js';

// Long enough for any real User-Agent, short enough that a crafted header cannot bloat the store.
const USER_AGENT_MAX_LENGTH = 256;

/**
 * What the request says about the device behind it, for the session it opens. The address comes from
 * Express, so it honours `TRUST_PROXY`; the User-Agent is whatever the client chose to send.
 */
export const Client = createParamDecorator((_data: unknown, context: ExecutionContext): ClientInfo => {
  const request = context.switchToHttp().getRequest<Request>();
  return {
    userAgent: request.headers['user-agent']?.slice(0, USER_AGENT_MAX_LENGTH),
    ip: request.ip,
  };
});
