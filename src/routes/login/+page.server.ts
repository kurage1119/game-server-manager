import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { getDb } from '$lib/server/db';
import { verifyCredentials } from '$lib/server/services/userService';
import { createSession, setSessionCookie } from '$lib/server/auth/session';

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const username = String(form.get('username') ?? '').trim();
		const password = String(form.get('password') ?? '');

		if (!username || !password) {
			return fail(400, { error: 'ユーザー名とパスワードを入力してください。', username });
		}

		const user = await verifyCredentials(getDb(), username, password);
		if (!user) {
			return fail(400, { error: 'ユーザー名またはパスワードが正しくありません。', username });
		}

		const { token, expiresAt } = await createSession(getDb(), user.id);
		setSessionCookie(cookies, url.protocol === 'https:', token, expiresAt);

		throw redirect(303, '/');
	}
};
