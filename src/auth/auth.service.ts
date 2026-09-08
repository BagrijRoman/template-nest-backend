import { Injectable, NotImplementedException, UnauthorizedException } from '@nestjs/common';
import type { SafeUser } from '../users/entities/index.js';
import { UsersService } from '../users/users.service.js';
import { AuthResponseDto, RefreshTokenDto, SignInDto, SignUpDto } from './dto/index.js';
import { RefreshTokensService } from './refreshTokens.service.js';
import { TokensService } from './tokens.service.js';

// One generic message for unknown email and wrong password — no account enumeration.
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tokensService: TokensService,
    private readonly refreshTokensService: RefreshTokensService,
  ) {}

  async signUp(signUpDto: SignUpDto): Promise<AuthResponseDto> {
    const user = await this.usersService.create(signUpDto);
    return this.issueSession(user);
  }

  async signIn(signInDto: SignInDto): Promise<AuthResponseDto> {
    const user = await this.usersService.verifyPassword(signInDto.email, signInDto.password);
    if (!user) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    return this.issueSession(user);
  }

  refresh(_refreshTokenDto: RefreshTokenDto): AuthResponseDto {
    throw new NotImplementedException('Token refresh is not implemented yet');
  }

  logout(_refreshTokenDto: RefreshTokenDto): void {
    throw new NotImplementedException('Logout is not implemented yet');
  }

  /** Issues a token pair and persists the refresh token so it can be redeemed (and revoked) later. */
  private async issueSession(user: SafeUser): Promise<AuthResponseDto> {
    const tokenPair = await this.tokensService.issueTokenPair(user.id);
    await this.refreshTokensService.persist(tokenPair.refreshToken);
    return { ...tokenPair, user };
  }
}
