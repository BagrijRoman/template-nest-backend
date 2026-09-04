import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { User } from './entities/user.entity.js';

@Injectable()
export class UsersService {
  // In-memory storage; swap for a real database repository later.
  private readonly users = new Map<string, User>();

  create(createUserDto: CreateUserDto): User {
    if (this.findByEmail(createUserDto.email)) {
      throw new ConflictException(`User with email "${createUserDto.email}" already exists`);
    }

    const now = new Date();
    const user: User = {
      id: randomUUID(),
      email: createUserDto.email,
      name: createUserDto.name,
      createdAt: now,
      updatedAt: now,
    };

    this.users.set(user.id, user);
    return user;
  }

  findAll(): User[] {
    return [...this.users.values()];
  }

  findOne(id: string): User {
    const user = this.users.get(id);
    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }
    return user;
  }

  findByEmail(email: string): User | undefined {
    return [...this.users.values()].find((user) => user.email === email);
  }

  update(id: string, updateUserDto: UpdateUserDto): User {
    const user = this.findOne(id);

    if (updateUserDto.email && updateUserDto.email !== user.email && this.findByEmail(updateUserDto.email)) {
      throw new ConflictException(`User with email "${updateUserDto.email}" already exists`);
    }

    const updated: User = {
      ...user,
      ...updateUserDto,
      updatedAt: new Date(),
    };

    this.users.set(id, updated);
    return updated;
  }

  remove(id: string): void {
    this.findOne(id);
    this.users.delete(id);
  }
}
