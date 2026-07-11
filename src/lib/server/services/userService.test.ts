import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../db/testDb';
import type { SessionUser } from '../auth/session';
import { createSession, validateSessionToken } from '../auth/session';
import {
	createAdminUser,
	createUserWithTempPassword,
	reissueTempPassword,
	deleteUser,
	listUsers,
	verifyCredentials,
	updatePassword
} from './userService';
import { PermissionDeniedError, NotFoundError, ValidationError } from './errors';

type TestDb = ReturnType<typeof createTestDb>;

function asSession(user: { id: number; username: string; isAdmin: boolean; mustChangePassword: boolean }): SessionUser {
	return { ...user };
}

describe('userService admin operations', () => {
	let db: TestDb;
	let admin: SessionUser;

	beforeEach(async () => {
		db = createTestDb();
		admin = asSession(await createAdminUser(db, 'admin', 'admin-password-1'));
	});

	describe('createUserWithTempPassword', () => {
		it('creates a user with must_change_password=1 and a working 12-char temp password', async () => {
			const { user, tempPassword } = await createUserWithTempPassword(db, admin, 'alice', false);
			expect(user.mustChangePassword).toBe(true);
			expect(user.isAdmin).toBe(false);
			expect(tempPassword).toHaveLength(12);

			const verified = await verifyCredentials(db, 'alice', tempPassword);
			expect(verified?.id).toBe(user.id);
		});

		it('rejects duplicate usernames', async () => {
			await createUserWithTempPassword(db, admin, 'alice', false);
			await expect(createUserWithTempPassword(db, admin, 'alice', false)).rejects.toThrow(ValidationError);
		});

		it('rejects an empty username', async () => {
			await expect(createUserWithTempPassword(db, admin, '   ', false)).rejects.toThrow(ValidationError);
		});

		it('rejects non-admin callers', async () => {
			const { user } = await createUserWithTempPassword(db, admin, 'alice', false);
			await expect(createUserWithTempPassword(db, asSession(user), 'mallory', false)).rejects.toThrow(
				PermissionDeniedError
			);
		});
	});

	describe('reissueTempPassword', () => {
		it('replaces the password, sets the flag, and destroys ALL sessions of the user', async () => {
			const { user, tempPassword: original } = await createUserWithTempPassword(db, admin, 'alice', false);
			const s1 = await createSession(db, user.id);
			const s2 = await createSession(db, user.id);
			const adminSession = await createSession(db, admin.id);

			const { tempPassword: reissued, username } = await reissueTempPassword(db, admin, user.id);
			expect(reissued).toHaveLength(12);
			expect(reissued).not.toBe(original);
			// Username comes from the DB, not from any client-supplied value.
			expect(username).toBe('alice');

			// Old password no longer works; new one does, with the flag set.
			expect(await verifyCredentials(db, 'alice', original)).toBeNull();
			const verified = await verifyCredentials(db, 'alice', reissued);
			expect(verified?.mustChangePassword).toBe(true);

			// Both of alice's sessions are gone; the admin's session is untouched.
			expect(await validateSessionToken(db, s1.token)).toBeNull();
			expect(await validateSessionToken(db, s2.token)).toBeNull();
			expect(await validateSessionToken(db, adminSession.token)).not.toBeNull();
		});

		it('rejects a missing user and non-admin callers', async () => {
			await expect(reissueTempPassword(db, admin, 9999)).rejects.toThrow(NotFoundError);
			const { user } = await createUserWithTempPassword(db, admin, 'alice', false);
			await expect(reissueTempPassword(db, asSession(user), admin.id)).rejects.toThrow(PermissionDeniedError);
		});
	});

	describe('createAdminUser (setup race)', () => {
		it('refuses to create a second admin once any user exists (transactional users=0 re-check)', async () => {
			// `admin` already exists via beforeEach — a concurrent/replayed setup POST must fail.
			await expect(createAdminUser(db, 'admin2', 'another-password-1')).rejects.toThrow(ValidationError);
			const remaining = await listUsers(db, admin);
			expect(remaining.map((u) => u.username)).toEqual(['admin']);
		});
	});

	describe('verifyCredentials failure paths', () => {
		it('returns null for an unknown username', async () => {
			expect(await verifyCredentials(db, 'no-such-user', 'whatever-password')).toBeNull();
		});

		it('returns null for a wrong password on an existing user', async () => {
			expect(await verifyCredentials(db, 'admin', 'wrong-password-999')).toBeNull();
		});
	});

	describe('updatePassword', () => {
		it('replaces the hash and clears must_change_password', async () => {
			const { user, tempPassword } = await createUserWithTempPassword(db, admin, 'alice', false);
			expect(user.mustChangePassword).toBe(true);

			await updatePassword(db, user.id, 'her-new-password-1');

			// Old (temp) password dead, new one live, forced-change flag cleared.
			expect(await verifyCredentials(db, 'alice', tempPassword)).toBeNull();
			const verified = await verifyCredentials(db, 'alice', 'her-new-password-1');
			expect(verified).not.toBeNull();
			expect(verified?.mustChangePassword).toBe(false);
		});
	});

	describe('deleteUser', () => {
		it('deletes a regular user (and their sessions, via FK cascade)', async () => {
			const { user } = await createUserWithTempPassword(db, admin, 'alice', false);
			const session = await createSession(db, user.id);

			await deleteUser(db, admin, user.id);

			const remaining = await listUsers(db, admin);
			expect(remaining.map((u) => u.username)).toEqual(['admin']);
			expect(await validateSessionToken(db, session.token)).toBeNull();
		});

		it('refuses to delete your own account', async () => {
			await expect(deleteUser(db, admin, admin.id)).rejects.toThrow(ValidationError);
		});

		it('refuses to delete the last remaining admin', async () => {
			// A second admin trying to delete the only other admin is allowed…
			const { user: secondAdmin } = await createUserWithTempPassword(db, admin, 'admin2', true);
			await deleteUser(db, admin, secondAdmin.id);
			// …but now 'admin' is the last admin and cannot be deleted even by force-constructed calls.
			const fakeOtherAdmin: SessionUser = { id: 12345, username: 'ghost', isAdmin: true, mustChangePassword: false };
			await expect(deleteUser(db, fakeOtherAdmin, admin.id)).rejects.toThrow(ValidationError);
		});

		it('rejects non-admin callers and missing targets', async () => {
			const { user } = await createUserWithTempPassword(db, admin, 'alice', false);
			await expect(deleteUser(db, asSession(user), admin.id)).rejects.toThrow(PermissionDeniedError);
			await expect(deleteUser(db, admin, 9999)).rejects.toThrow(NotFoundError);
		});
	});
});
