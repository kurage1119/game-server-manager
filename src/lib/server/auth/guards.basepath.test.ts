import { describe, it, expect, beforeEach, vi } from 'vitest';

// The guards read `base` from $app/paths (a build-time constant). Simulate a
// subpath deployment by mocking it, to prove the guard logic is base-relative:
// event.url.pathname arrives WITH the base prefix and must be stripped before
// the literal route comparisons, and redirects must be base-prefixed.
vi.mock('$app/paths', () => ({ base: '/server-manager' }));

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

async function runGuards(db: TestDb, event: GuardEvent): Promise<{ response?: Response; thrown?: unknown }> {
	try {
		return { response: await applySessionAndGuards(db, event, resolveOk) };
	} catch (thrown) {
		return { thrown };
	}
}

describe('applySessionAndGuards under a configured base path', () => {
	let db: TestDb;

	beforeEach(() => {
		db = createTestDb();
	});

	it('treats the base-prefixed setup path as /setup (lets it through, no user)', async () => {
		const { response } = await runGuards(db, makeEvent('/server-manager/setup'));
		expect(response?.status).toBe(200);
	});

	it('redirects a base-prefixed page to the base-prefixed /setup while no user exists', async () => {
		const { thrown } = await runGuards(db, makeEvent('/server-manager/'));
		expect(thrown).toMatchObject({ status: 303, location: '/server-manager/setup' });
	});

	it('redirects unauthenticated base-prefixed pages to base-prefixed /login', async () => {
		await db.insert(users).values({ username: 'admin', passwordHash: 'x', isAdmin: true });
		const { thrown } = await runGuards(db, makeEvent('/server-manager/'));
		expect(thrown).toMatchObject({ status: 303, location: '/server-manager/login' });
	});

	it('still applies the admin guard on the base-prefixed /admin area', async () => {
		const [admin] = await db
			.insert(users)
			.values({ username: 'admin', passwordHash: 'x', isAdmin: true })
			.returning();
		const [pleb] = await db
			.insert(users)
			.values({ username: 'pleb', passwordHash: 'x', isAdmin: false })
			.returning();
		void admin;
		const { token } = await createSession(db, pleb.id);
		const { thrown } = await runGuards(db, makeEvent('/server-manager/admin/users', token));
		expect(thrown).toMatchObject({ status: 403 });
	});
});
