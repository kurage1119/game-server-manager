import { REST, Routes, type Client } from 'discord.js';
import { getDb } from '../db';
import { listDistinctGuildIds } from '../services/discordConfigService';
import { buildCommands } from './commands';

/**
 * Guild-scoped command registration (instant propagation; commands only appear
 * in guilds that have at least one allowed channel). Called on bot ready and
 * again whenever the admin UI changes discord_channels — the full sync is
 * idempotent and self-healing, so we never track registration state ourselves.
 */
export async function syncGuildCommands(client: Client<true>): Promise<void> {
	const token = client.token;
	const applicationId = client.application.id;
	const rest = new REST().setToken(token);

	const wantedGuildIds = new Set(await listDistinctGuildIds(getDb()));
	const commands = buildCommands();

	// Register (overwrite) in every guild that should have the commands.
	for (const guildId of wantedGuildIds) {
		try {
			await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: commands });
			console.log(`[discord] commands registered in guild ${guildId}`);
		} catch (e) {
			// Common cause: bot not invited to that guild yet. Not fatal for the rest.
			console.error(`[discord] failed to register commands in guild ${guildId}:`, e);
		}
	}

	// De-register from joined guilds that no longer have any allowed channel.
	for (const [guildId] of client.guilds.cache) {
		if (wantedGuildIds.has(guildId)) continue;
		try {
			await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: [] });
			console.log(`[discord] commands removed from guild ${guildId} (no allowed channels)`);
		} catch (e) {
			console.error(`[discord] failed to remove commands from guild ${guildId}:`, e);
		}
	}
}
