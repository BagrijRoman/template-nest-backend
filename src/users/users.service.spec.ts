import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { UsersService } from './users.service.js';

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('creates a user', () => {
    const user = service.create({ email: 'jane@example.com', name: 'Jane', password: 'secret123' });

    expect(user.id).toBeDefined();
    expect(user.email).toBe('jane@example.com');
    expect(user.name).toBe('Jane');
    expect(service.findAll()).toHaveLength(1);
  });

  it('never exposes the password hash', () => {
    const created = service.create({ email: 'jane@example.com', name: 'Jane', password: 'secret123' });

    expect(created).not.toHaveProperty('passwordHash');
    expect(created).not.toHaveProperty('password');
    expect(service.findOne(created.id)).not.toHaveProperty('passwordHash');
    expect(service.findAll()[0]).not.toHaveProperty('passwordHash');
    expect(service.findByEmail('jane@example.com')).not.toHaveProperty('passwordHash');
    expect(service.update(created.id, { name: 'Janet' })).not.toHaveProperty('passwordHash');
    expect(service.verifyPassword('jane@example.com', 'secret123')).not.toHaveProperty('passwordHash');
  });

  it('verifies correct credentials and rejects wrong ones', () => {
    service.create({ email: 'jane@example.com', name: 'Jane', password: 'secret123' });

    expect(service.verifyPassword('jane@example.com', 'secret123')?.email).toBe('jane@example.com');
    expect(service.verifyPassword('jane@example.com', 'wrong')).toBeNull();
    expect(service.verifyPassword('missing@example.com', 'secret123')).toBeNull();
  });

  it('rejects duplicate emails', () => {
    service.create({ email: 'jane@example.com', name: 'Jane', password: 'secret123' });

    expect(() => service.create({ email: 'jane@example.com', name: 'Other', password: 'secret123' })).toThrow(
      ConflictException,
    );
  });

  it('finds a user by id', () => {
    const created = service.create({ email: 'jane@example.com', name: 'Jane', password: 'secret123' });

    expect(service.findOne(created.id)).toEqual(created);
  });

  it('throws for a missing user', () => {
    expect(() => service.findOne('missing')).toThrow(NotFoundException);
  });

  it('updates a user', () => {
    const created = service.create({ email: 'jane@example.com', name: 'Jane', password: 'secret123' });
    const updated = service.update(created.id, { name: 'Janet' });

    expect(updated.name).toBe('Janet');
    expect(updated.email).toBe('jane@example.com');
  });

  it('updates the password', () => {
    const created = service.create({ email: 'jane@example.com', name: 'Jane', password: 'secret123' });
    service.update(created.id, { password: 'newSecret456' });

    expect(service.verifyPassword('jane@example.com', 'secret123')).toBeNull();
    expect(service.verifyPassword('jane@example.com', 'newSecret456')?.id).toBe(created.id);
  });

  it('removes a user', () => {
    const created = service.create({ email: 'jane@example.com', name: 'Jane', password: 'secret123' });
    service.remove(created.id);

    expect(service.findAll()).toHaveLength(0);
  });
});
