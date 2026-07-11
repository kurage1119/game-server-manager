import { describe, it, expect } from 'vitest';
import { parseIsActiveOutput, RealSystemctlDriver } from './real';

describe('parseIsActiveOutput', () => {
	it('maps every known systemd state verbatim', () => {
		expect(parseIsActiveOutput('active')).toBe('active');
		expect(parseIsActiveOutput('inactive')).toBe('inactive');
		expect(parseIsActiveOutput('activating')).toBe('activating');
		expect(parseIsActiveOutput('deactivating')).toBe('deactivating');
		expect(parseIsActiveOutput('failed')).toBe('failed');
	});

	it('tolerates trailing newline and surrounding whitespace (systemctl always appends \\n)', () => {
		expect(parseIsActiveOutput('active\n')).toBe('active');
		expect(parseIsActiveOutput('  failed  \n')).toBe('failed');
	});

	it('uses only the first line when multiple units were queried', () => {
		expect(parseIsActiveOutput('active\ninactive\n')).toBe('active');
	});

	it("maps states we don't model (reloading, refreshing) to 'unknown'", () => {
		expect(parseIsActiveOutput('reloading')).toBe('unknown');
		expect(parseIsActiveOutput('refreshing')).toBe('unknown');
	});

	it("maps empty or garbage output to 'unknown'", () => {
		expect(parseIsActiveOutput('')).toBe('unknown');
		expect(parseIsActiveOutput('\n')).toBe('unknown');
		expect(parseIsActiveOutput('some error text')).toBe('unknown');
	});

	it('does not partially match (e.g. "activexyz" is not "active")', () => {
		expect(parseIsActiveOutput('activexyz')).toBe('unknown');
		expect(parseIsActiveOutput('ACTIVE')).toBe('unknown');
	});
});

describe('RealSystemctlDriver input validation', () => {
	it('rejects an invalid unit name before ever spawning a process', async () => {
		const driver = new RealSystemctlDriver();
		await expect(driver.start('game-a;rm.service')).rejects.toThrow(/Invalid systemd unit name/);
		await expect(driver.stop('game-*.service')).rejects.toThrow(/Invalid systemd unit name/);
		await expect(driver.status('not-a-game.service')).rejects.toThrow(/Invalid systemd unit name/);
	});
});
