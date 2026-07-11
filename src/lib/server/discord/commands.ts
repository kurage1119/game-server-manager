import {
	SlashCommandBuilder,
	MessageFlags,
	type ChatInputCommandInteraction,
	type AutocompleteInteraction,
	type RESTPostAPIChatInputApplicationCommandsJSONBody
} from 'discord.js';
import { getDb, type DB } from '../db';
import {
	listServersForChannel,
	startServerForChannel,
	stopServerForChannel,
	getServerStatusForChannel
} from '../services/serverService';
import { PermissionDeniedError } from '../services/errors';
import type { ServiceStatus } from '../systemctl';

const STATUS_LABELS: Record<ServiceStatus, string> = {
	active: '🟢 稼働中',
	inactive: '⚫ 停止',
	activating: '🟡 起動中…',
	deactivating: '🟡 停止中…',
	failed: '🔴 異常終了',
	unknown: '❓ 不明'
};

/** The single /server command with list/status/start/stop subcommands. */
export function buildCommands(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
	const command = new SlashCommandBuilder()
		.setName('server')
		.setDescription('ゲームサーバーの操作')
		.setDMPermission(false)
		.addSubcommand((sub) => sub.setName('list').setDescription('このチャンネルで操作できるサーバー一覧'))
		.addSubcommand((sub) =>
			sub
				.setName('status')
				.setDescription('サーバーの状態を確認')
				.addStringOption((opt) =>
					opt.setName('name').setDescription('サーバー名').setRequired(true).setAutocomplete(true)
				)
		)
		.addSubcommand((sub) =>
			sub
				.setName('start')
				.setDescription('サーバーを起動')
				.addStringOption((opt) =>
					opt.setName('name').setDescription('サーバー名').setRequired(true).setAutocomplete(true)
				)
		)
		.addSubcommand((sub) =>
			sub
				.setName('stop')
				.setDescription('サーバーを停止')
				.addStringOption((opt) =>
					opt.setName('name').setDescription('サーバー名').setRequired(true).setAutocomplete(true)
				)
		);
	return [command.toJSON()];
}

/** Autocomplete: only server names this channel is allowed to control. `db` is injectable for tests. */
export async function handleAutocomplete(
	interaction: AutocompleteInteraction,
	db: DB = getDb()
): Promise<void> {
	try {
		const focused = interaction.options.getFocused().toLowerCase();
		const allowed = await listServersForChannel(db, interaction.guildId, interaction.channelId);
		const choices = allowed
			.filter((s) => s.name.toLowerCase().includes(focused))
			.slice(0, 25)
			.map((s) => ({ name: s.name, value: s.name }));
		await interaction.respond(choices);
	} catch (e) {
		console.error('[discord] autocomplete failed:', e);
		// Autocomplete must answer within 3s; an empty list is the safe fallback.
		if (!interaction.responded) {
			await interaction.respond([]).catch(() => {});
		}
	}
}

export async function handleChatInput(
	interaction: ChatInputCommandInteraction,
	db: DB = getDb()
): Promise<void> {
	if (interaction.commandName !== 'server') return;

	const executor = interaction.user.tag ?? interaction.user.username;
	const sub = interaction.options.getSubcommand();

	try {
		// DMs have no guildId; every subcommand below requires channel authorization.
		if (!interaction.guildId || !interaction.channelId) {
			await interaction.reply({
				content: 'DMからは操作できません。許可されたサーバーのチャンネルで実行してください。',
				flags: MessageFlags.Ephemeral
			});
			return;
		}

		if (sub === 'list') {
			const allowed = await listServersForChannel(db, interaction.guildId, interaction.channelId);
			if (allowed.length === 0) {
				await interaction.reply({
					content: 'このチャンネルで操作できるサーバーはありません。',
					flags: MessageFlags.Ephemeral
				});
				return;
			}
			await interaction.reply(
				`このチャンネルで操作できるサーバー:\n${allowed.map((s) => `- ${s.name}`).join('\n')}`
			);
			return;
		}

		const name = interaction.options.getString('name', true);

		if (sub === 'status') {
			const { server, status } = await getServerStatusForChannel(
				db,
				interaction.guildId,
				interaction.channelId,
				name
			);
			console.log(`[discord] ${executor} checked status of ${server.name}: ${status}`);
			await interaction.reply(`**${server.name}**: ${STATUS_LABELS[status]}(実行: ${executor})`);
			return;
		}

		if (sub === 'start') {
			const server = await startServerForChannel(db, interaction.guildId, interaction.channelId, name);
			console.log(`[discord] ${executor} started ${server.name} (${server.unitName})`);
			await interaction.reply(`**${server.name}** の起動を要求しました。(実行: ${executor})`);
			return;
		}

		if (sub === 'stop') {
			const server = await stopServerForChannel(db, interaction.guildId, interaction.channelId, name);
			console.log(`[discord] ${executor} stopped ${server.name} (${server.unitName})`);
			await interaction.reply(`**${server.name}** の停止を要求しました。(実行: ${executor})`);
			return;
		}

		await interaction.reply({ content: '不明なサブコマンドです。', flags: MessageFlags.Ephemeral });
	} catch (e) {
		const message =
			e instanceof PermissionDeniedError ? e.message : 'エラーが発生しました。管理者に連絡してください。';
		if (!(e instanceof PermissionDeniedError)) {
			console.error(`[discord] /server ${sub} by ${executor} failed:`, e);
		} else {
			console.log(`[discord] denied /server ${sub} by ${executor} in ${interaction.guildId}/${interaction.channelId}`);
		}
		const payload = { content: message, flags: MessageFlags.Ephemeral } as const;
		if (interaction.deferred || interaction.replied) {
			await interaction.followUp(payload).catch(() => {});
		} else {
			await interaction.reply(payload).catch(() => {});
		}
	}
}
