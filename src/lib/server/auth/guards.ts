import { redirect, error, json, type Cookies } from '@sveltejs/kit';
import type { DB } from '../db';
import { SESSION_COOKIE_NAME, validateSessionToken, setSessionCookie, clearSessionCookie } from './session';
import type { SessionUser } from './session';
import { hasAnyUser } from '../services/userService';

const PUBLIC_PATHS = new Set(['/setup', '/login', '/logout']);
const CHANGE_PASSWORD_EXEMPT_PATHS = new Set(['/change-password', '/logout']);

/** The subset of RequestEvent the guards need — kept narrow so tests can fake it. */
export interface GuardEvent {
	url: URL;
	cookies: Cookies;
	locals: { user: SessionUser | null };
}

/**
 * Session resolution + the 4-stage guard chain (docs/implementation-plan.md 認証設計),
 * extracted from hooks.server.ts so it can be exercised directly in unit tests.
 * Page routes get redirects; /api/* routes get JSON errors instead (an API client
 * cannot follow an HTML login flow).
 */
export async function applySessionAndGuards(
	db: DB,
	event: GuardEvent,
	resolve: () => Promise<Response>
): Promise<Response> {
	// --- Resolve session -> event.locals.user -------------------------------
	const token = event.cookies.get(SESSION_COOKIE_NAME);
	event.locals.user = null;

	if (token) {
		const result = await validateSessionToken(db, token);
		if (result) {
			event.locals.user = result.user;
			// Re-set the cookie so the browser-side expiry tracks any slide extension.
			setSessionCookie(event.cookies, event.url.protocol === 'https:', token, result.session.expiresAt);
		} else {
			clearSessionCookie(event.cookies);
		}
	}

	const { pathname } = event.url;
	const isApi = pathname.startsWith('/api/');
	const user = event.locals.user;

	// --- Guard 1: first-run setup --------------------------------------------
	const anyUserExists = await hasAnyUser(db);

	if (!anyUserExists) {
		if (pathname !== '/setup') {
			if (isApi) {
				return json({ error: 'setup_required' }, { status: 403 });
			}
			throw redirect(303, '/setup');
		}
	} else if (pathname === '/setup') {
		// Setup is a one-time action; once an admin exists, re-running it is disabled.
		throw redirect(303, '/');
	}

	// --- Guard 2: authentication required ------------------------------------
	if (!user && !PUBLIC_PATHS.has(pathname)) {
		if (isApi) {
			return json({ error: 'unauthorized' }, { status: 401 });
		}
		throw redirect(303, '/login');
	}

	// --- Guard 3: forced password change --------------------------------------
	if (user?.mustChangePassword && !CHANGE_PASSWORD_EXEMPT_PATHS.has(pathname)) {
		if (isApi) {
			return json({ error: 'password_change_required' }, { status: 403 });
		}
		throw redirect(303, '/change-password');
	}

	// --- Guard 4: admin-only area ----------------------------------------------
	if (pathname.startsWith('/admin') && !user?.isAdmin) {
		throw error(403, 'Forbidden');
	}

	return resolve();
}
