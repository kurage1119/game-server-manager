/**
 * Domain errors thrown by the service layer. Route handlers (and, from Step 6,
 * the Discord bot) map these to their transport's error shape — the services
 * themselves stay transport-agnostic so authorization lives in exactly one place.
 */

/** Actor lacks the required permission level (or the resource is invisible to them). */
export class PermissionDeniedError extends Error {
	constructor(message = '権限がありません。') {
		super(message);
		this.name = 'PermissionDeniedError';
	}
}

/** The referenced entity does not exist. */
export class NotFoundError extends Error {
	constructor(message = '対象が見つかりません。') {
		super(message);
		this.name = 'NotFoundError';
	}
}

/** User-supplied input failed validation (maps to a 400-class response, not a server error). */
export class ValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ValidationError';
	}
}
