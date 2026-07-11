import { fail, redirect, error } from '@sveltejs/kit';
import { base } from '$app/paths';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { getServerById, updateServer, deleteServer } from '$lib/server/services/serverService';
import { buildUnitName, isValidUnitBase, unitNameBase } from '$lib/server/systemctl';
import { listPermissionsForServer, setPermission, isPermissionSetting } from '$lib/server/services/permissionService';
import { listChannelsForServer, addChannel, removeChannel } from '$lib/server/services/discordConfigService';
import { requestCommandResync } from '$lib/server/discord/bot';
import { ValidationError, PermissionDeniedError, NotFoundError } from '$lib/server/services/errors';

function parseServerId(param: string): number {
	const id = Number(param);
	if (!Number.isInteger(id) || id <= 0) {
		throw error(404, 'サーバーが見つかりません。');
	}
	return id;
}

function toFailure(e: unknown) {
	if (e instanceof ValidationError) return fail(400, { error: e.message });
	if (e instanceof NotFoundError) return fail(404, { error: e.message });
	if (e instanceof PermissionDeniedError) return fail(403, { error: e.message });
	throw e;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const serverId = parseServerId(params.id);
	try {
		const server = await getServerById(getDb(), locals.user!, serverId);
		const permissions = await listPermissionsForServer(getDb(), locals.user!, serverId);
		const discordChannels = await listChannelsForServer(getDb(), locals.user!, serverId);
		return { server, unitBase: unitNameBase(server.unitName), permissions, discordChannels };
	} catch (e) {
		if (e instanceof NotFoundError) throw error(404, e.message);
		throw e;
	}
};

export const actions: Actions = {
	update: async ({ request, params, locals }) => {
		const serverId = parseServerId(params.id);
		const form = await request.formData();
		const name = String(form.get('name') ?? '');
		const unitBase = String(form.get('unitBase') ?? '').trim();

		if (!isValidUnitBase(unitBase)) {
			return fail(400, { error: 'ユニット名は英数字と . _ @ - のみで入力してください(例: minecraft)。' });
		}

		try {
			await updateServer(getDb(), locals.user!, serverId, { name, unitName: buildUnitName(unitBase) });
		} catch (e) {
			return toFailure(e);
		}
		return { updated: true };
	},

	delete: async ({ params, locals }) => {
		const serverId = parseServerId(params.id);
		try {
			await deleteServer(getDb(), locals.user!, serverId);
		} catch (e) {
			return toFailure(e);
		}
		// Removing a server also removes its channel grants (FK cascade) — commands
		// may need to disappear from now-unlisted guilds.
		requestCommandResync();
		throw redirect(303, `${base}/admin/servers`);
	},

	setPermission: async ({ request, params, locals }) => {
		const serverId = parseServerId(params.id);
		const form = await request.formData();
		const userId = Number(form.get('userId'));
		const level = String(form.get('level') ?? '');

		if (!Number.isInteger(userId) || userId <= 0 || !isPermissionSetting(level)) {
			return fail(400, { error: '権限設定の入力が不正です。' });
		}

		try {
			await setPermission(getDb(), locals.user!, userId, serverId, level);
		} catch (e) {
			return toFailure(e);
		}
		return { permissionUpdated: true };
	},

	addDiscordChannel: async ({ request, params, locals }) => {
		const serverId = parseServerId(params.id);
		const form = await request.formData();
		const guildId = String(form.get('guildId') ?? '').trim();
		const channelId = String(form.get('channelId') ?? '').trim();

		try {
			await addChannel(getDb(), locals.user!, serverId, guildId, channelId);
		} catch (e) {
			return toFailure(e);
		}
		requestCommandResync();
		return { discordUpdated: true };
	},

	removeDiscordChannel: async ({ request, params, locals }) => {
		const serverId = parseServerId(params.id);
		const form = await request.formData();
		const rowId = Number(form.get('rowId'));
		if (!Number.isInteger(rowId) || rowId <= 0) {
			return fail(400, { error: 'チャンネル設定の指定が不正です。' });
		}

		try {
			await removeChannel(getDb(), locals.user!, serverId, rowId);
		} catch (e) {
			return toFailure(e);
		}
		requestCommandResync();
		return { discordUpdated: true };
	}
};
