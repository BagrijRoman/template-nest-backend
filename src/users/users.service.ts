import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException, ErrorCode } from '../common/errors/index.js';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CredentialsService } from './credentials.service.js';
import { CreateUserDto } from './dto/index.js';
import { User, UserProfile } from './entities/index.js';

const MONGO_DUPLICATE_KEY_ERROR_CODE = 11000;

type LeanUser = User & { _id: Types.ObjectId };

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === MONGO_DUPLICATE_KEY_ERROR_CODE;

const duplicateEmailException = (email: string): AppException =>
  AppException.forField(
    HttpStatus.CONFLICT,
    ErrorCode.EmailTaken,
    'email',
    'unique',
    `User with email "${email}" already exists`,
  );

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly credentialsService: CredentialsService,
  ) {}

  /** Creates the account and its password credential; every check runs before the first write. */
  async create(createUserDto: CreateUserDto): Promise<UserProfile> {
    // Fast application-level check; the unique index stays the race-safe guard (its violation is translated below).
    if (await this.userModel.exists({ email: createUserDto.email })) {
      throw duplicateEmailException(createUserDto.email);
    }
    await this.credentialsService.assertNotBreached(createUserDto.password, 'password', { email: createUserDto.email });

    const user = await this.insert(createUserDto);
    // Two documents and no transaction (a standalone MongoDB has none): undo the user when the
    // credential insert fails, so no account is ever left without a way to sign in.
    try {
      await this.credentialsService.createPassword(user.id, createUserDto.password);
    } catch (error) {
      await this.userModel.deleteOne({ _id: user.id });
      throw error;
    }
    return user;
  }

  async findById(id: string): Promise<UserProfile | null> {
    // An invalid ObjectId would make Mongoose throw a CastError — treat it as "not found" instead.
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    const user = await this.userModel.findById(id).lean();
    return user ? this.toUserProfile(user) : null;
  }

  async findByEmail(email: string): Promise<UserProfile | null> {
    const user = await this.userModel.findOne({ email }).lean();
    return user ? this.toUserProfile(user) : null;
  }

  async markEmailVerified(id: string): Promise<UserProfile | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    const updated = await this.userModel.findByIdAndUpdate(id, { emailVerified: true }, { new: true }).lean();
    return updated ? this.toUserProfile(updated) : null;
  }

  private async insert({ email, firstName, lastName }: CreateUserDto): Promise<UserProfile> {
    try {
      const created = await this.userModel.create({ email, firstName, lastName });
      return this.toUserProfile(created.toObject());
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw duplicateEmailException(email);
      }
      throw error;
    }
  }

  private toUserProfile(user: LeanUser): UserProfile {
    return {
      id: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      // Pre-flag documents lack the field; they are unverified by definition.
      emailVerified: user.emailVerified ?? false,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
