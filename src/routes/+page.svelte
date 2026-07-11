<script lang="ts">
	import { base } from '$app/paths';
	import { confirm } from '$lib/components/confirm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Entry = PageData['servers'][number];

	// Poll results override the load data until the next full navigation/form
	// post (which resets this to null and shows fresh server-rendered data).
	let polled: Entry[] | null = $state(null);
	const servers = $derived(polled ?? data.servers);

	// Poll /api/status every 5s, but only while the tab is visible.
	$effect(() => {
		let cancelled = false;

		async function poll() {
			if (document.visibilityState !== 'visible') return;
			try {
				const res = await fetch(`${base}/api/status`);
				if (!res.ok) return;
				const body = (await res.json()) as { servers: Entry[] };
				if (!cancelled) polled = body.servers;
			} catch {
				// Network hiccup — keep the last known state and try again next tick.
			}
		}

		const interval = setInterval(poll, 5000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	});

	const statusLabels: Record<string, string> = {
		active: '稼働中',
		inactive: '停止',
		activating: '起動中…',
		deactivating: '停止中…',
		failed: '異常終了',
		unknown: '不明'
	};

	const statusColors: Record<string, string> = {
		active: 'badge--green',
		inactive: 'badge--grey',
		activating: 'badge--yellow',
		deactivating: 'badge--yellow',
		failed: 'badge--red',
		unknown: 'badge--grey'
	};

	function canStart(status: string): boolean {
		return status === 'inactive' || status === 'failed' || status === 'unknown';
	}
	function canStop(status: string): boolean {
		return status === 'active' || status === 'activating';
	}
</script>

<svelte:head>
	<title>ダッシュボード</title>
</svelte:head>

<main class="page">
	<div class="page-head">
		<div>
			<h1 class="page-title">ダッシュボード</h1>
			<p class="page-sub">閲覧できるサーバーの状態と操作。</p>
		</div>
		<div class="live-pill">
			<span class="live-dot"></span>
			<span>5秒ごとに自動更新</span>
		</div>
	</div>

	{#if form?.error}
		<div class="banner banner--error" role="alert">
			<span class="banner-dot"></span>
			<span>{form.error}</span>
		</div>
	{:else if form?.message}
		<div class="banner banner--success" role="status">
			<span class="banner-dot"></span>
			<span>{form.message}</span>
		</div>
	{/if}

	{#if servers.length === 0}
		<div class="card empty">
			閲覧できるサーバーがありません。管理者に権限の付与を依頼してください。
		</div>
	{:else}
		<div class="server-grid">
			{#each servers as server (server.id)}
				<div class="server-card">
					<div class="server-card-top">
						<div style="min-width:0">
							<h2 class="server-name">{server.name}</h2>
						</div>
						<span class="badge {statusColors[server.status] ?? 'badge--grey'}">
							<span class="badge-dot"></span>{statusLabels[server.status] ?? server.status}
						</span>
					</div>
					{#if server.canOperate}
						<div class="server-actions">
							<form method="POST" action="?/start">
								<input type="hidden" name="serverId" value={server.id} />
								<button type="submit" class="btn btn--start" disabled={!canStart(server.status)}>
									起動
								</button>
							</form>
							<form
									method="POST"
									action="?/stop"
									onsubmit={async (e) => {
										e.preventDefault();
										const el = e.currentTarget;
										const ok = await confirm({
											title: 'サーバーを停止しますか?',
											body: `${server.name} を停止します。接続中のプレイヤーは切断されます。`,
											confirmLabel: '停止する',
											variant: 'warning'
										});
										if (ok) el.submit();
									}}
								>
									<input type="hidden" name="serverId" value={server.id} />
									<button type="submit" class="btn btn--stop" disabled={!canStop(server.status)}>
										停止
									</button>
								</form>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</main>

<style>
	.page {
		max-width: 1080px;
		margin: 0 auto;
		padding: 32px 24px 64px;
	}
	.page-head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
		margin-bottom: 22px;
	}
	.banner {
		margin-bottom: 20px;
	}
	.empty {
		font-size: 13.5px;
		color: var(--muted);
	}
</style>
