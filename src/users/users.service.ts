import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CreateUserDto, UpdateUserDto } from './dto/index.js';
import { SafeUser, User } from './entities/index.js';
import { hashPassword, verifyPasswordHash } from './password.util.js';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  // In-memory storage; swap for a real database repository later.
  private readonly users = new Map<string, User>();

  create(createUserDto: CreateUserDto): SafeUser {
    if (this.findEntityByEmail(createUserDto.email)) {
      throw new ConflictException(`User with email "${createUserDto.email}" already exists`);
    }

    const now = new Date();
    const user: User = {
      id: randomUUID(),
      email: createUserDto.email,
      name: createUserDto.name,
      passwordHash: hashPassword(createUserDto.password),
      createdAt: now,
      updatedAt: now,
    };

    this.users.set(user.id, user);
    this.logger.log(`User created: ${user.id}`);
    return this.toSafeUser(user);
  }

  findAll(): SafeUser[] {
    return [...this.users.values()].map((user) => this.toSafeUser(user));
  }

  findOne(id: string): SafeUser {
    return this.toSafeUser(this.findEntity(id));
  }

  findByEmail(email: string): SafeUser | undefined {
    const user = this.findEntityByEmail(email);
    return user && this.toSafeUser(user);
  }

  /** Checks credentials without ever exposing the stored hash. Returns the user on success. */
  verifyPassword(email: string, password: string): SafeUser | null {
    const user = this.findEntityByEmail(email);
    if (!user || !verifyPasswordHash(password, user.passwordHash)) {
      return null;
    }
    return this.toSafeUser(user);
  }

  update(id: string, updateUserDto: UpdateUserDto): SafeUser {
    const user = this.findEntity(id);

    if (updateUserDto.email && updateUserDto.email !== user.email && this.findEntityByEmail(updateUserDto.email)) {
      throw new ConflictException(`User with email "${updateUserDto.email}" already exists`);
    }

    const { password, ...fields } = updateUserDto;
    const updated: User = {
      ...user,
      ...fields,
      ...(password ? { passwordHash: hashPassword(password) } : {}),
      updatedAt: new Date(),
    };

    this.users.set(id, updated);
    return this.toSafeUser(updated);
  }

  remove(id: string): void {
    this.findEntity(id);
    this.users.delete(id);
  }

  private findEntity(id: string): User {
    const user = this.users.get(id);
    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }
    return user;
  }

  private findEntityByEmail(email: string): User | undefined {
    return [...this.users.values()].find((user) => user.email === email);
  }

  private toSafeUser(user: User): SafeUser {
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
  }
}
