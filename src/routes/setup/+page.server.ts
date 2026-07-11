import { fail, redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import type { Actions } from './$types';
import { getDb } from '$lib/server/db';
import { createAdminUser } from '$lib/server/services/userService';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { ValidationError } from '$lib/server/services/errors';

const MIN_PASSWORD_LENGTH = 8;

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const username = String(form.get('username') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const passwordConfirm = String(form.get('passwordConfirm') ?? '');

		if (!username) {
			return fail(400, { error: 'ユーザー名を入力してください。', username });
		}
		if (password.length < MIN_PASSWORD_LENGTH) {
			return fail(400, {
				error: `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください。`,
				username
			});
		}
		if (password !== passwordConfirm) {
			return fail(400, { error: 'パスワードが一致しません。', username });
		}

		// hooks.server.ts guards this route while users=0, and createAdminUser
		// re-checks users=0 inside a transaction, so concurrent setup POSTs
		// cannot create a second admin (one of them gets ValidationError here).
		let user;
		try {
			user = await createAdminUser(getDb(), username, password);
		} catch (e) {
			if (e instanceof ValidationError) {
				return fail(400, { error: e.message, username });
			}
			return fail(400, { error: 'ユーザーの作成に失敗しました。', username });
		}

		const { token, expiresAt } = await createSession(getDb(), user.id);
		setSessionCookie(cookies, url.protocol === 'https:', token, expiresAt);

		throw redirect(303, `${base}/`);
	}
};
