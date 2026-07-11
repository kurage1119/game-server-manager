import { Client, GatewayIntentBits, Events } from 'discord.js';
import { handleChatInput, handleAutocomplete } from './commands';
import { syncGuildCommands } from './register';

// Survives Vite dev-server HMR module reloads: the flag lives on globalThis, so a
// re-evaluated module sees the already-running client and won't start a second one.
const GLOBAL_KEY = Symbol.for('server-manager.discord.client');

type GlobalWithBot = typeof globalThis & { [GLOBAL_KEY]?: Client };

/**
 * Starts the Discord bot in the same process as SvelteKit (shared DB/services,
 * one systemd unit — docs/implementation-plan.md 技術選定). No-op without
 * DISCORD_TOKEN so Discord-less deployments and local dev just work.
 * Never throws: a broken bot must not take the web app down.
 */
export async function startBot(): Promise<void> {
	const token = process.env.DISCORD_TOKEN;
	if (!token) {
		console.log('[discord] DISCORD_TOKEN is not set — bot startup skipped.');
		return;
	}

	const g = globalThis as GlobalWithBot;
	if (g[GLOBAL_KEY]) {
		console.log('[discord] bot already running — skipping duplicate start (HMR).');
		return;
	}

	try {
		const client = new Client({ intents: [GatewayIntentBits.Guilds] });
		g[GLOBAL_KEY] = client;

		client.once(Events.ClientReady, async (readyClient) => {
			console.log(`[discord] logged in as ${readyClient.user.tag}`);
			try {
				await syncGuildCommands(readyClient);
			} catch (e) {
				console.error('[discord] initial command sync failed:', e);
			}
		});

		client.on(Events.InteractionCreate, async (interaction) => {
			try {
				if (interaction.isChatInputCommand()) {
					await handleChatInput(interaction);
				} else if (interaction.isAutocomplete()) {
					await handleAutocomplete(interaction);
				}
			} catch (e) {
				// Handlers do their own error replies; this is the last-resort net so an
				// unexpected throw can never propagate into the web process.
				console.error('[discord] unhandled interaction error:', e);
			}
		});

		client.on(Events.Error, (e) => {
			console.error('[discord] client error:', e);
		});

		await client.login(token);
	} catch (e) {
		console.error('[discord] bot failed to start (web app continues without it):', e);
		delete g[GLOBAL_KEY];
	}
}

/**
 * Re-syncs slash-command registration after the admin UI changes the allowed
 * channels. Fire-and-forget from route actions; safe no-op when the bot isn't
 * running (no token / failed startup).
 */
export function requestCommandResync(): void {
	const g = globalThis as GlobalWithBot;
	const client = g[GLOBAL_KEY];
	if (!client || !client.isReady()) return;
	syncGuildCommands(client).catch((e) => {
		console.error('[discord] command resync failed:', e);
	});
}
