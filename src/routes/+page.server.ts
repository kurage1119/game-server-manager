import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { listVisibleServerStatuses, startServer, stopServer } from '$lib/server/services/serverService';
import { PermissionDeniedError, NotFoundError } from '$lib/server/services/errors';

export const load: PageServerLoad = async ({ locals }) => {
	const servers = await listVisibleServerStatuses(getDb(), locals.user!);
	return { servers };
};

function parseServerId(form: FormData): number | null {
	const id = Number(form.get('serverId'));
	return Number.isInteger(id) && id > 0 ? id : null;
}

export const actions: Actions = {
	start: async ({ request, locals }) => {
		const serverId = parseServerId(await request.formData());
		if (serverId === null) return fail(400, { error: 'サーバーの指定が不正です。' });

		try {
			await startServer(getDb(), locals.user!, serverId);
		} catch (e) {
			if (e instanceof PermissionDeniedError) return fail(403, { error: e.message });
			if (e instanceof NotFoundError) return fail(404, { error: e.message });
			// systemctl 由来の実行失敗はユーザー操作の一部なのでエラーページではなくバナーで返す
			console.error(`[web] start action failed for serverId=${serverId}:`, e);
			return fail(500, { error: 'サーバーの起動に失敗しました。時間をおいて再度お試しください。' });
		}
		return { message: '起動を要求しました。' };
	},

	stop: async ({ request, locals }) => {
		const serverId = parseServerId(await request.formData());
		if (serverId === null) return fail(400, { error: 'サーバーの指定が不正です。' });

		try {
			await stopServer(getDb(), locals.user!, serverId);
		} catch (e) {
			if (e instanceof PermissionDeniedError) return fail(403, { error: e.message });
			if (e instanceof NotFoundError) return fail(404, { error: e.message });
			console.error(`[web] stop action failed for serverId=${serverId}:`, e);
			return fail(500, { error: 'サーバーの停止に失敗しました。時間をおいて再度お試しください。' });
		}
		return { message: '停止を要求しました。' };
	}
};
