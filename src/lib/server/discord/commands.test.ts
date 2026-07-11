import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageFlags, type ChatInputCommandInteraction, type AutocompleteInteraction } from 'discord.js';
import { createTestDb } from '../db/testDb';
import { users } from '../db/schema';
import type { SessionUser } from '../auth/session';
import { createServer } from '../services/serverService';
import { addChannel } from '../services/discordConfigService';
import { handleChatInput, handleAutocomplete } from './commands';
import type { DB } from '../db';

type TestDb = ReturnType<typeof createTestDb>;

const GUILD = '123456789012345678';
const ALLOWED_CHANNEL = '323456789012345678';
const OTHER_CHANNEL = '423456789012345678';

interface FakeChatInteraction {
	commandName: string;
	guildId: string | null;
	channelId: string | null;
	user: { tag: string; username: string };
	options: { getSubcommand: () => string; getString: (name: string, required?: boolean) => string };
	reply: ReturnType<typeof vi.fn>;
	deferred: boolean;
	replied: boolean;
}

function fakeChatInteraction(
	sub: string,
	name: string,
	guildId: string | null,
	channelId: string | null
): FakeChatInteraction {
	return {
		commandName: 'server',
		guildId,
		channelId,
		user: { tag: 'taro#1234', username: 'taro' },
		options: {
			getSubcommand: () => sub,
			getString: () => name
		},
		reply: vi.fn(async () => {}),
		deferred: false,
		replied: false
	};
}

function asChat(i: FakeChatInteraction): ChatInputCommandInteraction {
	return i as unknown as ChatInputCommandInteraction;
}

async function seed(db: TestDb): Promise<void> {
	const [row] = await db
		.insert(users)
		.values({ username: 'admin', passwordHash: 'x', isAdmin: true, mustChangePassword: false })
		.returning();
	const admin: SessionUser = { id: row.id, username: 'admin', isAdmin: true, mustChangePassword: false };
	const mc = await createServer(db, admin, { name: 'mc', unitName: 'game-mc.service' });
	await addChannel(db, admin, mc.id, GUILD, ALLOWED_CHANNEL);
}

describe('handleChatInput failure paths', () => {
	let db: TestDb;

	beforeEach(async () => {
		db = createTestDb();
		await seed(db);
	});

	it('rejects DMs (guildId null) with an ephemeral reply and no side effects', async () => {
		const interaction = fakeChatInteraction('start', 'mc', null, null);
		await handleChatInput(asChat(interaction), db);

		expect(interaction.reply).toHaveBeenCalledTimes(1);
		const payload = interaction.reply.mock.calls[0][0];
		expect(payload.flags).toBe(MessageFlags.Ephemeral);
		expect(payload.content).toContain('DM');
	});

	it('rejects an unauthorized channel with an ephemeral permission message', async () => {
		const interaction = fakeChatInteraction('start', 'mc', GUILD, OTHER_CHANNEL);
		await handleChatInput(asChat(interaction), db);

		expect(interaction.reply).toHaveBeenCalledTimes(1);
		const payload = interaction.reply.mock.calls[0][0];
		expect(payload.flags).toBe(MessageFlags.Ephemeral);
		expect(payload.content).toContain('このチャンネルでは指定されたサーバーを操作できません。');
	});

	it('tells an authorized channel with no matching server the same denial (no name probing)', async () => {
		const interaction = fakeChatInteraction('status', 'ghost', GUILD, ALLOWED_CHANNEL);
		await handleChatInput(asChat(interaction), db);

		const payload = interaction.reply.mock.calls[0][0];
		expect(payload.flags).toBe(MessageFlags.Ephemeral);
		expect(payload.content).toContain('このチャンネルでは指定されたサーバーを操作できません。');
	});

	it('answers /server list in an unauthorized channel with an ephemeral empty-list message', async () => {
		const interaction = fakeChatInteraction('list', '', GUILD, OTHER_CHANNEL);
		await handleChatInput(asChat(interaction), db);

		const payload = interaction.reply.mock.calls[0][0];
		expect(payload.flags).toBe(MessageFlags.Ephemeral);
		expect(payload.content).toContain('このチャンネルで操作できるサーバーはありません。');
	});
});

describe('handleAutocomplete', () => {
	let db: TestDb;

	beforeEach(async () => {
		db = createTestDb();
		await seed(db);
	});

	function fakeAutocomplete(guildId: string | null, channelId: string | null, focused = '') {
		return {
			guildId,
			channelId,
			responded: false,
			options: { getFocused: () => focused },
			respond: vi.fn(async () => {})
		};
	}

	it('suggests only servers the channel is authorized for', async () => {
		const interaction = fakeAutocomplete(GUILD, ALLOWED_CHANNEL, 'm');
		await handleAutocomplete(interaction as unknown as AutocompleteInteraction, db);
		expect(interaction.respond).toHaveBeenCalledWith([{ name: 'mc', value: 'mc' }]);
	});

	it('suggests nothing for an unauthorized channel', async () => {
		const interaction = fakeAutocomplete(GUILD, OTHER_CHANNEL);
		await handleAutocomplete(interaction as unknown as AutocompleteInteraction, db);
		expect(interaction.respond).toHaveBeenCalledWith([]);
	});

	it('falls back to an empty suggestion list when the lookup throws', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const interaction = fakeAutocomplete(GUILD, ALLOWED_CHANNEL);
			// A db whose .select explodes simulates any unexpected backend failure.
			const brokenDb = {} as DB;
			await handleAutocomplete(interaction as unknown as AutocompleteInteraction, brokenDb);
			expect(interaction.respond).toHaveBeenCalledWith([]);
		} finally {
			consoleError.mockRestore();
		}
	});
});
