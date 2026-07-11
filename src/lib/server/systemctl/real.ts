import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ServiceStatus, SystemctlDriver } from './types';
import { isValidUnitName } from './types';

const execFileAsync = promisify(execFile);

const SYSTEMCTL = '/usr/bin/systemctl';
const SUDO = 'sudo';
const EXEC_TIMEOUT_MS = 30_000;

const KNOWN_STATUSES: ReadonlySet<string> = new Set([
	'active',
	'inactive',
	'activating',
	'deactivating',
	'failed'
]);

/**
 * Maps `systemctl is-active` stdout to a ServiceStatus. is-active exits non-zero
 * for anything but 'active', so the exit code is NOT a failure signal — only the
 * output matters. Unknown output (e.g. 'reloading' or garbage) maps to 'unknown'
 * instead of throwing. Exported separately so the parsing is unit-testable
 * without spawning processes.
 */
export function parseIsActiveOutput(stdout: string): ServiceStatus {
	const value = stdout.trim().split('\n')[0]?.trim() ?? '';
	if (KNOWN_STATUSES.has(value)) {
		return value as ServiceStatus;
	}
	return 'unknown';
}

function assertValidUnitName(unitName: string): void {
	// Re-validated here even though ValidatingSystemctlDriver already checks:
	// this class must be safe even if someone wires it up directly.
	if (!isValidUnitName(unitName)) {
		throw new Error(`Invalid systemd unit name: ${JSON.stringify(unitName)}`);
	}
}

interface ExecError extends Error {
	code?: number | string;
	stdout?: string;
	stderr?: string;
	killed?: boolean;
}

function isExecError(e: unknown): e is ExecError {
	return e instanceof Error;
}

function describeExecFailure(action: string, unitName: string, e: ExecError): Error {
	if (e.killed) {
		return new Error(`systemctl ${action} ${unitName} timed out after ${EXEC_TIMEOUT_MS / 1000}s`);
	}
	const stderr = e.stderr?.trim();
	return new Error(
		`systemctl ${action} ${unitName} failed (exit ${e.code ?? '?'})${stderr ? `: ${stderr}` : ''}`
	);
}

/**
 * Real driver: spawns systemctl via execFile (argv only, no shell, so no
 * metacharacter interpretation). start/stop go through sudo; the sudoers rule in
 * deploy/sudoers.d-example restricts svmgr to `systemctl start|stop game-*.service`.
 * `is-active` needs no privileges and runs directly.
 */
export class RealSystemctlDriver implements SystemctlDriver {
	async start(unitName: string): Promise<void> {
		assertValidUnitName(unitName);
		try {
			await execFileAsync(SUDO, [SYSTEMCTL, 'start', unitName], { timeout: EXEC_TIMEOUT_MS });
		} catch (e) {
			if (isExecError(e)) throw describeExecFailure('start', unitName, e);
			throw e;
		}
	}

	async stop(unitName: string): Promise<void> {
		assertValidUnitName(unitName);
		try {
			await execFileAsync(SUDO, [SYSTEMCTL, 'stop', unitName], { timeout: EXEC_TIMEOUT_MS });
		} catch (e) {
			if (isExecError(e)) throw describeExecFailure('stop', unitName, e);
			throw e;
		}
	}

	async status(unitName: string): Promise<ServiceStatus> {
		assertValidUnitName(unitName);
		try {
			const { stdout } = await execFileAsync(SYSTEMCTL, ['is-active', unitName], {
				timeout: EXEC_TIMEOUT_MS
			});
			return parseIsActiveOutput(stdout);
		} catch (e) {
			if (isExecError(e)) {
				if (e.killed) throw describeExecFailure('is-active', unitName, e);
				// Non-zero exit is EXPECTED for every non-active state; the state name
				// is still on stdout. Only a truly empty stdout (systemctl missing,
				// permission failure) is a real error worth surfacing.
				if (typeof e.stdout === 'string' && e.stdout.trim() !== '') {
					return parseIsActiveOutput(e.stdout);
				}
				throw describeExecFailure('is-active', unitName, e);
			}
			throw e;
		}
	}
}
