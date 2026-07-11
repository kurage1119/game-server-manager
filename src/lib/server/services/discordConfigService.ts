import { eq, and } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { discordChannels, servers } from '../db/schema';
import type * as schema from '../db/schema';
import type { SessionUser } from '../auth/session';
import { PermissionDeniedError, NotFoundError, ValidationError } from './errors';

type DB = BetterSQLite3Database<typeof schema>;

export interface DiscordChannelRow {
	id: number;
	serverId: number;
	guildId: string;
	channelId: string;
}

// Discord snowflakes are numeric strings, historically 17-20 digits; accept a
// slightly wider window so this doesn't break as snowflakes grow.
const SNOWFLAKE_PATTERN = /^\d{5,25}$/;

export function isValidSnowflake(value: string): boolean {
	return SNOWFLAKE_PATTERN.test(value);
}

function assertAdmin(actor: SessionUser): void {
	if (!actor.isAdmin) {
		throw new PermissionDeniedError('この操作には管理者権限が必要です。');
	}
}

/** Allowed Discord channels for one server (admin screen). */
export async function listChannelsForServer(
	db: DB,
	actor: SessionUser,
	serverId: number
): Promise<DiscordChannelRow[]> {
	assertAdmin(actor);
	return db.select().from(discordChannels).where(eq(discordChannels.serverId, serverId));
}

export async function addChannel(
	db: DB,
	actor: SessionUser,
	serverId: number,
	guildId: string,
	channelId: string
): Promise<DiscordChannelRow> {
	assertAdmin(actor);

	if (!isValidSnowflake(guildId) || !isValidSnowflake(channelId)) {
		throw new ValidationError('DiscordサーバーIDとチャンネルIDは数字のみのID(スノーフレーク)で入力してください。');
	}

	const [server] = await db.select({ id: servers.id }).from(servers).where(eq(servers.id, serverId)).limit(1);
	if (!server) throw new NotFoundError('サーバーが見つかりません。');

	try {
		const rows = await db.insert(discordChannels).values({ serverId, guildId, channelId }).returning();
		return rows[0];
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		if (message.includes('UNIQUE constraint failed')) {
			throw new ValidationError('このチャンネルは既に登録されています。');
		}
		throw e;
	}
}

export async function removeChannel(db: DB, actor: SessionUser, serverId: number, rowId: number): Promise<void> {
	assertAdmin(actor);
	// Scope the delete to the server whose page issued it, so a stale/forged row id
	// can't remove another server's channel grant.
	const result = await db
		.delete(discordChannels)
		.where(and(eq(discordChannels.id, rowId), eq(discordChannels.serverId, serverId)))
		.returning({ id: discordChannels.id });
	if (result.length === 0) {
		throw new NotFoundError('チャンネル設定が見つかりません。');
	}
}

/**
 * Distinct guild ids that have at least one allowed channel — the set of guilds
 * slash commands must be registered in. Internal (bot sync), no actor required.
 */
export async function listDistinctGuildIds(db: DB): Promise<string[]> {
	const rows = await db
		.selectDistinct({ guildId: discordChannels.guildId })
		.from(discordChannels)
		.orderBy(discordChannels.guildId);
	return rows.map((r) => r.guildId);
}
