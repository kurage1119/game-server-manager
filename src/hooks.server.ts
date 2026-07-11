import type { Handle, ServerInit } from '@sveltejs/kit';
import { building } from '$app/environment';
import { getDb } from '$lib/server/db';
import { applySessionAndGuards } from '$lib/server/auth/guards';
import { startBot } from '$lib/server/discord/bot';

/** Runs once at server startup (dev and production). Bot startup never throws. */
export const init: ServerInit = async () => {
	if (building) return;
	await startBot();
};

// Guard chain lives in $lib/server/auth/guards.ts (unit-tested there); this file
// only wires it to SvelteKit. getDb() is called per request, NOT at module load,
// so importing this module (e.g. during `vite build`) never touches the DB file.
export const handle: Handle = async ({ event, resolve }) => {
	return applySessionAndGuards(getDb(), event, async () => resolve(event));
};
