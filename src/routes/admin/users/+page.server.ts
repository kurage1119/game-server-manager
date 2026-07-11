import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import {
	listUsers,
	createUserWithTempPassword,
	reissueTempPassword,
	deleteUser
} from '$lib/server/services/userService';
import { ValidationError, PermissionDeniedError, NotFoundError } from '$lib/server/services/errors';

export const load: PageServerLoad = async ({ locals }) => {
	// hooks.server.ts guard 4 guarantees locals.user is an admin here.
	const users = await listUsers(getDb(), locals.user!);
	return { users };
};

function toFailure(e: unknown) {
	if (e instanceof ValidationError) return fail(400, { error: e.message });
	if (e instanceof NotFoundError) return fail(404, { error: e.message });
	if (e instanceof PermissionDeniedError) return fail(403, { error: e.message });
	throw e;
}

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		const username = String(form.get('username') ?? '');
		const isAdmin = form.get('isAdmin') === 'on';

		try {
			const { user, tempPassword } = await createUserWithTempPassword(getDb(), locals.user!, username, isAdmin);
			// The plaintext temp password crosses the wire exactly once, here.
			return { tempPassword, tempPasswordFor: user.username };
		} catch (e) {
			return toFailure(e);
		}
	},

	reissuePassword: async ({ request, locals }) => {
		const form = await request.formData();
		const userId = Number(form.get('userId'));
		if (!Number.isInteger(userId) || userId <= 0) {
			return fail(400, { error: '対象ユーザーの指定が不正です。' });
		}

		try {
			// username comes back from the DB — never from a client-supplied field.
			const { tempPassword, username } = await reissueTempPassword(getDb(), locals.user!, userId);
			return { tempPassword, tempPasswordFor: username };
		} catch (e) {
			return toFailure(e);
		}
	},

	delete: async ({ request, locals }) => {
		const form = await request.formData();
		const userId = Number(form.get('userId'));
		if (!Number.isInteger(userId) || userId <= 0) {
			return fail(400, { error: '対象ユーザーの指定が不正です。' });
		}

		try {
			await deleteUser(getDb(), locals.user!, userId);
			return { deleted: true };
		} catch (e) {
			return toFailure(e);
		}
	}
};
