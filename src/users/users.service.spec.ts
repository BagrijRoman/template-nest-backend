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
    const user = service.create({ email: 'jane@example.com', name: 'Jane' });

    expect(user.id).toBeDefined();
    expect(user.email).toBe('jane@example.com');
    expect(user.name).toBe('Jane');
    expect(service.findAll()).toHaveLength(1);
  });

  it('rejects duplicate emails', () => {
    service.create({ email: 'jane@example.com', name: 'Jane' });

    expect(() => service.create({ email: 'jane@example.com', name: 'Other' })).toThrow(ConflictException);
  });

  it('finds a user by id', () => {
    const created = service.create({ email: 'jane@example.com', name: 'Jane' });

    expect(service.findOne(created.id)).toEqual(created);
  });

  it('throws for a missing user', () => {
    expect(() => service.findOne('missing')).toThrow(NotFoundException);
  });

  it('updates a user', () => {
    const created = service.create({ email: 'jane@example.com', name: 'Jane' });
    const updated = service.update(created.id, { name: 'Janet' });

    expect(updated.name).toBe('Janet');
    expect(updated.email).toBe('jane@example.com');
  });

  it('removes a user', () => {
    const created = service.create({ email: 'jane@example.com', name: 'Jane' });
    service.remove(created.id);

    expect(service.findAll()).toHaveLength(0);
  });
});
