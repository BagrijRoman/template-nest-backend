import { Injectable, NotImplementedException } from '@nestjs/common';
import { AuthResponseDto, RefreshTokenDto, SignInDto, SignUpDto } from './dto/index.js';

@Injectable()
export class AuthService {
  signUp(_signUpDto: SignUpDto): AuthResponseDto {
    throw new NotImplementedException('Sign-up is not implemented yet');
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
