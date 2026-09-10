import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { BreachedPasswordsService } from './breachedPasswords.service.js';
import { CreateUserDto } from './dto/index.js';
import { SafeUser, User } from './entities/index.js';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPasswordHash } from './password.util.js';

const BREACHED_PASSWORD_MESSAGE = 'This password has appeared in a known data breach — please choose a different one';

const MONGO_DUPLICATE_KEY_ERROR_CODE = 11000;

type LeanUser = User & { _id: Types.ObjectId };

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === MONGO_DUPLICATE_KEY_ERROR_CODE;

const duplicateEmailException = (email: string): ConflictException =>
  new ConflictException(`User with email "${email}" already exists`);

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly breachedPasswordsService: BreachedPasswordsService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<SafeUser> {
    // Fast application-level check; the unique index stays the race-safe guard (its violation is translated below).
    if (await this.userModel.exists({ email: createUserDto.email })) {
      throw duplicateEmailException(createUserDto.email);
    }

    if (await this.breachedPasswordsService.isBreached(createUserDto.password)) {
      this.securityEvents.record(SecurityEvent.BreachedPasswordRejected, { email: createUserDto.email });
      throw new BadRequestException(BREACHED_PASSWORD_MESSAGE);
    }

    try {
      const created = await this.userModel.create({
        email: createUserDto.email,
        firstName: createUserDto.firstName,
        lastName: createUserDto.lastName,
        passwordHash: await hashPassword(createUserDto.password),
      });
      return this.toSafeUser(created.toObject());
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw duplicateEmailException(createUserDto.email);
      }
      throw error;
    }
  }

  async findById(id: string): Promise<SafeUser | null> {
    // An invalid ObjectId would make Mongoose throw a CastError — treat it as "not found" instead.
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    const user = await this.userModel.findById(id).lean();
    return user ? this.toSafeUser(user) : null;
  }

  async findByEmail(email: string): Promise<SafeUser | null> {
    const user = await this.userModel.findOne({ email }).lean();
    return user ? this.toSafeUser(user) : null;
  }

  /** Checks credentials without ever exposing the stored hash. Returns the user on success. */
  async verifyPassword(email: string, password: string): Promise<SafeUser | null> {
    const user = await this.userModel.findOne({ email }).lean();
    // An unknown email pays the same scrypt cost as a wrong password — response timing must not
    // reveal whether an account exists.
    const isValid = await verifyPasswordHash(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    return user && isValid ? this.toSafeUser(user) : null;
  }

  /**
   * Verifies the current password and replaces the hash. Returns the user, or null when the
   * account is gone or the current password is wrong — indistinguishable on purpose.
   */
  async updatePassword(id: string, currentPassword: string, newPassword: string): Promise<SafeUser | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    const user = await this.userModel.findById(id).lean();
    if (!user || !(await verifyPasswordHash(currentPassword, user.passwordHash))) {
      return null;
    }

    return this.replacePassword(id, newPassword);
  }

  /**
   * Sets a new password WITHOUT any proof of the current one — only for flows that established
   * ownership another way (change-password verifies the current password first; the reset flow
   * proves control of the email). Never expose this through a controller directly.
   */
  async replacePassword(id: string, newPassword: string): Promise<SafeUser | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }

    if (await this.breachedPasswordsService.isBreached(newPassword)) {
      this.securityEvents.record(SecurityEvent.BreachedPasswordRejected, { userId: id });
      throw new BadRequestException(BREACHED_PASSWORD_MESSAGE);
    }

    const updated = await this.userModel
      .findByIdAndUpdate(id, { passwordHash: await hashPassword(newPassword) }, { new: true })
      .lean();
    return updated ? this.toSafeUser(updated) : null;
  }

  async markEmailVerified(id: string): Promise<SafeUser | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    const updated = await this.userModel.findByIdAndUpdate(id, { emailVerified: true }, { new: true }).lean();
    return updated ? this.toSafeUser(updated) : null;
  }

  private toSafeUser(user: LeanUser): SafeUser {
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
