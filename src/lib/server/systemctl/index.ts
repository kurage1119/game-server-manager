import type { ServiceStatus, SystemctlDriver } from './types';
import { isValidUnitName } from './types';
import { MockSystemctlDriver } from './mock';
import { RealSystemctlDriver } from './real';

export type { ServiceStatus, SystemctlDriver } from './types';
export {
	isValidUnitName,
	UNIT_NAME_PATTERN,
	isValidUnitBase,
	buildUnitName,
	unitNameBase,
	UNIT_NAME_PREFIX,
	UNIT_NAME_SUFFIX
} from './types';

export class InvalidUnitNameError extends Error {
	constructor(unitName: string) {
		super(`Invalid systemd unit name: ${JSON.stringify(unitName)}`);
		this.name = 'InvalidUnitNameError';
	}
}

/**
 * Wraps any SystemctlDriver and re-validates the unit name on every call, so
 * "validated at registration time" can never be bypassed by a bad value that
 * slips into the DB (defense in depth per docs/implementation-plan.md).
 * Exported for unit tests; production code should use getSystemctlDriver().
 */
export class ValidatingSystemctlDriver implements SystemctlDriver {
	constructor(private readonly inner: SystemctlDriver) {}

	private assertValid(unitName: string): void {
		if (!isValidUnitName(unitName)) {
			throw new InvalidUnitNameError(unitName);
		}
	}

	async start(unitName: string): Promise<void> {
		this.assertValid(unitName);
		return this.inner.start(unitName);
	}

	async stop(unitName: string): Promise<void> {
		this.assertValid(unitName);
		return this.inner.stop(unitName);
	}

	async status(unitName: string): Promise<ServiceStatus> {
		this.assertValid(unitName);
		return this.inner.status(unitName);
	}
}

function createDriver(): SystemctlDriver {
	const mode = process.env.SYSTEMCTL_MODE ?? 'mock';
	switch (mode) {
		case 'real':
			return new ValidatingSystemctlDriver(new RealSystemctlDriver());
		case 'mock':
			return new ValidatingSystemctlDriver(new MockSystemctlDriver());
		default:
			throw new Error(`Unknown SYSTEMCTL_MODE: ${JSON.stringify(mode)} (expected "mock" or "real")`);
	}
}

let driver: SystemctlDriver | undefined;

/** Lazily-created singleton, so importing this module doesn't decide the mode before env is loaded. */
export function getSystemctlDriver(): SystemctlDriver {
	if (!driver) {
		driver = createDriver();
	}
	return driver;
}
