import { Injectable, NotImplementedException } from '@nestjs/common';
import type { SafeUser } from '../users/entities/index.js';
import { UsersService } from '../users/users.service.js';
import { AuthResponseDto, RefreshTokenDto, SignInDto, SignUpDto } from './dto/index.js';

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

  // Token issuance is added together with the JWT flow; until then sign-up only creates the account.
  signUp(signUpDto: SignUpDto): Promise<SafeUser> {
    return this.usersService.create(signUpDto);
  }

  signIn(_signInDto: SignInDto): AuthResponseDto {
    throw new NotImplementedException('Sign-in is not implemented yet');
  }

  refresh(_refreshTokenDto: RefreshTokenDto): AuthResponseDto {
    throw new NotImplementedException('Token refresh is not implemented yet');
  }

  logout(_refreshTokenDto: RefreshTokenDto): void {
    throw new NotImplementedException('Logout is not implemented yet');
  }
}
