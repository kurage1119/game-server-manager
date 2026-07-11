import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockSystemctlDriver } from './mock';

describe('MockSystemctlDriver', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('reports "inactive" for a unit it has never seen', async () => {
		const driver = new MockSystemctlDriver();
		await expect(driver.status('game-unknown.service')).resolves.toBe('inactive');
	});

	it('transitions activating -> active ~2s after start()', async () => {
		const driver = new MockSystemctlDriver();
		await driver.start('game-a.service');

		await expect(driver.status('game-a.service')).resolves.toBe('activating');

		await vi.advanceTimersByTimeAsync(1999);
		await expect(driver.status('game-a.service')).resolves.toBe('activating');

		await vi.advanceTimersByTimeAsync(1);
		await expect(driver.status('game-a.service')).resolves.toBe('active');
	});

	it('transitions deactivating -> inactive ~2s after stop()', async () => {
		const driver = new MockSystemctlDriver();
		driver._forceState('game-b.service', 'active');

		await driver.stop('game-b.service');
		await expect(driver.status('game-b.service')).resolves.toBe('deactivating');

		await vi.advanceTimersByTimeAsync(2000);
		await expect(driver.status('game-b.service')).resolves.toBe('inactive');
	});

	it('tracks multiple units independently', async () => {
		const driver = new MockSystemctlDriver();
		await driver.start('game-a.service');
		driver._forceState('game-b.service', 'active');

		await expect(driver.status('game-a.service')).resolves.toBe('activating');
		await expect(driver.status('game-b.service')).resolves.toBe('active');
	});

	it('a start() issued mid-transition restarts the timer instead of leaving a stale one running', async () => {
		const driver = new MockSystemctlDriver();
		await driver.start('game-a.service');
		await vi.advanceTimersByTimeAsync(1000);

		// Restart the "activating" window; the unit should NOT flip to active at the
		// original 2000ms mark, only 2000ms after this second call.
		await driver.start('game-a.service');
		await vi.advanceTimersByTimeAsync(1000);
		await expect(driver.status('game-a.service')).resolves.toBe('activating');

		await vi.advanceTimersByTimeAsync(1000);
		await expect(driver.status('game-a.service')).resolves.toBe('active');
	});
});
