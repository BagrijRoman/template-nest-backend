import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../common/errors/index.js';
import { SecurityEvent, SecurityEventsService } from '../common/securityEvents/securityEvents.service.js';
import { BreachedPasswordsService } from './breachedPasswords.service.js';
import { CredentialsService } from './credentials.service.js';
import { Credential, CredentialType } from './entities/index.js';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPasswordHash } from './password.util.js';

// verifyPasswordHash is wrapped in a spy (behavior unchanged) so tests can observe the
// dummy verification that equalizes timing for unknown accounts.
vi.mock('./password.util.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./password.util.js')>();
  return { ...original, verifyPasswordHash: vi.fn(original.verifyPasswordHash) };
});

const USER_ID = '507f1f77bcf86cd799439011';

let storedPasswordHash: string;
beforeAll(async () => {
  storedPasswordHash = await hashPassword('secret123');
});

const passwordCredential = () => ({ userId: USER_ID, type: CredentialType.Password, secretHash: storedPasswordHash });
const withLean = <T>(value: T) => ({ lean: () => Promise.resolve(value) });

describe('CredentialsService', () => {
  let service: CredentialsService;

  const credentialModel = { create: vi.fn(), findOne: vi.fn(), updateOne: vi.fn() };
  const breachedPasswordsService = { isBreached: vi.fn() };
  const securityEvents = { record: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    // resetAllMocks also wipes the module spy's pass-through implementation — restore it.
    const original = await vi.importActual<typeof import('./password.util.js')>('./password.util.js');
    vi.mocked(verifyPasswordHash).mockImplementation(original.verifyPasswordHash);
    breachedPasswordsService.isBreached.mockResolvedValue(false);
    credentialModel.findOne.mockImplementation(() => withLean(passwordCredential()));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialsService,
        { provide: getModelToken(Credential.name), useValue: credentialModel },
        { provide: BreachedPasswordsService, useValue: breachedPasswordsService },
        { provide: SecurityEventsService, useValue: securityEvents },
      ],
    }).compile();

    service = module.get<CredentialsService>(CredentialsService);
  });

  it('stores a password credential holding a hash, never the plaintext', async () => {
    await service.createPassword(USER_ID, 'secret123');

    const persisted = credentialModel.create.mock.calls[0][0];
    expect(persisted).toMatchObject({ userId: USER_ID, type: CredentialType.Password });
    expect(persisted).not.toHaveProperty('password');
    expect(persisted.secretHash).not.toContain('secret123');
    expect(await verifyPasswordHash('secret123', persisted.secretHash)).toBe(true);
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    expect(await service.verifyPassword(USER_ID, 'secret123')).toBe(true);
    expect(await service.verifyPassword(USER_ID, 'wrong')).toBe(false);
    expect(credentialModel.findOne).toHaveBeenCalledWith({ userId: USER_ID, type: CredentialType.Password });
  });

  it('runs a dummy hash verification for an unknown account so timing does not reveal its absence', async () => {
    expect(await service.verifyPassword(null, 'secret123')).toBe(false);

    expect(credentialModel.findOne).not.toHaveBeenCalled();
    expect(verifyPasswordHash).toHaveBeenCalledExactlyOnceWith('secret123', DUMMY_PASSWORD_HASH);
  });

  it('runs the same dummy verification for an account without a password credential', async () => {
    credentialModel.findOne.mockImplementation(() => withLean(null));

    expect(await service.verifyPassword(USER_ID, 'secret123')).toBe(false);
    expect(verifyPasswordHash).toHaveBeenCalledExactlyOnceWith('secret123', DUMMY_PASSWORD_HASH);
  });

  it('updates the password after verifying the current one, upserting a new hash', async () => {
    expect(await service.updatePassword(USER_ID, 'secret123', 'NewSecret123')).toBe(true);

    const [filter, update, options] = credentialModel.updateOne.mock.calls[0];
    expect(filter).toEqual({ userId: USER_ID, type: CredentialType.Password });
    expect(options).toEqual({ upsert: true });
    expect(await verifyPasswordHash('NewSecret123', update.secretHash)).toBe(true);
  });

  it('rejects a password update when the current password is wrong, without writing anything', async () => {
    expect(await service.updatePassword(USER_ID, 'wrong', 'NewSecret123')).toBe(false);
    expect(credentialModel.updateOne).not.toHaveBeenCalled();
  });

  it('rejects a breached new password without writing, naming the field', async () => {
    breachedPasswordsService.isBreached.mockResolvedValue(true);

    await expect(service.replacePassword(USER_ID, 'Breached123')).rejects.toMatchObject({
      code: ErrorCode.BreachedPassword,
      details: [{ field: 'newPassword', rule: 'notBreached' }],
    });
    expect(credentialModel.updateOne).not.toHaveBeenCalled();
    expect(securityEvents.record).toHaveBeenCalledWith(SecurityEvent.BreachedPasswordRejected, { userId: USER_ID });
  });

  it('screens a candidate password with the caller-supplied field and context', async () => {
    breachedPasswordsService.isBreached.mockResolvedValue(true);

    await expect(
      service.assertNotBreached('Breached123', 'password', { email: 'jane@example.com' }),
    ).rejects.toMatchObject({ code: ErrorCode.BreachedPassword, details: [{ field: 'password' }] });
    expect(securityEvents.record).toHaveBeenCalledWith(SecurityEvent.BreachedPasswordRejected, {
      email: 'jane@example.com',
    });

    breachedPasswordsService.isBreached.mockResolvedValue(false);
    await expect(service.assertNotBreached('Fine12345', 'password', {})).resolves.toBeUndefined();
  });
});
