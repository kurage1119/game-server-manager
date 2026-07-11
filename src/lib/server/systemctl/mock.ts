import type { ServiceStatus, SystemctlDriver } from './types';

const TRANSITION_MS = 2000;

/**
 * In-memory fake used for local (Windows) development and tests. Mimics the
 * real systemd transition delay: start() -> 'activating' -> (after ~2s) 'active',
 * stop() -> 'deactivating' -> (after ~2s) 'inactive'. Units never seen before
 * report 'inactive' (systemd's is-active default for a stopped-but-known unit).
 */
export class MockSystemctlDriver implements SystemctlDriver {
	private state = new Map<string, ServiceStatus>();
	private timers = new Map<string, ReturnType<typeof setTimeout>>();

	private clearTimer(unitName: string) {
		const existing = this.timers.get(unitName);
		if (existing) {
			clearTimeout(existing);
			this.timers.delete(unitName);
		}
	}

	async start(unitName: string): Promise<void> {
		this.clearTimer(unitName);
		this.state.set(unitName, 'activating');
		const timer = setTimeout(() => {
			this.state.set(unitName, 'active');
			this.timers.delete(unitName);
		}, TRANSITION_MS);
		timer.unref?.();
		this.timers.set(unitName, timer);
	}

	async stop(unitName: string): Promise<void> {
		this.clearTimer(unitName);
		this.state.set(unitName, 'deactivating');
		const timer = setTimeout(() => {
			this.state.set(unitName, 'inactive');
			this.timers.delete(unitName);
		}, TRANSITION_MS);
		timer.unref?.();
		this.timers.set(unitName, timer);
	}

	async status(unitName: string): Promise<ServiceStatus> {
		return this.state.get(unitName) ?? 'inactive';
	}

	/** Test-only escape hatch to skip the 2s wait. Not part of the SystemctlDriver interface. */
	_forceState(unitName: string, status: ServiceStatus): void {
		this.clearTimer(unitName);
		this.state.set(unitName, status);
	}
}
