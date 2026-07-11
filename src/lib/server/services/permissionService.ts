import { eq, and } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { permissions, users, servers } from '../db/schema';
import type * as schema from '../db/schema';
import type { SessionUser } from '../auth/session';
import { PermissionDeniedError, NotFoundError, ValidationError } from './errors';
import type { PermissionLevel } from './serverService';

type DB = BetterSQLite3Database<typeof schema>;

/** 'none' removes the row (= server becomes invisible to the user). */
export type PermissionSetting = PermissionLevel | 'none';

const VALID_SETTINGS: ReadonlySet<string> = new Set(['none', 'view', 'operate']);

export function isPermissionSetting(value: string): value is PermissionSetting {
	return VALID_SETTINGS.has(value);
}

function assertAdmin(actor: SessionUser): void {
	if (!actor.isAdmin) {
		throw new PermissionDeniedError('この操作には管理者権限が必要です。');
	}
}

/** Sets (or clears, with 'none') a user's permission level on a server. Admin only. */
export async function setPermission(
	db: DB,
	actor: SessionUser,
	userId: number,
	serverId: number,
	setting: PermissionSetting
): Promise<void> {
	assertAdmin(actor);

	if (!VALID_SETTINGS.has(setting)) {
		throw new ValidationError('権限レベルが不正です。');
	}

	const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
	if (!user) throw new NotFoundError('ユーザーが見つかりません。');
	const [server] = await db.select({ id: servers.id }).from(servers).where(eq(servers.id, serverId)).limit(1);
	if (!server) throw new NotFoundError('サーバーが見つかりません。');

	if (setting === 'none') {
		await db.delete(permissions).where(and(eq(permissions.userId, userId), eq(permissions.serverId, serverId)));
		return;
	}

	await db
		.insert(permissions)
		.values({ userId, serverId, level: setting })
		.onConflictDoUpdate({
			target: [permissions.userId, permissions.serverId],
			set: { level: setting }
		});
}

export interface ServerPermissionRow {
	userId: number;
	username: string;
	isAdmin: boolean;
	level: PermissionSetting;
}

/**
 * Permission settings of every user for one server (for the /admin/servers/[id]
 * permission section). Users without a row get 'none'. Admin only.
 */
export async function listPermissionsForServer(
	db: DB,
	actor: SessionUser,
	serverId: number
): Promise<ServerPermissionRow[]> {
	assertAdmin(actor);

	const allUsers = await db
		.select({ id: users.id, username: users.username, isAdmin: users.isAdmin })
		.from(users)
		.orderBy(users.username);
	const rows = await db
		.select({ userId: permissions.userId, level: permissions.level })
		.from(permissions)
		.where(eq(permissions.serverId, serverId));
	const byUser = new Map(rows.map((r) => [r.userId, r.level]));

	return allUsers.map((u) => ({
		userId: u.id,
		username: u.username,
		isAdmin: u.isAdmin,
		level: u.isAdmin ? 'operate' : (byUser.get(u.id) ?? 'none')
	}));
}
