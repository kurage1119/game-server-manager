<script lang="ts">
	import { confirmDialog } from './confirm.svelte';

	const pending = $derived(confirmDialog.pending);

	function onWindowKeydown(e: KeyboardEvent) {
		if (pending && e.key === 'Escape') confirmDialog.cancel();
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if pending}
	<div
		class="modal-overlay"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) confirmDialog.cancel();
		}}
	>
		<div
			class="modal"
			role="dialog"
			aria-modal="true"
			aria-labelledby="confirm-title"
			tabindex="-1"
		>
			<div class="modal-icon modal-icon--{pending.variant ?? 'danger'}">!</div>
			<h3 id="confirm-title" class="modal-title">{pending.title}</h3>
			<p class="modal-body">{pending.body}</p>
			<div class="modal-actions">
				<!-- svelte-ignore a11y_autofocus -->
				<button
					type="button"
					class="btn btn--ghost"
					autofocus
					onclick={() => confirmDialog.cancel()}
				>
					キャンセル
				</button>
				<button
					type="button"
					class="btn {(pending.variant ?? 'danger') === 'warning'
						? 'btn--primary'
						: 'btn--danger'}"
					onclick={() => confirmDialog.confirm()}
				>
					{pending.confirmLabel}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(2px);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		z-index: 50;
		animation: modal-fade 0.15s ease;
	}
	.modal {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 26px;
		max-width: 400px;
		width: 100%;
		box-shadow: var(--shadow);
		animation: modal-pop 0.15s ease;
	}
	.modal-icon {
		width: 38px;
		height: 38px;
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 18px;
		font-weight: 700;
		margin-bottom: 14px;
	}
	.modal-icon--danger {
		background: var(--red-bg);
		border: 1px solid var(--red-bd);
		color: var(--red);
	}
	.modal-icon--warning {
		background: var(--yellow-bg);
		border: 1px solid var(--yellow-bd);
		color: var(--yellow);
	}
	.modal-title {
		font-size: 16px;
		font-weight: 600;
		margin: 0 0 8px;
	}
	.modal-body {
		font-size: 13px;
		color: var(--muted);
		line-height: 1.6;
		margin: 0 0 22px;
	}
	.modal-actions {
		display: flex;
		gap: 10px;
		justify-content: flex-end;
	}
	.modal-actions .btn {
		padding: 9px 16px;
		font-size: 13px;
	}
	@keyframes modal-fade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes modal-pop {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
</style>
