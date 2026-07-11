/** systemd unit states we care about (subset of `systemctl is-active` outputs). */
export type ServiceStatus = 'active' | 'inactive' | 'activating' | 'deactivating' | 'failed' | 'unknown';

/**
 * Abstraction over `systemctl start|stop|is-active game-<name>.service` so the
 * rest of the app never shells out directly. Swapped via SYSTEMCTL_MODE:
 * - "mock" (default in dev / Windows): in-memory fake, used until Step 5.
 * - "real" (Linux, Step 5): execFile-based implementation.
 */
export interface SystemctlDriver {
	/** Requests unit start. Resolves once the request has been issued (not once it's fully active). */
	start(unitName: string): Promise<void>;
	/** Requests unit stop. Resolves once the request has been issued (not once it's fully inactive). */
	stop(unitName: string): Promise<void>;
	/** Current status of the unit. Never throws for a merely-stopped/unknown unit. */
	status(unitName: string): Promise<ServiceStatus>;
}

/**
 * Unit names are constrained to this pattern both at server-registration time and
 * at execution time, so a crafted server "name"/unit can never inject shell
 * metacharacters or select an arbitrary unit outside the `game-` namespace.
 */
export const UNIT_NAME_PATTERN = /^game-[A-Za-z0-9_.@-]+\.service$/;

export function isValidUnitName(unitName: string): boolean {
	return UNIT_NAME_PATTERN.test(unitName);
}

/**
 * Fixed prefix/suffix of every managed unit. The admin only types the middle
 * part (e.g. "minecraft"); these are added by the app so `game-` / `.service`
 * are never entered by hand.
 */
export const UNIT_NAME_PREFIX = 'game-';
export const UNIT_NAME_SUFFIX = '.service';

/** Character class allowed in the user-supplied middle — same set as the full pattern's inner group. */
export const UNIT_BASE_PATTERN = /^[A-Za-z0-9_.@-]+$/;

export function isValidUnitBase(base: string): boolean {
	return UNIT_BASE_PATTERN.test(base);
}

/** Builds the full unit name from the middle part. A valid base always yields a name that passes isValidUnitName. */
export function buildUnitName(base: string): string {
	return `${UNIT_NAME_PREFIX}${base}${UNIT_NAME_SUFFIX}`;
}

/** Inverse of buildUnitName for pre-filling the edit form; returns the input unchanged if it isn't the game-*.service shape. */
export function unitNameBase(unitName: string): string {
	if (unitName.startsWith(UNIT_NAME_PREFIX) && unitName.endsWith(UNIT_NAME_SUFFIX)) {
		return unitName.slice(UNIT_NAME_PREFIX.length, unitName.length - UNIT_NAME_SUFFIX.length);
	}
	return unitName;
}
