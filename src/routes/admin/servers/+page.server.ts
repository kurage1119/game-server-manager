import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { listAllServers, createServer } from '$lib/server/services/serverService';
import { buildUnitName, isValidUnitBase } from '$lib/server/systemctl';
import { ValidationError, PermissionDeniedError } from '$lib/server/services/errors';

const UNIT_BASE_ERROR = 'ユニット名は英数字と . _ @ - のみで入力してください(例: minecraft)。';

export const load: PageServerLoad = async ({ locals }) => {
	// hooks.server.ts guard 4 guarantees locals.user is an admin here.
	const servers = await listAllServers(getDb(), locals.user!);
	return { servers };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '');
		const unitBase = String(form.get('unitBase') ?? '').trim();

		if (!isValidUnitBase(unitBase)) {
			return fail(400, { error: UNIT_BASE_ERROR, name, unitBase });
		}

		try {
			await createServer(getDb(), locals.user!, { name, unitName: buildUnitName(unitBase) });
		} catch (e) {
			if (e instanceof ValidationError) {
				return fail(400, { error: e.message, name, unitBase });
			}
			if (e instanceof PermissionDeniedError) {
				return fail(403, { error: e.message, name, unitBase });
			}
			throw e;
		}
		return { created: true };
	}
};
