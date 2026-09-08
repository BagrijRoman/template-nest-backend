import { NotImplementedException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import { RefreshTokensService } from './refreshTokens.service.js';
import { TokensService } from './tokens.service.js';

const USER = {
  id: '507f1f77bcf86cd799439011',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const TOKEN_PAIR = { accessToken: 'access.token.jwt', refreshToken: 'refresh.token.jwt' };

describe('AuthService', () => {
  let service: AuthService;

  const usersService = { create: vi.fn(), verifyPassword: vi.fn() };
  const tokensService = { issueTokenPair: vi.fn() };
  const refreshTokensService = { persist: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    tokensService.issueTokenPair.mockResolvedValue(TOKEN_PAIR);
    refreshTokensService.persist.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: TokensService, useValue: tokensService },
        { provide: RefreshTokensService, useValue: refreshTokensService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('signs up: creates the user, persists the refresh token, returns tokens with the user', async () => {
    usersService.create.mockResolvedValue(USER);

    const response = await service.signUp({
      email: USER.email,
      firstName: USER.firstName,
      lastName: USER.lastName,
      password: 'Secret123',
    });

    expect(response).toEqual({ ...TOKEN_PAIR, user: USER });
    expect(tokensService.issueTokenPair).toHaveBeenCalledWith(USER.id);
    expect(refreshTokensService.persist).toHaveBeenCalledWith(TOKEN_PAIR.refreshToken);
  });

  it('signs in with valid credentials and starts a session', async () => {
    usersService.verifyPassword.mockResolvedValue(USER);

    const response = await service.signIn({ email: USER.email, password: 'Secret123' });

    expect(response).toEqual({ ...TOKEN_PAIR, user: USER });
    expect(usersService.verifyPassword).toHaveBeenCalledWith(USER.email, 'Secret123');
    expect(refreshTokensService.persist).toHaveBeenCalledWith(TOKEN_PAIR.refreshToken);
  });

  it('rejects bad credentials with a generic 401 and issues no tokens', async () => {
    usersService.verifyPassword.mockResolvedValue(null);

    await expect(service.signIn({ email: USER.email, password: 'Wrong123' })).rejects.toThrow(
      new UnauthorizedException('Invalid email or password'),
    );
    expect(tokensService.issueTokenPair).not.toHaveBeenCalled();
    expect(refreshTokensService.persist).not.toHaveBeenCalled();
  });

  it('keeps refresh and logout scaffolded', () => {
    expect(() => service.refresh({ refreshToken: 'some.token' })).toThrow(NotImplementedException);
    expect(() => service.logout({ refreshToken: 'some.token' })).toThrow(NotImplementedException);
  });
});
