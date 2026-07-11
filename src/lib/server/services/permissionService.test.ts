import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../db/testDb';
import { users } from '../db/schema';
import type { SessionUser } from '../auth/session';
import { createServer, listVisibleServerStatuses } from './serverService';
import { setPermission, listPermissionsForServer, isPermissionSetting } from './permissionService';
import { MockSystemctlDriver } from '../systemctl/mock';
import { PermissionDeniedError, NotFoundError } from './errors';

type TestDb = ReturnType<typeof createTestDb>;

async function insertUser(db: TestDb, username: string, isAdmin: boolean): Promise<SessionUser> {
	const [row] = await db
		.insert(users)
		.values({ username, passwordHash: 'x', isAdmin, mustChangePassword: false })
		.returning();
	return { id: row.id, username: row.username, isAdmin: row.isAdmin, mustChangePassword: false };
}

describe('permissionService', () => {
	let db: TestDb;
	let admin: SessionUser;
	let member: SessionUser;
	let driver: MockSystemctlDriver;
	let serverId: number;

	beforeEach(async () => {
		db = createTestDb();
		driver = new MockSystemctlDriver();
		admin = await insertUser(db, 'admin', true);
		member = await insertUser(db, 'member', false);
		const server = await createServer(db, admin, { name: 'mc', unitName: 'game-mc.service' });
		serverId = server.id;
	});

	it('grants view, upgrades to operate, then revokes with none', async () => {
		await setPermission(db, admin, member.id, serverId, 'view');
		let list = await listVisibleServerStatuses(db, member, driver);
		expect(list).toHaveLength(1);
		expect(list[0].canOperate).toBe(false);

		await setPermission(db, admin, member.id, serverId, 'operate');
		list = await listVisibleServerStatuses(db, member, driver);
		expect(list[0].canOperate).toBe(true);

		await setPermission(db, admin, member.id, serverId, 'none');
		list = await listVisibleServerStatuses(db, member, driver);
		expect(list).toHaveLength(0);
	});

	it("revoking with 'none' when no row exists is a no-op, not an error", async () => {
		await expect(setPermission(db, admin, member.id, serverId, 'none')).resolves.toBeUndefined();
	});

	it('rejects setPermission from a non-admin', async () => {
		await expect(setPermission(db, member, member.id, serverId, 'operate')).rejects.toThrow(PermissionDeniedError);
	});

	it('rejects setPermission for a missing user or server', async () => {
		await expect(setPermission(db, admin, 9999, serverId, 'view')).rejects.toThrow(NotFoundError);
		await expect(setPermission(db, admin, member.id, 9999, 'view')).rejects.toThrow(NotFoundError);
	});

	it('listPermissionsForServer returns every user with their effective level', async () => {
		await setPermission(db, admin, member.id, serverId, 'view');
		const rows = await listPermissionsForServer(db, admin, serverId);

		const byName = new Map(rows.map((r) => [r.username, r]));
		expect(byName.get('member')).toMatchObject({ level: 'view', isAdmin: false });
		// Admins are always shown as operate (implicit full access).
		expect(byName.get('admin')).toMatchObject({ level: 'operate', isAdmin: true });
	});

	it('listPermissionsForServer rejects non-admins', async () => {
		await expect(listPermissionsForServer(db, member, serverId)).rejects.toThrow(PermissionDeniedError);
	});

	it('isPermissionSetting narrows only valid values', () => {
		expect(isPermissionSetting('none')).toBe(true);
		expect(isPermissionSetting('view')).toBe(true);
		expect(isPermissionSetting('operate')).toBe(true);
		expect(isPermissionSetting('admin')).toBe(false);
		expect(isPermissionSetting('')).toBe(false);
	});
});
