import { eq, and } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { servers, permissions, discordChannels } from '../db/schema';
import type * as schema from '../db/schema';
import type { SessionUser } from '../auth/session';
import type { ServiceStatus, SystemctlDriver } from '../systemctl';
import { getSystemctlDriver, isValidUnitName } from '../systemctl';
import { PermissionDeniedError, NotFoundError, ValidationError } from './errors';

type DB = BetterSQLite3Database<typeof schema>;
export type PermissionLevel = 'view' | 'operate';

export interface ServerRecord {
	id: number;
	name: string;
	unitName: string;
	createdAt: string;
}

export interface ServerStatusEntry {
	id: number;
	name: string;
	status: ServiceStatus;
	canOperate: boolean;
}

/**
 * All permission checks live here (docs/implementation-plan.md: 権限チェックは
 * サービス層で実施), shared by web routes and — from Step 6 — the Discord bot.
 * Admins have full access; regular users need a permissions row:
 * 'operate' → status + start/stop, 'view' → status only, no row → invisible.
 */

async function getPermissionLevel(db: DB, actor: SessionUser, serverId: number): Promise<PermissionLevel | null> {
	if (actor.isAdmin) return 'operate';
	const rows = await db
		.select({ level: permissions.level })
		.from(permissions)
		.where(and(eq(permissions.userId, actor.id), eq(permissions.serverId, serverId)))
		.limit(1);
	return rows[0]?.level ?? null;
}

function assertAdmin(actor: SessionUser): void {
	if (!actor.isAdmin) {
		throw new PermissionDeniedError('この操作には管理者権限が必要です。');
	}
}

async function getServerOrThrow(db: DB, serverId: number): Promise<ServerRecord> {
	const rows = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
	if (!rows[0]) throw new NotFoundError('サーバーが見つかりません。');
	return rows[0];
}

// ---------------------------------------------------------------------------
// Admin CRUD
// ---------------------------------------------------------------------------

export async function listAllServers(db: DB, actor: SessionUser): Promise<ServerRecord[]> {
	assertAdmin(actor);
	return db.select().from(servers).orderBy(servers.name);
}

export async function getServerById(db: DB, actor: SessionUser, serverId: number): Promise<ServerRecord> {
	assertAdmin(actor);
	return getServerOrThrow(db, serverId);
}

function validateServerInput(name: string, unitName: string): void {
	if (!name.trim()) {
		throw new ValidationError('サーバー名を入力してください。');
	}
	if (!isValidUnitName(unitName)) {
		throw new ValidationError(
			'ユニット名は game-<英数字・ . _ @ - >.service 形式で入力してください(例: game-minecraft.service)。'
		);
	}
}

export async function createServer(
	db: DB,
	actor: SessionUser,
	input: { name: string; unitName: string }
): Promise<ServerRecord> {
	assertAdmin(actor);
	const name = input.name.trim();
	validateServerInput(name, input.unitName);
	try {
		const rows = await db.insert(servers).values({ name, unitName: input.unitName }).returning();
		return rows[0];
	} catch (e) {
		throw toUniqueViolationError(e);
	}
}

export async function updateServer(
	db: DB,
	actor: SessionUser,
	serverId: number,
	input: { name: string; unitName: string }
): Promise<ServerRecord> {
	assertAdmin(actor);
	await getServerOrThrow(db, serverId);
	const name = input.name.trim();
	validateServerInput(name, input.unitName);
	try {
		const rows = await db
			.update(servers)
			.set({ name, unitName: input.unitName })
			.where(eq(servers.id, serverId))
			.returning();
		return rows[0];
	} catch (e) {
		throw toUniqueViolationError(e);
	}
}

export async function deleteServer(db: DB, actor: SessionUser, serverId: number): Promise<void> {
	assertAdmin(actor);
	await getServerOrThrow(db, serverId);
	await db.delete(servers).where(eq(servers.id, serverId));
}

function toUniqueViolationError(e: unknown): Error {
	const message = e instanceof Error ? e.message : String(e);
	if (message.includes('UNIQUE constraint failed')) {
		return new ValidationError('同じ名前またはユニット名のサーバーが既に存在します。');
	}
	return e instanceof Error ? e : new Error(message);
}

// ---------------------------------------------------------------------------
// Visibility + operations (all logged-in users, filtered by permission)
// ---------------------------------------------------------------------------

/** Servers the actor can at least see, with live status and whether they may operate. */
export async function listVisibleServerStatuses(
	db: DB,
	actor: SessionUser,
	driver: SystemctlDriver = getSystemctlDriver()
): Promise<ServerStatusEntry[]> {
	let visible: { id: number; name: string; unitName: string; level: PermissionLevel }[];

	if (actor.isAdmin) {
		const rows = await db.select().from(servers).orderBy(servers.name);
		visible = rows.map((s) => ({ id: s.id, name: s.name, unitName: s.unitName, level: 'operate' as const }));
	} else {
		visible = await db
			.select({
				id: servers.id,
				name: servers.name,
				unitName: servers.unitName,
				level: permissions.level
			})
			.from(permissions)
			.innerJoin(servers, eq(permissions.serverId, servers.id))
			.where(eq(permissions.userId, actor.id))
			.orderBy(servers.name);
	}

	return Promise.all(
		visible.map(async (s) => ({
			id: s.id,
			name: s.name,
			status: await safeStatus(driver, s.unitName),
			canOperate: s.level === 'operate'
		}))
	);
}

async function safeStatus(driver: SystemctlDriver, unitName: string): Promise<ServiceStatus> {
	try {
		return await driver.status(unitName);
	} catch {
		// A single broken unit (e.g. invalid name that slipped into the DB) must not
		// take down the whole dashboard; surface it as 'unknown'.
		return 'unknown';
	}
}

export async function startServer(
	db: DB,
	actor: SessionUser,
	serverId: number,
	driver: SystemctlDriver = getSystemctlDriver()
): Promise<void> {
	const level = await getPermissionLevel(db, actor, serverId);
	if (level !== 'operate') {
		throw new PermissionDeniedError('このサーバーを操作する権限がありません。');
	}
	const server = await getServerOrThrow(db, serverId);
	await driver.start(server.unitName);
}

export async function stopServer(
	db: DB,
	actor: SessionUser,
	serverId: number,
	driver: SystemctlDriver = getSystemctlDriver()
): Promise<void> {
	const level = await getPermissionLevel(db, actor, serverId);
	if (level !== 'operate') {
		throw new PermissionDeniedError('このサーバーを操作する権限がありません。');
	}
	const server = await getServerOrThrow(db, serverId);
	await driver.stop(server.unitName);
}

export async function getServerStatus(
	db: DB,
	actor: SessionUser,
	serverId: number,
	driver: SystemctlDriver = getSystemctlDriver()
): Promise<ServiceStatus> {
	const level = await getPermissionLevel(db, actor, serverId);
	if (level === null) {
		// No permission row = the server is invisible to this user.
		throw new PermissionDeniedError('このサーバーを閲覧する権限がありません。');
	}
	const server = await getServerOrThrow(db, serverId);
	return safeStatus(driver, server.unitName);
}

// ---------------------------------------------------------------------------
// Discord bot entry points (Step 6)
//
// Authorization model per docs/implementation-plan.md: a Discord channel is
// the permission unit. A (guildId, channelId) row in discord_channels grants
// full 'operate'-equivalent access to that server from that channel; no row =
// invisible. DMs (guildId null) are always denied. Kept in this module so ALL
// server authorization decisions — web and bot — live in one file.
// ---------------------------------------------------------------------------

/** Servers this channel is allowed to control (empty for DMs / unlisted channels). */
export async function listServersForChannel(
	db: DB,
	guildId: string | null,
	channelId: string | null
): Promise<ServerRecord[]> {
	if (!guildId || !channelId) return [];
	return db
		.select({ id: servers.id, name: servers.name, unitName: servers.unitName, createdAt: servers.createdAt })
		.from(discordChannels)
		.innerJoin(servers, eq(discordChannels.serverId, servers.id))
		.where(and(eq(discordChannels.guildId, guildId), eq(discordChannels.channelId, channelId)))
		.orderBy(servers.name);
}

/**
 * Resolves a server by name IF this channel is authorized for it.
 * Throws PermissionDeniedError otherwise (covers both "server exists but this
 * channel may not touch it" and "no such server" — a channel should not be able
 * to probe which server names exist).
 */
export async function getServerForChannel(
	db: DB,
	guildId: string | null,
	channelId: string | null,
	serverName: string
): Promise<ServerRecord> {
	if (!guildId || !channelId) {
		throw new PermissionDeniedError('DMからは操作できません。許可されたサーバーのチャンネルで実行してください。');
	}
	const rows = await db
		.select({ id: servers.id, name: servers.name, unitName: servers.unitName, createdAt: servers.createdAt })
		.from(discordChannels)
		.innerJoin(servers, eq(discordChannels.serverId, servers.id))
		.where(
			and(
				eq(discordChannels.guildId, guildId),
				eq(discordChannels.channelId, channelId),
				eq(servers.name, serverName)
			)
		)
		.limit(1);
	if (!rows[0]) {
		throw new PermissionDeniedError('このチャンネルでは指定されたサーバーを操作できません。');
	}
	return rows[0];
}

export async function startServerForChannel(
	db: DB,
	guildId: string | null,
	channelId: string | null,
	serverName: string,
	driver: SystemctlDriver = getSystemctlDriver()
): Promise<ServerRecord> {
	const server = await getServerForChannel(db, guildId, channelId, serverName);
	await driver.start(server.unitName);
	return server;
}

export async function stopServerForChannel(
	db: DB,
	guildId: string | null,
	channelId: string | null,
	serverName: string,
	driver: SystemctlDriver = getSystemctlDriver()
): Promise<ServerRecord> {
	const server = await getServerForChannel(db, guildId, channelId, serverName);
	await driver.stop(server.unitName);
	return server;
}

export async function getServerStatusForChannel(
	db: DB,
	guildId: string | null,
	channelId: string | null,
	serverName: string,
	driver: SystemctlDriver = getSystemctlDriver()
): Promise<{ server: ServerRecord; status: ServiceStatus }> {
	const server = await getServerForChannel(db, guildId, channelId, serverName);
	return { server, status: await safeStatus(driver, server.unitName) };
}
