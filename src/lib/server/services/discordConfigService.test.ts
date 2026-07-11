import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../db/testDb';
import { users } from '../db/schema';
import type { SessionUser } from '../auth/session';
import { createServer } from './serverService';
import {
	addChannel,
	removeChannel,
	listChannelsForServer,
	listDistinctGuildIds,
	isValidSnowflake
} from './discordConfigService';
import { PermissionDeniedError, NotFoundError, ValidationError } from './errors';

type TestDb = ReturnType<typeof createTestDb>;

const GUILD_A = '123456789012345678';
const GUILD_B = '223456789012345678';
const CHANNEL_1 = '323456789012345678';
const CHANNEL_2 = '423456789012345678';

async function insertUser(db: TestDb, username: string, isAdmin: boolean): Promise<SessionUser> {
	const [row] = await db
		.insert(users)
		.values({ username, passwordHash: 'x', isAdmin, mustChangePassword: false })
		.returning();
	return { id: row.id, username: row.username, isAdmin: row.isAdmin, mustChangePassword: false };
}

describe('discordConfigService', () => {
	let db: TestDb;
	let admin: SessionUser;
	let member: SessionUser;
	let serverId: number;

	beforeEach(async () => {
		db = createTestDb();
		admin = await insertUser(db, 'admin', true);
		member = await insertUser(db, 'member', false);
		const server = await createServer(db, admin, { name: 'mc', unitName: 'game-mc.service' });
		serverId = server.id;
	});

	it('adds, lists, and removes a channel', async () => {
		const row = await addChannel(db, admin, serverId, GUILD_A, CHANNEL_1);
		expect(row).toMatchObject({ serverId, guildId: GUILD_A, channelId: CHANNEL_1 });

		let list = await listChannelsForServer(db, admin, serverId);
		expect(list).toHaveLength(1);

		await removeChannel(db, admin, serverId, row.id);
		list = await listChannelsForServer(db, admin, serverId);
		expect(list).toHaveLength(0);
	});

	it('rejects duplicate (server, guild, channel) rows', async () => {
		await addChannel(db, admin, serverId, GUILD_A, CHANNEL_1);
		await expect(addChannel(db, admin, serverId, GUILD_A, CHANNEL_1)).rejects.toThrow(ValidationError);
	});

	it('allows the same channel on a different server (grant is per server)', async () => {
		const other = await createServer(db, admin, { name: 'valheim', unitName: 'game-valheim.service' });
		await addChannel(db, admin, serverId, GUILD_A, CHANNEL_1);
		await expect(addChannel(db, admin, other.id, GUILD_A, CHANNEL_1)).resolves.toMatchObject({
			serverId: other.id
		});
	});

	it('rejects malformed guild/channel ids', async () => {
		await expect(addChannel(db, admin, serverId, 'not-a-snowflake', CHANNEL_1)).rejects.toThrow(ValidationError);
		await expect(addChannel(db, admin, serverId, GUILD_A, '12ab')).rejects.toThrow(ValidationError);
		await expect(addChannel(db, admin, serverId, '', CHANNEL_1)).rejects.toThrow(ValidationError);
	});

	it('rejects adds to a nonexistent server and removes of a nonexistent row', async () => {
		await expect(addChannel(db, admin, 9999, GUILD_A, CHANNEL_1)).rejects.toThrow(NotFoundError);
		await expect(removeChannel(db, admin, serverId, 9999)).rejects.toThrow(NotFoundError);
	});

	it('scopes removal to the server: a row id from another server does not delete', async () => {
		const other = await createServer(db, admin, { name: 'valheim', unitName: 'game-valheim.service' });
		const row = await addChannel(db, admin, other.id, GUILD_A, CHANNEL_1);
		await expect(removeChannel(db, admin, serverId, row.id)).rejects.toThrow(NotFoundError);
		expect(await listChannelsForServer(db, admin, other.id)).toHaveLength(1);
	});

	it('rejects non-admin callers', async () => {
		await expect(addChannel(db, member, serverId, GUILD_A, CHANNEL_1)).rejects.toThrow(PermissionDeniedError);
		await expect(listChannelsForServer(db, member, serverId)).rejects.toThrow(PermissionDeniedError);
		await expect(removeChannel(db, member, serverId, 1)).rejects.toThrow(PermissionDeniedError);
	});

	it('listDistinctGuildIds deduplicates across servers and channels', async () => {
		const other = await createServer(db, admin, { name: 'valheim', unitName: 'game-valheim.service' });
		await addChannel(db, admin, serverId, GUILD_A, CHANNEL_1);
		await addChannel(db, admin, serverId, GUILD_A, CHANNEL_2);
		await addChannel(db, admin, other.id, GUILD_B, CHANNEL_1);

		expect(await listDistinctGuildIds(db)).toEqual([GUILD_A, GUILD_B]);
	});

	it('isValidSnowflake accepts numeric ids and rejects everything else', () => {
		expect(isValidSnowflake(GUILD_A)).toBe(true);
		expect(isValidSnowflake('1234')).toBe(false); // too short
		expect(isValidSnowflake('abc')).toBe(false);
		expect(isValidSnowflake('123 456')).toBe(false);
	});
});
