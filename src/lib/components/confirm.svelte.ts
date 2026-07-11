// App-wide confirmation dialog, used in place of the browser's native
// `confirm()` for destructive/disruptive actions (deletes, server stop).
// A single <ConfirmDialog /> in the root layout renders `pending`; callers
// await `confirm(...)` and submit their form only when it resolves true.

export type ConfirmVariant = 'danger' | 'warning';

export type ConfirmOptions = {
	title: string;
	body: string;
	confirmLabel: string;
	variant?: ConfirmVariant;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

class ConfirmController {
	pending = $state<Pending | null>(null);

	ask(options: ConfirmOptions): Promise<boolean> {
		// A new request supersedes any dialog still open (treated as cancelled).
		this.pending?.resolve(false);
		return new Promise((resolve) => {
			this.pending = { ...options, resolve };
		});
	}

	#settle(ok: boolean) {
		const p = this.pending;
		if (!p) return;
		this.pending = null;
		p.resolve(ok);
	}

	confirm = () => this.#settle(true);
	cancel = () => this.#settle(false);
}

export const confirmDialog = new ConfirmController();

/** Show the confirmation modal; resolves true if the user confirms. */
export const confirm = (options: ConfirmOptions): Promise<boolean> =>
	confirmDialog.ask(options);
