import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { listVisibleServerStatuses } from '$lib/server/services/serverService';

/** Status polling endpoint for the dashboard (5s interval while visible). */
export const GET: RequestHandler = async ({ locals }) => {
	// hooks.server.ts guard 2 already returns 401 JSON for unauthenticated /api/*.
	const servers = await listVisibleServerStatuses(getDb(), locals.user!);
	return json({ servers });
};
