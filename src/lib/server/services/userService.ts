import { eq, and, ne } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { users } from '../db/schema';
import type * as schema from '../db/schema';
import { hashPassword, verifyPassword, generateTempPassword } from '../auth/password';
import { invalidateAllUserSessions } from '../auth/session';
import type { SessionUser } from '../auth/session';
import { PermissionDeniedError, NotFoundError, ValidationError } from './errors';

type DB = BetterSQLite3Database<typeof schema>;

export interface UserRecord {
	id: number;
	username: string;
	isAdmin: boolean;
	mustChangePassword: boolean;
}

export interface UserListRow extends UserRecord {
	createdAt: string;
}

/**
 * Shared by the web app and (from Step 6) the Discord bot — kept here rather
 * than inline in route files per docs/implementation-plan.md's service layer.
 */

export async function hasAnyUser(db: DB): Promise<boolean> {
	const rows = await db.select({ id: users.id }).from(users).limit(1);
	return rows.length > 0;
}

export async function findUserByUsername(db: DB, username: string): Promise<UserRecord | null> {
	const rows = await db
		.select({
			id: users.id,
			username: users.username,
			isAdmin: users.isAdmin,
			mustChangePassword: users.mustChangePassword
		})
		.from(users)
		.where(eq(users.username, username))
		.limit(1);
	return rows[0] ?? null;
}

/**
 * Creates the first administrator account (the /setup flow). The users=0
 * pre-condition is re-checked INSIDE a transaction right before the insert:
 * hooks.server.ts already guards the route, but two concurrent setup POSTs
 * would otherwise both pass that check and create two admins (TOCTOU).
 */
export async function createAdminUser(db: DB, username: string, password: string): Promise<UserRecord> {
	const passwordHash = await hashPassword(password);
	// better-sqlite3 transactions are synchronous — hash above, sync queries inside.
	return db.transaction((tx) => {
		const existing = tx.select({ id: users.id }).from(users).limit(1).all();
		if (existing.length > 0) {
			throw new ValidationError('セットアップは既に完了しています。');
		}
		return tx
			.insert(users)
			.values({
				username,
				passwordHash,
				isAdmin: true,
				mustChangePassword: false
			})
			.returning({
				id: users.id,
				username: users.username,
				isAdmin: users.isAdmin,
				mustChangePassword: users.mustChangePassword
			})
			.get();
	});
}

/** Verifies credentials for /login. Returns null on any mismatch (unknown user or bad password). */
export async function verifyCredentials(db: DB, username: string, password: string): Promise<UserRecord | null> {
	const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
	const row = rows[0];
	if (!row) return null;

	const valid = await verifyPassword(row.passwordHash, password);
	if (!valid) return null;

	return {
		id: row.id,
		username: row.username,
		isAdmin: row.isAdmin,
		mustChangePassword: row.mustChangePassword
	};
}

/** Sets a new password for /change-password and clears the forced-change flag. */
export async function updatePassword(db: DB, userId: number, newPassword: string): Promise<void> {
	const passwordHash = await hashPassword(newPassword);
	await db.update(users).set({ passwordHash, mustChangePassword: false }).where(eq(users.id, userId));
}

// ---------------------------------------------------------------------------
// Admin user management (Step 4, screen 5)
// ---------------------------------------------------------------------------

function assertAdmin(actor: SessionUser): void {
	if (!actor.isAdmin) {
		throw new PermissionDeniedError('この操作には管理者権限が必要です。');
	}
}

export async function listUsers(db: DB, actor: SessionUser): Promise<UserListRow[]> {
	assertAdmin(actor);
	return db
		.select({
			id: users.id,
			username: users.username,
			isAdmin: users.isAdmin,
			mustChangePassword: users.mustChangePassword,
			createdAt: users.createdAt
		})
		.from(users)
		.orderBy(users.username);
}

/**
 * Creates a user with a freshly generated temporary password and
 * must_change_password=1. The plaintext temp password is returned exactly once
 * for the admin UI to display; it is never stored or logged.
 */
export async function createUserWithTempPassword(
	db: DB,
	actor: SessionUser,
	username: string,
	isAdmin: boolean
): Promise<{ user: UserRecord; tempPassword: string }> {
	assertAdmin(actor);
	const trimmed = username.trim();
	if (!trimmed) {
		throw new ValidationError('ユーザー名を入力してください。');
	}

	const tempPassword = generateTempPassword();
	const passwordHash = await hashPassword(tempPassword);

	try {
		const rows = await db
			.insert(users)
			.values({ username: trimmed, passwordHash, isAdmin, mustChangePassword: true })
			.returning({
				id: users.id,
				username: users.username,
				isAdmin: users.isAdmin,
				mustChangePassword: users.mustChangePassword
			});
		return { user: rows[0], tempPassword };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		if (message.includes('UNIQUE constraint failed')) {
			throw new ValidationError('同じユーザー名のユーザーが既に存在します。');
		}
		throw e;
	}
}

/**
 * Reissues a temporary password: new random password, must_change_password=1,
 * and ALL existing sessions of that user destroyed (docs/implementation-plan.md
 * 認証設計). Returns the plaintext exactly once, together with the username
 * read from the DB (never trust a client-supplied display name).
 */
export async function reissueTempPassword(
	db: DB,
	actor: SessionUser,
	userId: number
): Promise<{ tempPassword: string; username: string }> {
	assertAdmin(actor);
	const [target] = await db
		.select({ id: users.id, username: users.username })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	if (!target) throw new NotFoundError('ユーザーが見つかりません。');

	const tempPassword = generateTempPassword();
	const passwordHash = await hashPassword(tempPassword);

	await db.update(users).set({ passwordHash, mustChangePassword: true }).where(eq(users.id, userId));
	await invalidateAllUserSessions(db, userId);

	return { tempPassword, username: target.username };
}

/**
 * Deletes a user. Guards: an admin may never delete their own account (which
 * also makes deleting the last admin impossible, since only admins can call
 * this), and as a belt-and-braces check the last remaining admin can never be
 * deleted by anyone. Sessions and permissions cascade via FK.
 */
export async function deleteUser(db: DB, actor: SessionUser, userId: number): Promise<void> {
	assertAdmin(actor);
	if (actor.id === userId) {
		throw new ValidationError('自分自身のアカウントは削除できません。');
	}

	const [target] = await db
		.select({ id: users.id, isAdmin: users.isAdmin })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	if (!target) throw new NotFoundError('ユーザーが見つかりません。');

	if (target.isAdmin) {
		const otherAdmins = await db
			.select({ id: users.id })
			.from(users)
			.where(and(eq(users.isAdmin, true), ne(users.id, userId)))
			.limit(1);
		if (otherAdmins.length === 0) {
			throw new ValidationError('最後の管理者は削除できません。');
		}
	}

	await db.delete(users).where(eq(users.id, userId));
}
