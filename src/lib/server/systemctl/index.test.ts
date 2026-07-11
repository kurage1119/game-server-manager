import { describe, it, expect, vi } from 'vitest';
import { ValidatingSystemctlDriver, InvalidUnitNameError } from './index';
import type { SystemctlDriver } from './types';

function spyDriver(): SystemctlDriver & { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> } {
	return {
		start: vi.fn(async () => {}),
		stop: vi.fn(async () => {}),
		status: vi.fn(async () => 'active' as const)
	};
}

describe('ValidatingSystemctlDriver (runtime re-validation)', () => {
	it('rejects an invalid unit name that slipped into the DB, without ever calling the inner driver', async () => {
		const inner = spyDriver();
		const driver = new ValidatingSystemctlDriver(inner);

		await expect(driver.start('game-a;b.service')).rejects.toThrow(InvalidUnitNameError);
		await expect(driver.stop('game-a;b.service')).rejects.toThrow(InvalidUnitNameError);
		await expect(driver.status('game-a;b.service')).rejects.toThrow(InvalidUnitNameError);

		expect(inner.start).not.toHaveBeenCalled();
		expect(inner.stop).not.toHaveBeenCalled();
		expect(inner.status).not.toHaveBeenCalled();
	});

	it('passes a valid unit name through to the inner driver untouched', async () => {
		const inner = spyDriver();
		const driver = new ValidatingSystemctlDriver(inner);

		await driver.start('game-mc.service');
		await expect(driver.status('game-mc.service')).resolves.toBe('active');

		expect(inner.start).toHaveBeenCalledWith('game-mc.service');
		expect(inner.status).toHaveBeenCalledWith('game-mc.service');
	});
});
