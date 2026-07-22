import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseIsActiveOutput, RealSystemctlDriver } from './real';

// execFile is wrapped via `promisify(execFile)` in real.ts, and Node's real
// child_process.execFile registers a util.promisify.custom implementation
// (resolving to { stdout, stderr } instead of the default single-arg callback
// behavior). To intercept the exact argv passed through that promisified call,
// the mock below attaches the same custom-promisify symbol so
// `promisify(execFile) === execFileMock`.
const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock('node:child_process', async () => {
	const { promisify } = await import('node:util');
	const execFile = (() => {
		throw new Error('execFile called without the promisify wrapper');
	}) as unknown as { [key: symbol]: typeof execFileMock };
	execFile[promisify.custom] = execFileMock;
	return { execFile };
});

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

describe('RealSystemctlDriver argv (--no-block, so start/stop return once issued)', () => {
	beforeEach(() => {
		execFileMock.mockReset();
		execFileMock.mockResolvedValue({ stdout: '', stderr: '' });
	});

	it('passes --no-block BEFORE the verb for start, matching the sudoers rule', async () => {
		const driver = new RealSystemctlDriver();
		await driver.start('game-mc.service');
		expect(execFileMock).toHaveBeenCalledWith(
			'sudo',
			['/usr/bin/systemctl', '--no-block', 'start', 'game-mc.service'],
			{ timeout: 30_000 }
		);
	});

	it('passes --no-block BEFORE the verb for stop, matching the sudoers rule', async () => {
		const driver = new RealSystemctlDriver();
		await driver.stop('game-mc.service');
		expect(execFileMock).toHaveBeenCalledWith(
			'sudo',
			['/usr/bin/systemctl', '--no-block', 'stop', 'game-mc.service'],
			{ timeout: 30_000 }
		);
	});

	it('calls status via is-active with no sudo and no --no-block', async () => {
		execFileMock.mockResolvedValue({ stdout: 'active\n', stderr: '' });
		const driver = new RealSystemctlDriver();
		await driver.status('game-mc.service');
		expect(execFileMock).toHaveBeenCalledWith('/usr/bin/systemctl', ['is-active', 'game-mc.service'], {
			timeout: 30_000
		});
	});
});

describe('RealSystemctlDriver failure paths (regression guards)', () => {
	beforeEach(() => {
		execFileMock.mockReset();
	});

	it('reproduces the production incident: stop times out after 30s and rejects instead of hanging silently', async () => {
		execFileMock.mockRejectedValue(Object.assign(new Error('killed'), { killed: true, code: null }));
		const driver = new RealSystemctlDriver();
		await expect(driver.stop('game-mc.service')).rejects.toThrow(
			/systemctl stop game-mc\.service timed out after 30s/
		);
	});

	it('surfaces exit code and stderr when start fails because the unit does not exist (--no-block does not hide this)', async () => {
		execFileMock.mockRejectedValue(
			Object.assign(new Error('Command failed'), {
				code: 1,
				stderr: 'Failed to start game-mc.service: Unit game-mc.service not found.\n'
			})
		);
		const driver = new RealSystemctlDriver();
		await expect(driver.start('game-mc.service')).rejects.toThrow(
			/failed \(exit 1\): Failed to start game-mc\.service: Unit game-mc\.service not found\./
		);
	});

	it('propagates a sudo rejection as a failure instead of resolving silently (guards against a sudoers/argv mismatch)', async () => {
		execFileMock.mockRejectedValue(
			Object.assign(new Error('Command failed'), { code: 1, stderr: 'sudo: a password is required' })
		);
		const driver = new RealSystemctlDriver();
		await expect(driver.start('game-mc.service')).rejects.toThrow(/sudo: a password is required/);
	});
});

describe('deploy/sudoers.d-example matches the argv this driver actually invokes', () => {
	it('permits both --no-block start and --no-block stop for game-*.service', () => {
		const sudoersPath = join(process.cwd(), 'deploy', 'sudoers.d-example');
		const contents = readFileSync(sudoersPath, 'utf-8');
		expect(contents).toContain('/usr/bin/systemctl --no-block start game-*.service');
		expect(contents).toContain('/usr/bin/systemctl --no-block stop game-*.service');
	});
});
