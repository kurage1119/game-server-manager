import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/testDb';
import { users, sessions } from '../db/schema';
import {
	createSession,
	validateSessionToken,
	invalidateSession,
	invalidateAllUserSessions,
	SESSION_DURATION_MS
} from './session';

type TestDb = ReturnType<typeof createTestDb>;

async function insertUser(db: TestDb, username = 'alice') {
	const [user] = await db
		.insert(users)
		.values({ username, passwordHash: 'irrelevant-for-session-tests', isAdmin: false, mustChangePassword: false })
		.returning();
	return user;
}

describe('session lifecycle', () => {
	let db: TestDb;

	beforeEach(() => {
		db = createTestDb();
	});

	it('creates a session and validates it back to the same user', async () => {
		const user = await insertUser(db);
		const { token } = await createSession(db, user.id);

		const result = await validateSessionToken(db, token);
		expect(result).not.toBeNull();
		expect(result?.user.id).toBe(user.id);
		expect(result?.user.username).toBe('alice');
	});

	it('rejects an unknown/garbage token', async () => {
		await insertUser(db);
		const result = await validateSessionToken(db, 'not-a-real-token');
		expect(result).toBeNull();
	});

	it('rejects and deletes an expired session', async () => {
		vi.useFakeTimers();
		try {
			const user = await insertUser(db);
			const { token } = await createSession(db, user.id);

			vi.advanceTimersByTime(SESSION_DURATION_MS + 1000);

			const result = await validateSessionToken(db, token);
			expect(result).toBeNull();

			// It should actually be deleted as a side effect, not just reported invalid.
			const remaining = await db.select().from(sessions).where(eq(sessions.userId, user.id));
			expect(remaining).toHaveLength(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('slides the expiry forward once past the halfway point', async () => {
		vi.useFakeTimers();
		try {
			const user = await insertUser(db);
			const { token, expiresAt: originalExpiry } = await createSession(db, user.id);

			// Move to just past the halfway point of the 30-day session.
			vi.advanceTimersByTime(SESSION_DURATION_MS / 2 + 1000);

			const result = await validateSessionToken(db, token);
			expect(result).not.toBeNull();
			expect(result!.session.expiresAt.getTime()).toBeGreaterThan(originalExpiry.getTime());
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not slide the expiry before the halfway point', async () => {
		vi.useFakeTimers();
		try {
			const user = await insertUser(db);
			const { token, expiresAt: originalExpiry } = await createSession(db, user.id);

			vi.advanceTimersByTime(1000);

			const result = await validateSessionToken(db, token);
			expect(result!.session.expiresAt.getTime()).toBe(originalExpiry.getTime());
		} finally {
			vi.useRealTimers();
		}
	});

	it('invalidateSession removes a single session', async () => {
		const user = await insertUser(db);
		const { token } = await createSession(db, user.id);

		await invalidateSession(db, token);

		expect(await validateSessionToken(db, token)).toBeNull();
	});

	it('invalidateAllUserSessions removes every session for that user but not others', async () => {
		const alice = await insertUser(db, 'alice');
		const bob = await insertUser(db, 'bob');

		const aliceSession1 = await createSession(db, alice.id);
		const aliceSession2 = await createSession(db, alice.id);
		const bobSession = await createSession(db, bob.id);

		await invalidateAllUserSessions(db, alice.id);

		expect(await validateSessionToken(db, aliceSession1.token)).toBeNull();
		expect(await validateSessionToken(db, aliceSession2.token)).toBeNull();
		expect(await validateSessionToken(db, bobSession.token)).not.toBeNull();
	});
});
