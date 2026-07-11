import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { SESSION_COOKIE_NAME, invalidateSession, clearSessionCookie } from '$lib/server/auth/session';

// POST-only by design (docs/implementation-plan.md route table): logging out has
// no GET view, it's just a form action target from the dashboard header.
export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(SESSION_COOKIE_NAME);
	if (token) {
		await invalidateSession(getDb(), token);
	}
	clearSessionCookie(cookies);

	throw redirect(303, '/login');
};
