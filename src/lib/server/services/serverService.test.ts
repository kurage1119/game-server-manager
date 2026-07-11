import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../db/testDb';
import { users } from '../db/schema';
import type { SessionUser } from '../auth/session';
import { MockSystemctlDriver } from '../systemctl/mock';
import {
	createServer,
	updateServer,
	deleteServer,
	listAllServers,
	listVisibleServerStatuses,
	startServer,
	stopServer,
	getServerStatus
} from './serverService';
import { setPermission } from './permissionService';
import { PermissionDeniedError, NotFoundError, ValidationError } from './errors';

type TestDb = ReturnType<typeof createTestDb>;

async function insertUser(db: TestDb, username: string, isAdmin: boolean): Promise<SessionUser> {
	const [row] = await db
		.insert(users)
		.values({ username, passwordHash: 'x', isAdmin, mustChangePassword: false })
		.returning();
	return { id: row.id, username: row.username, isAdmin: row.isAdmin, mustChangePassword: false };
}

describe('serverService', () => {
	let db: TestDb;
	let admin: SessionUser;
	let operateUser: SessionUser;
	let viewUser: SessionUser;
	let noPermUser: SessionUser;
	let driver: MockSystemctlDriver;
	let serverId: number;

	beforeEach(async () => {
		db = createTestDb();
		driver = new MockSystemctlDriver();
		admin = await insertUser(db, 'admin', true);
		operateUser = await insertUser(db, 'op', false);
		viewUser = await insertUser(db, 'viewer', false);
		noPermUser = await insertUser(db, 'nobody', false);

		const server = await createServer(db, admin, { name: 'mc', unitName: 'game-mc.service' });
		serverId = server.id;
		await setPermission(db, admin, operateUser.id, serverId, 'operate');
		await setPermission(db, admin, viewUser.id, serverId, 'view');
	});

	describe('CRUD (admin only)', () => {
		it('rejects create with an invalid unit name', async () => {
			await expect(createServer(db, admin, { name: 'bad', unitName: 'game-a;rm.service' })).rejects.toThrow(
				ValidationError
			);
			await expect(createServer(db, admin, { name: 'bad2', unitName: 'game-*.service' })).rejects.toThrow(
				ValidationError
			);
		});

		it('rejects create with a duplicate name or unit name', async () => {
			await expect(createServer(db, admin, { name: 'mc', unitName: 'game-other.service' })).rejects.toThrow(
				ValidationError
			);
			await expect(createServer(db, admin, { name: 'other', unitName: 'game-mc.service' })).rejects.toThrow(
				ValidationError
			);
		});

		it('rejects CRUD calls from non-admins', async () => {
			await expect(createServer(db, operateUser, { name: 'x', unitName: 'game-x.service' })).rejects.toThrow(
				PermissionDeniedError
			);
			await expect(listAllServers(db, viewUser)).rejects.toThrow(PermissionDeniedError);
			await expect(
				updateServer(db, operateUser, serverId, { name: 'x', unitName: 'game-x.service' })
			).rejects.toThrow(PermissionDeniedError);
			await expect(deleteServer(db, noPermUser, serverId)).rejects.toThrow(PermissionDeniedError);
		});

		it('updates and deletes as admin, validating the new unit name', async () => {
			const updated = await updateServer(db, admin, serverId, { name: 'mc2', unitName: 'game-mc2.service' });
			expect(updated.name).toBe('mc2');
			await expect(
				updateServer(db, admin, serverId, { name: 'mc2', unitName: 'not-valid.service' })
			).rejects.toThrow(ValidationError);

			await deleteServer(db, admin, serverId);
			await expect(listAllServers(db, admin)).resolves.toHaveLength(0);
		});

		it('throws NotFoundError for a missing server id', async () => {
			await expect(deleteServer(db, admin, 9999)).rejects.toThrow(NotFoundError);
		});
	});

	describe('visibility (listVisibleServerStatuses)', () => {
		it('admin sees all servers with canOperate=true', async () => {
			await createServer(db, admin, { name: 'second', unitName: 'game-second.service' });
			const list = await listVisibleServerStatuses(db, admin, driver);
			expect(list).toHaveLength(2);
			expect(list.every((s) => s.canOperate)).toBe(true);
		});

		it('operate user sees the server with canOperate=true', async () => {
			const list = await listVisibleServerStatuses(db, operateUser, driver);
			expect(list).toHaveLength(1);
			expect(list[0]).toMatchObject({ id: serverId, name: 'mc', canOperate: true, status: 'inactive' });
		});

		it('view user sees the server with canOperate=false', async () => {
			const list = await listVisibleServerStatuses(db, viewUser, driver);
			expect(list).toHaveLength(1);
			expect(list[0].canOperate).toBe(false);
		});

		it('user without permission sees nothing', async () => {
			const list = await listVisibleServerStatuses(db, noPermUser, driver);
			expect(list).toHaveLength(0);
		});

		it("a driver failure for one unit yields 'unknown' for that entry without breaking the rest", async () => {
			await createServer(db, admin, { name: 'broken', unitName: 'game-broken.service' });
			const flakyDriver = {
				start: async () => {},
				stop: async () => {},
				status: async (unitName: string) => {
					if (unitName === 'game-broken.service') {
						throw new Error('systemctl is-active game-broken.service failed (exit 4): No such unit');
					}
					return 'active' as const;
				}
			};

			const list = await listVisibleServerStatuses(db, admin, flakyDriver);
			const byName = new Map(list.map((s) => [s.name, s.status]));
			expect(byName.get('broken')).toBe('unknown');
			expect(byName.get('mc')).toBe('active');
		});
	});

	describe('start/stop/status authorization', () => {
		it('admin can start, stop and read status', async () => {
			await startServer(db, admin, serverId, driver);
			await expect(getServerStatus(db, admin, serverId, driver)).resolves.toBe('activating');
			await stopServer(db, admin, serverId, driver);
			await expect(getServerStatus(db, admin, serverId, driver)).resolves.toBe('deactivating');
		});

		it('operate user can start, stop and read status', async () => {
			await startServer(db, operateUser, serverId, driver);
			await expect(getServerStatus(db, operateUser, serverId, driver)).resolves.toBe('activating');
			await stopServer(db, operateUser, serverId, driver);
		});

		it('view user can read status but not start/stop', async () => {
			await expect(getServerStatus(db, viewUser, serverId, driver)).resolves.toBe('inactive');
			await expect(startServer(db, viewUser, serverId, driver)).rejects.toThrow(PermissionDeniedError);
			await expect(stopServer(db, viewUser, serverId, driver)).rejects.toThrow(PermissionDeniedError);
		});

		it('user without permission can do nothing, not even read status', async () => {
			await expect(getServerStatus(db, noPermUser, serverId, driver)).rejects.toThrow(PermissionDeniedError);
			await expect(startServer(db, noPermUser, serverId, driver)).rejects.toThrow(PermissionDeniedError);
			await expect(stopServer(db, noPermUser, serverId, driver)).rejects.toThrow(PermissionDeniedError);
		});
	});
});
