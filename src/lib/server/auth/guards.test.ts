import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from '../db/testDb';
import { users } from '../db/schema';
import { createSession } from './session';
import { applySessionAndGuards, type GuardEvent } from './guards';

type TestDb = ReturnType<typeof createTestDb>;

function makeEvent(path: string, token?: string): GuardEvent {
	const jar = new Map<string, string>();
	if (token) jar.set('session', token);
	const cookies = {
		get: (name: string) => jar.get(name),
		getAll: () => [...jar].map(([name, value]) => ({ name, value })),
		set: vi.fn((name: string, value: string) => {
			jar.set(name, value);
		}),
		delete: vi.fn((name: string) => {
			jar.delete(name);
		}),
		serialize: () => ''
	};
	return {
		url: new URL(`http://localhost${path}`),
		cookies: cookies as unknown as GuardEvent['cookies'],
		locals: { user: null }
	};
}

const resolveOk = async () => new Response('page-content', { status: 200 });

/** redirect()/error() throw control-flow objects; capture them for assertions. */
async function runGuards(db: TestDb, event: GuardEvent): Promise<{ response?: Response; thrown?: unknown }> {
	try {
		return { response: await applySessionAndGuards(db, event, resolveOk) };
	} catch (thrown) {
		return { thrown };
	}
}

async function insertUser(db: TestDb, username: string, isAdmin: boolean, mustChangePassword = false) {
	const [row] = await db
		.insert(users)
		.values({ username, passwordHash: 'x', isAdmin, mustChangePassword })
		.returning();
	return row;
}

describe('applySessionAndGuards (hooks guard chain)', () => {
	let db: TestDb;

	beforeEach(() => {
		db = createTestDb();
	});

	describe('guard 1: first-run setup', () => {
		it('redirects every page to /setup while no user exists', async () => {
			const { thrown } = await runGuards(db, makeEvent('/'));
			expect(thrown).toMatchObject({ status: 303, location: '/setup' });
		});

		it('lets /setup itself through while no user exists', async () => {
			const { response } = await runGuards(db, makeEvent('/setup'));
			expect(response?.status).toBe(200);
		});

		it('answers /api/* with 403 JSON (setup_required) instead of a redirect', async () => {
			const { response } = await runGuards(db, makeEvent('/api/status'));
			expect(response?.status).toBe(403);
			expect(await response?.json()).toEqual({ error: 'setup_required' });
		});

		it('redirects /setup to / once a user exists (no re-setup)', async () => {
			await insertUser(db, 'admin', true);
			const { thrown } = await runGuards(db, makeEvent('/setup'));
			expect(thrown).toMatchObject({ status: 303, location: '/' });
		});
	});

	describe('guard 2: authentication', () => {
		beforeEach(async () => {
			await insertUser(db, 'admin', true);
		});

		it('redirects unauthenticated page requests to /login', async () => {
			const { thrown } = await runGuards(db, makeEvent('/'));
			expect(thrown).toMatchObject({ status: 303, location: '/login' });
		});

		it('answers unauthenticated /api/* with 401 JSON', async () => {
			const { response } = await runGuards(db, makeEvent('/api/status'));
			expect(response?.status).toBe(401);
			expect(await response?.json()).toEqual({ error: 'unauthorized' });
		});

		it('lets /login through unauthenticated', async () => {
			const { response } = await runGuards(db, makeEvent('/login'));
			expect(response?.status).toBe(200);
		});

		it('resolves a valid session into locals.user and lets the request through', async () => {
			const admin = await insertUser(db, 'alice', false);
			const { token } = await createSession(db, admin.id);
			const event = makeEvent('/', token);
			const { response } = await runGuards(db, event);
			expect(response?.status).toBe(200);
			expect(event.locals.user?.username).toBe('alice');
		});

		it('clears an invalid session cookie and redirects to /login', async () => {
			const event = makeEvent('/', 'garbage-token');
			const { thrown } = await runGuards(db, event);
			expect(thrown).toMatchObject({ status: 303, location: '/login' });
			expect(event.cookies.delete).toHaveBeenCalled();
		});
	});

	describe('guard 3: forced password change', () => {
		let token: string;

		beforeEach(async () => {
			const user = await insertUser(db, 'temp-user', false, true);
			({ token } = await createSession(db, user.id));
		});

		it('force-redirects pages to /change-password', async () => {
			const { thrown } = await runGuards(db, makeEvent('/', token));
			expect(thrown).toMatchObject({ status: 303, location: '/change-password' });
		});

		it('lets /change-password and /logout through', async () => {
			expect((await runGuards(db, makeEvent('/change-password', token))).response?.status).toBe(200);
			expect((await runGuards(db, makeEvent('/logout', token))).response?.status).toBe(200);
		});

		it('answers /api/* with 403 JSON (password_change_required) instead of a redirect', async () => {
			const { response } = await runGuards(db, makeEvent('/api/status', token));
			expect(response?.status).toBe(403);
			expect(await response?.json()).toEqual({ error: 'password_change_required' });
		});
	});

	describe('guard 4: admin area', () => {
		it('rejects a non-admin with 403', async () => {
			await insertUser(db, 'admin', true);
			const user = await insertUser(db, 'pleb', false);
			const { token } = await createSession(db, user.id);
			const { thrown } = await runGuards(db, makeEvent('/admin/users', token));
			expect(thrown).toMatchObject({ status: 403 });
		});

		it('lets an admin through', async () => {
			const admin = await insertUser(db, 'admin', true);
			const { token } = await createSession(db, admin.id);
			const { response } = await runGuards(db, makeEvent('/admin/users', token));
			expect(response?.status).toBe(200);
		});
	});
});
