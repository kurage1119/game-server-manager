import { randomBytes, createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Cookies } from '@sveltejs/kit';
import { sessions, users } from '../db/schema';
import type * as schema from '../db/schema';

export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_RENEWAL_THRESHOLD_MS = SESSION_DURATION_MS / 2; // slide once past the halfway point

export const SESSION_COOKIE_NAME = 'session';

type DB = BetterSQLite3Database<typeof schema>;

export interface SessionUser {
	id: number;
	username: string;
	isAdmin: boolean;
	mustChangePassword: boolean;
}

export interface SessionValidationResult {
	session: { id: string; expiresAt: Date };
	user: SessionUser;
}

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** Raw, unguessable token to hand to the client as a cookie value. Never stored directly. */
export function generateSessionToken(): string {
	return randomBytes(32).toString('base64url');
}

/** Creates a session row for `userId` and returns the raw token to set as a cookie. */
export async function createSession(db: DB, userId: number): Promise<{ token: string; expiresAt: Date }> {
	const token = generateSessionToken();
	const id = hashToken(token);
	const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

	await db.insert(sessions).values({
		id,
		userId,
		expiresAt
	});

	return { token, expiresAt };
}

/**
 * Validates a raw session token. Returns null if missing/expired (expired rows
 * are deleted as a side effect). If the session is more than halfway to expiry,
 * it is slid forward another full SESSION_DURATION_MS.
 */
export async function validateSessionToken(db: DB, token: string): Promise<SessionValidationResult | null> {
	const id = hashToken(token);

	const rows = await db
		.select({
			sessionId: sessions.id,
			expiresAt: sessions.expiresAt,
			userId: users.id,
			username: users.username,
			isAdmin: users.isAdmin,
			mustChangePassword: users.mustChangePassword
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(eq(sessions.id, id));

	const row = rows[0];
	if (!row) return null;

	const now = Date.now();
	if (row.expiresAt.getTime() <= now) {
		await db.delete(sessions).where(eq(sessions.id, id));
		return null;
	}

	let expiresAt = row.expiresAt;
	const timeRemaining = expiresAt.getTime() - now;
	if (timeRemaining < SESSION_RENEWAL_THRESHOLD_MS) {
		expiresAt = new Date(now + SESSION_DURATION_MS);
		await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
	}

	return {
		session: { id: row.sessionId, expiresAt },
		user: {
			id: row.userId,
			username: row.username,
			isAdmin: row.isAdmin,
			mustChangePassword: row.mustChangePassword
		}
	};
}

/** Invalidates a single session by its raw token (e.g. logout). */
export async function invalidateSession(db: DB, token: string): Promise<void> {
	const id = hashToken(token);
	await db.delete(sessions).where(eq(sessions.id, id));
}

/** Invalidates every session belonging to a user (e.g. temp-password reissue). */
export async function invalidateAllUserSessions(db: DB, userId: number): Promise<void> {
	await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Shared cookie shape so hooks.server.ts (refresh) and the login/setup actions (initial set) never drift apart. */
export function setSessionCookie(cookies: Cookies, secure: boolean, token: string, expiresAt: Date): void {
	cookies.set(SESSION_COOKIE_NAME, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		expires: expiresAt
	});
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
}
