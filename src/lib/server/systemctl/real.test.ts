import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseIsActiveOutput, RealSystemctlDriver } from './real';
import { UNIT_NAME_PATTERN } from './types';

// execFile is wrapped via `promisify(execFile)` in real.ts, and Node's real
// child_process.execFile registers a util.promisify.custom implementation
// (resolving to { stdout, stderr } instead of the default single-arg callback
// behavior). To intercept the exact argv passed through that promisified call,
// the mock below attaches the same custom-promisify symbol so
// `promisify(execFile) === execFileMock`.
const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
	const { promisify } = await import('node:util');
	// Keep the real spawnSync (used below to actually exercise deploy/game-unitctl
	// as a child process) alongside the fake execFile that real.ts's driver uses.
	const actual = await importOriginal<typeof import('node:child_process')>();
	const execFile = (() => {
		throw new Error('execFile called without the promisify wrapper');
	}) as unknown as { [key: symbol]: typeof execFileMock };
	execFile[promisify.custom] = execFileMock;
	return { spawnSync: actual.spawnSync, execFile };
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

describe('RealSystemctlDriver argv (goes through the game-unitctl wrapper, matching the sudoers rule)', () => {
	beforeEach(() => {
		execFileMock.mockReset();
		execFileMock.mockResolvedValue({ stdout: '', stderr: '' });
	});

	it('invokes sudo game-unitctl start <unit>, letting the wrapper add --no-block', async () => {
		const driver = new RealSystemctlDriver();
		await driver.start('game-mc.service');
		expect(execFileMock).toHaveBeenCalledWith(
			'sudo',
			['/usr/local/sbin/game-unitctl', 'start', 'game-mc.service'],
			{ timeout: 30_000 }
		);
	});

	it('invokes sudo game-unitctl stop <unit>, letting the wrapper add --no-block', async () => {
		const driver = new RealSystemctlDriver();
		await driver.stop('game-mc.service');
		expect(execFileMock).toHaveBeenCalledWith(
			'sudo',
			['/usr/local/sbin/game-unitctl', 'stop', 'game-mc.service'],
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
	it('permits both game-unitctl start and game-unitctl stop with a trailing * (zero or more subsequent arguments)', () => {
		const sudoersPath = join(process.cwd(), 'deploy', 'sudoers.d-example');
		const contents = readFileSync(sudoersPath, 'utf-8');
		expect(contents).toContain('/usr/local/sbin/game-unitctl start *');
		expect(contents).toContain('/usr/local/sbin/game-unitctl stop *');
	});

	// Regression guard for the reported incident: sudo-rs 0.2.13-0ubuntu1.2
	// (Ubuntu 26.04's default sudo) rejects wildcards in command ARGUMENTS
	// with "syntax error: wildcards are not allowed in command arguments".
	// The old `systemctl start game-*.service` rule put the wildcard in an
	// argument position, so `visudo -c` rejected the whole file. This test
	// would have caught that before it shipped.
	it('contains no argument-position wildcard (game-*.service) that sudo-rs would reject', () => {
		const sudoersPath = join(process.cwd(), 'deploy', 'sudoers.d-example');
		const contents = readFileSync(sudoersPath, 'utf-8');
		expect(contents).not.toContain('game-*.service');
	});
});

describe('deploy/game-unitctl matches the app-level unit-name validation', () => {
	it('has the negated character-class check and the game-?*.service shape check on EXECUTABLE lines (not just documented in a comment)', () => {
		const wrapperPath = join(process.cwd(), 'deploy', 'game-unitctl');
		const lines = readFileSync(wrapperPath, 'utf-8').split('\n');
		// Strip comment-only lines so a description in prose cannot satisfy this
		// assertion the way `toContain(UNIT_NAME_PATTERN.source)` previously did
		// (that string also appears in a comment, so it passed even when the
		// executable validation was replaced with `case "$unit" in *) ;; esac`).
		const executableText = lines.filter((line) => !line.trim().startsWith('#')).join('\n');

		// Derived from UNIT_NAME_PATTERN.source (not hardcoded) so the two can't drift.
		const charClassMatch = UNIT_NAME_PATTERN.source.match(/\[([^\]]+)\]/);
		if (!charClassMatch) throw new Error('UNIT_NAME_PATTERN.source has no [...] character class to derive from');
		const negatedCharClassGlob = `*[!${charClassMatch[1]}]*`;

		expect(executableText).toContain(negatedCharClassGlob);
		expect(executableText).toContain('game-?*.service');
	});

	// Behavioral guard: spawns the REAL wrapper as a child process (sh) and
	// checks its accept/reject verdict against UNIT_NAME_PATTERN.test(). This
	// is the guard that actually catches a broken validator — the static test
	// above only proves the right patterns are present, not that they work.
	// It reproduces the reported grep-vs-newline bypass (`printf '%s' "$2" |
	// grep -qE '...'` matches line-by-line, so a unit name with an embedded
	// newline could pass validation on one line while `exec` still received
	// the whole, differently-shaped original string) for every case EXCEPT
	// the embedded-newline one itself, which Windows argv passing mangles
	// before the child process sees it — see the note on that case below.
	const shAvailable = spawnSync('sh', ['-c', 'exit 0']).error === undefined;

	describe.skipIf(!shAvailable)('behavioral equivalence with UNIT_NAME_PATTERN (spawns a real `sh` process)', () => {
		const wrapperPath = join(process.cwd(), 'deploy', 'game-unitctl');

		const cases: Array<[unit: string, accepted: boolean]> = [
			['game-mc.service', true],
			['game-server@minecraft.service', true],
			['game-.service', false],
			['sshd.service', false],
			['game-a;rm.service', false],
			['-H', false],
			// H1 regression: an embedded newline must not let a grep-based,
			// line-oriented validator approve a unit that doesn't match as a
			// whole. NOTE on what this case is actually worth, per platform:
			// Node passes the argv element through INTACT (measured 27 bytes,
			// node->node). It is the MSYS2 `sh.exe` on Windows that re-parses the
			// command line and SPLITS on the newline, so the wrapper here receives
			// $2="sshd.service" and $3="game-x.service". On Windows this case
			// therefore degenerates into a duplicate of the plain 'sshd.service'
			// case and gives NO H1 coverage — proved by restoring the old grep
			// validator, which left every behavioral case green on this box. It is
			// a real regression guard only on Linux/CI, where execve passes argv
			// verbatim and both lines reach the wrapper as a single $2.
			['sshd.service\ngame-x.service', false]
		];

		it.each(cases)('unit %j is accepted=%s, matching UNIT_NAME_PATTERN.test()', (unit, accepted) => {
			// /usr/bin/systemctl does not exist on this dev box, so an ACCEPTED
			// unit still exits non-zero (exec fails with "not found") — but never
			// with exit 64, which the wrapper uses exclusively for its own
			// validation/usage failures. A REJECTED unit always exits exactly 64
			// with "invalid unit" on stderr, before ever reaching exec.
			const result = spawnSync('sh', [wrapperPath, 'start', unit], { encoding: 'utf-8' });
			expect(UNIT_NAME_PATTERN.test(unit)).toBe(accepted);
			if (accepted) {
				expect(result.status).not.toBe(64);
				expect(result.stderr).not.toContain('invalid unit');
			} else {
				expect(result.status).toBe(64);
				expect(result.stderr).toContain('invalid unit');
			}
		});
	});
});
