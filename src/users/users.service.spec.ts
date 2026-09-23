import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppException, ErrorCode } from '../common/errors/index.js';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { CredentialsService } from './credentials.service.js';
import { User, UserRole } from './entities/index.js';
import { UsersService } from './users.service.js';

const MONGO_DUPLICATE_KEY_ERROR_CODE = 11000;

const createUserDto = { email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe', password: 'Secret123' };

const leanUser = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  emailVerified: false,
  role: UserRole.User,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const withLean = <T>(value: T) => ({ lean: () => Promise.resolve(value) });

describe('UsersService', () => {
  let service: UsersService;

  const userModel = {
    countDocuments: vi.fn(),
    create: vi.fn(),
    deleteOne: vi.fn(),
    exists: vi.fn(),
    find: vi.fn(),
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    deleteMany: vi.fn(),
    updateOne: vi.fn(),
  };
  const credentialsService = { assertNotBreached: vi.fn(), createPassword: vi.fn() };
  const securityEvents = { record: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    userModel.exists.mockResolvedValue(null);
    credentialsService.assertNotBreached.mockResolvedValue(undefined);
    credentialsService.createPassword.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: CredentialsService, useValue: credentialsService },
        { provide: SecurityEventsService, useValue: securityEvents },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('creates the user without any secret and stores the password as a credential', async () => {
    const doc = leanUser();
    userModel.create.mockResolvedValue({ id: doc._id.toString(), toObject: () => doc });

    const user = await service.create(createUserDto);

    expect(user).toEqual({
      id: doc._id.toString(),
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      emailVerified: false,
      role: UserRole.User,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
    expect(userModel.create).toHaveBeenCalledWith({ email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe' });
    expect(credentialsService.createPassword).toHaveBeenCalledWith(doc._id.toString(), 'Secret123');
  });

  it('rejects an email that is already in use without attempting the insert', async () => {
    userModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });

    await expect(service.create(createUserDto)).rejects.toMatchObject({
      code: ErrorCode.EmailTaken,
      details: [{ field: 'email', rule: 'unique' }],
    });
    expect(userModel.create).not.toHaveBeenCalled();
    expect(credentialsService.createPassword).not.toHaveBeenCalled();
  });

  it('rejects a duplicate email that slips past the check into the unique index', async () => {
    userModel.create.mockRejectedValue({ code: MONGO_DUPLICATE_KEY_ERROR_CODE });

    await expect(service.create(createUserDto)).rejects.toMatchObject({
      code: ErrorCode.EmailTaken,
      details: [{ field: 'email', rule: 'unique' }],
    });
    expect(credentialsService.createPassword).not.toHaveBeenCalled();
  });

  it('screens the password before creating anything', async () => {
    credentialsService.assertNotBreached.mockRejectedValue(
      AppException.forField(400, ErrorCode.BreachedPassword, 'password', 'notBreached', 'breached'),
    );

    await expect(service.create(createUserDto)).rejects.toMatchObject({ code: ErrorCode.BreachedPassword });
    expect(credentialsService.assertNotBreached).toHaveBeenCalledWith('Secret123', 'password', {
      email: 'jane@example.com',
    });
    expect(userModel.create).not.toHaveBeenCalled();
  });

  it('deletes the just-created user when the credential insert fails, and rethrows', async () => {
    const doc = leanUser();
    const failure = new Error('credentials collection unavailable');
    userModel.create.mockResolvedValue({ id: doc._id.toString(), toObject: () => doc });
    credentialsService.createPassword.mockRejectedValue(failure);

    await expect(service.create(createUserDto)).rejects.toBe(failure);
    expect(userModel.deleteOne).toHaveBeenCalledWith({ _id: doc._id.toString() });
  });

  it('finds a user by id and exposes the Mongo id as a string', async () => {
    const doc = leanUser();
    userModel.findById.mockReturnValue(withLean(doc));

    const user = await service.findById(doc._id.toString());

    expect(user?.id).toBe(doc._id.toString());
    expect(user).not.toHaveProperty('_id');
  });

  it('returns null for a missing id and for a malformed id without querying', async () => {
    userModel.findById.mockReturnValue(withLean(null));
    expect(await service.findById(new Types.ObjectId().toString())).toBeNull();

    expect(await service.findById('not-an-object-id')).toBeNull();
    expect(userModel.findById).toHaveBeenCalledTimes(1);
  });

  it('reads the account and its session cutoff for authentication', async () => {
    const cutoff = new Date();
    const doc = leanUser({ sessionsValidFrom: cutoff });
    userModel.findById.mockReturnValue(withLean(doc));

    const record = await service.findForAuthentication(doc._id.toString());

    expect(record?.user.id).toBe(doc._id.toString());
    // The cutoff is authentication bookkeeping: it must not ride along in the profile.
    expect(record?.user).not.toHaveProperty('sessionsValidFrom');
    expect(record?.sessionsValidFrom).toBe(cutoff);
  });

  it('reports no cutoff for an account that never revoked its sessions, and null for a missing one', async () => {
    userModel.findById.mockReturnValue(withLean(leanUser({ sessionsValidFrom: null })));
    expect((await service.findForAuthentication(new Types.ObjectId().toString()))?.sessionsValidFrom).toBeNull();

    userModel.findById.mockReturnValue(withLean(null));
    expect(await service.findForAuthentication(new Types.ObjectId().toString())).toBeNull();

    expect(await service.findForAuthentication('not-an-object-id')).toBeNull();
  });

  it('stamps the session cutoff when sessions are revoked', async () => {
    const id = new Types.ObjectId().toString();

    await service.markSessionsRevoked(id);

    const [filter, update] = userModel.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: id });
    expect(update.sessionsValidFrom.getTime()).toBeGreaterThanOrEqual(Date.now() - 1000);
  });

  it('finds a user by email', async () => {
    const doc = leanUser();
    userModel.findOne.mockReturnValue(withLean(doc));

    expect((await service.findByEmail('jane@example.com'))?.id).toBe(doc._id.toString());
    expect(userModel.findOne).toHaveBeenCalledWith({ email: 'jane@example.com' });

    userModel.findOne.mockReturnValue(withLean(null));
    expect(await service.findByEmail('missing@example.com')).toBeNull();
  });

  it('patches the profile and returns the updated user', async () => {
    const doc = leanUser({ firstName: 'Janet' });
    userModel.findByIdAndUpdate.mockReturnValue(withLean(doc));

    const user = await service.updateProfile(doc._id.toString(), { firstName: 'Janet' });

    expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(doc._id.toString(), { firstName: 'Janet' }, { new: true });
    expect(user?.firstName).toBe('Janet');
  });

  it('returns null when patching a missing or malformed id, without writing', async () => {
    userModel.findByIdAndUpdate.mockReturnValue(withLean(null));
    expect(await service.updateProfile(new Types.ObjectId().toString(), { firstName: 'Janet' })).toBeNull();

    expect(await service.updateProfile('not-an-object-id', { firstName: 'Janet' })).toBeNull();
    expect(userModel.findByIdAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('deletes the account row', async () => {
    const id = new Types.ObjectId().toString();

    await service.delete(id);

    expect(userModel.deleteOne).toHaveBeenCalledWith({ _id: id });
  });

  it('marks the email verified', async () => {
    const doc = leanUser({ emailVerified: true });
    userModel.findByIdAndUpdate.mockReturnValue(withLean(doc));

    const user = await service.markEmailVerified(doc._id.toString());

    expect(userModel.findByIdAndUpdate.mock.calls[0][1]).toEqual({ emailVerified: true });
    expect(user?.emailVerified).toBe(true);
  });

  it('treats documents created before the emailVerified and role fields as unverified plain users', async () => {
    userModel.findById.mockReturnValue(withLean(leanUser({ emailVerified: undefined, role: undefined })));

    const user = await service.findById(new Types.ObjectId().toString());

    expect(user?.emailVerified).toBe(false);
    expect(user?.role).toBe(UserRole.User);
  });

  it('pages users newest first and reports the total', async () => {
    const docs = [leanUser(), leanUser({ email: 'john@example.com' })];
    const query = {
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(docs),
    };
    userModel.find.mockReturnValue(query);
    userModel.countDocuments.mockResolvedValue(42);

    const page = await service.findPage(2, 10);

    expect(page).toEqual({ data: expect.any(Array), total: 42, limit: 2, offset: 10 });
    expect(page.data.map((user) => user.id)).toEqual(docs.map((doc) => doc._id.toString()));
    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(query.skip).toHaveBeenCalledWith(10);
    expect(query.limit).toHaveBeenCalledWith(2);
  });

  it('sets the role by email and records the change', async () => {
    const doc = leanUser({ role: UserRole.Admin });
    userModel.findOneAndUpdate.mockReturnValue(withLean(doc));

    const user = await service.setRole('jane@example.com', UserRole.Admin);

    expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
      { email: 'jane@example.com' },
      { role: UserRole.Admin },
      { new: true },
    );
    expect(user?.role).toBe(UserRole.Admin);
    expect(securityEvents.record).toHaveBeenCalledWith(SecurityEvent.UserRoleChanged, {
      userId: doc._id.toString(),
      role: UserRole.Admin,
    });
  });

  it('returns null and records nothing when setting the role of an unknown email', async () => {
    userModel.findOneAndUpdate.mockReturnValue(withLean(null));

    expect(await service.setRole('missing@example.com', UserRole.Admin)).toBeNull();
    expect(securityEvents.record).not.toHaveBeenCalled();
  });
});
