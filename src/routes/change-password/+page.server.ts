import { fail, redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { verifyCredentials, updatePassword } from '$lib/server/services/userService';

const MIN_PASSWORD_LENGTH = 8;

export const load: PageServerLoad = async ({ locals }) => {
	// hooks.server.ts already guarantees an authenticated user reaches this route.
	return { mustChangePassword: locals.user?.mustChangePassword ?? false };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) {
			// Defense in depth: hooks.server.ts already blocks anonymous access here.
			throw redirect(303, `${base}/login`);
		}

		const form = await request.formData();
		const currentPassword = String(form.get('currentPassword') ?? '');
		const newPassword = String(form.get('newPassword') ?? '');
		const newPasswordConfirm = String(form.get('newPasswordConfirm') ?? '');

		if (newPassword.length < MIN_PASSWORD_LENGTH) {
			return fail(400, { error: `新しいパスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください。` });
		}
		if (newPassword !== newPasswordConfirm) {
			return fail(400, { error: '新しいパスワードが一致しません。' });
		}

		const verified = await verifyCredentials(getDb(), user.username, currentPassword);
		if (!verified) {
			return fail(400, { error: '現在のパスワードが正しくありません。' });
		}

		await updatePassword(getDb(), user.id, newPassword);

		throw redirect(303, `${base}/`);
	}
};
