import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../db/testDb';
import { users } from '../db/schema';
import type { SessionUser } from '../auth/session';
import { MockSystemctlDriver } from '../systemctl/mock';
import {
	createServer,
	listServersForChannel,
	getServerForChannel,
	startServerForChannel,
	stopServerForChannel,
	getServerStatusForChannel
} from './serverService';
import { addChannel } from './discordConfigService';
import { PermissionDeniedError } from './errors';

type TestDb = ReturnType<typeof createTestDb>;

const GUILD = '123456789012345678';
const ALLOWED_CHANNEL = '323456789012345678';
const OTHER_CHANNEL = '423456789012345678';
const OTHER_GUILD = '523456789012345678';

async function insertAdmin(db: TestDb): Promise<SessionUser> {
	const [row] = await db
		.insert(users)
		.values({ username: 'admin', passwordHash: 'x', isAdmin: true, mustChangePassword: false })
		.returning();
	return { id: row.id, username: row.username, isAdmin: true, mustChangePassword: false };
}

describe('serverService Discord-channel authorization', () => {
	let db: TestDb;
	let driver: MockSystemctlDriver;

	beforeEach(async () => {
		db = createTestDb();
		driver = new MockSystemctlDriver();
		const admin = await insertAdmin(db);
		const mc = await createServer(db, admin, { name: 'mc', unitName: 'game-mc.service' });
		await createServer(db, admin, { name: 'valheim', unitName: 'game-valheim.service' });
		await addChannel(db, admin, mc.id, GUILD, ALLOWED_CHANNEL);
	});

	describe('listServersForChannel (autocomplete / list source)', () => {
		it('returns only the servers granted to that exact (guild, channel)', async () => {
			const list = await listServersForChannel(db, GUILD, ALLOWED_CHANNEL);
			expect(list.map((s) => s.name)).toEqual(['mc']);
		});

		it('returns nothing for an unlisted channel, wrong guild, or DM', async () => {
			expect(await listServersForChannel(db, GUILD, OTHER_CHANNEL)).toEqual([]);
			expect(await listServersForChannel(db, OTHER_GUILD, ALLOWED_CHANNEL)).toEqual([]);
			expect(await listServersForChannel(db, null, ALLOWED_CHANNEL)).toEqual([]);
			expect(await listServersForChannel(db, GUILD, null)).toEqual([]);
		});
	});

	describe('getServerForChannel / start / stop / status', () => {
		it('allows an authorized channel to start, stop, and read status', async () => {
			const started = await startServerForChannel(db, GUILD, ALLOWED_CHANNEL, 'mc', driver);
			expect(started.name).toBe('mc');
			let { status } = await getServerStatusForChannel(db, GUILD, ALLOWED_CHANNEL, 'mc', driver);
			expect(status).toBe('activating');

			await stopServerForChannel(db, GUILD, ALLOWED_CHANNEL, 'mc', driver);
			({ status } = await getServerStatusForChannel(db, GUILD, ALLOWED_CHANNEL, 'mc', driver));
			expect(status).toBe('deactivating');
		});

		it('denies a server the channel has no grant for (even though it exists)', async () => {
			await expect(startServerForChannel(db, GUILD, ALLOWED_CHANNEL, 'valheim', driver)).rejects.toThrow(
				PermissionDeniedError
			);
		});

		it('denies a nonexistent server name with the same error (no name probing)', async () => {
			await expect(getServerForChannel(db, GUILD, ALLOWED_CHANNEL, 'ghost')).rejects.toThrow(
				PermissionDeniedError
			);
		});

		it('denies an unlisted channel and the wrong guild', async () => {
			await expect(startServerForChannel(db, GUILD, OTHER_CHANNEL, 'mc', driver)).rejects.toThrow(
				PermissionDeniedError
			);
			await expect(startServerForChannel(db, OTHER_GUILD, ALLOWED_CHANNEL, 'mc', driver)).rejects.toThrow(
				PermissionDeniedError
			);
		});

		it('denies DMs outright (guildId null)', async () => {
			await expect(startServerForChannel(db, null, ALLOWED_CHANNEL, 'mc', driver)).rejects.toThrow(
				PermissionDeniedError
			);
			await expect(getServerStatusForChannel(db, null, null, 'mc', driver)).rejects.toThrow(
				PermissionDeniedError
			);
		});
	});
});
