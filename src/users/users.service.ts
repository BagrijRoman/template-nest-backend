import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateUserDto } from './dto/index.js';
import { SafeUser, User } from './entities/index.js';
import { hashPassword, verifyPasswordHash } from './password.util.js';

const MONGO_DUPLICATE_KEY_ERROR_CODE = 11000;

type LeanUser = User & { _id: Types.ObjectId };

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === MONGO_DUPLICATE_KEY_ERROR_CODE;

const duplicateEmailException = (email: string): ConflictException =>
  new ConflictException(`User with email "${email}" already exists`);

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(@InjectModel(User.name) private readonly userModel: Model<User>) {}

  async create(createUserDto: CreateUserDto): Promise<SafeUser> {
    // Fast application-level check; the unique index stays the race-safe guard (its violation is translated below).
    if (await this.userModel.exists({ email: createUserDto.email })) {
      throw duplicateEmailException(createUserDto.email);
    }

    try {
      const created = await this.userModel.create({
        email: createUserDto.email,
        firstName: createUserDto.firstName,
        lastName: createUserDto.lastName,
        passwordHash: await hashPassword(createUserDto.password),
      });
      this.logger.log(`User created: ${created.id}`);
      return this.toSafeUser(created.toObject());
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw duplicateEmailException(createUserDto.email);
      }
      throw error;
    }
  }

  /** Checks credentials without ever exposing the stored hash. Returns the user on success. */
  async verifyPassword(email: string, password: string): Promise<SafeUser | null> {
    const user = await this.userModel.findOne({ email }).lean();
    if (!user || !(await verifyPasswordHash(password, user.passwordHash))) {
      return null;
    }
    return this.toSafeUser(user);
  }

  private toSafeUser(user: LeanUser): SafeUser {
    return {
      id: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
