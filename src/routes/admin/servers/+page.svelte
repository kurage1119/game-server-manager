<script lang="ts">
	import { base } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>サーバー管理</title>
</svelte:head>

<main class="page">
	<h1 class="page-title">サーバー管理</h1>
	<p class="page-sub">systemd ユニットとして登録されたサーバーの一覧と新規登録。</p>

	{#if data.servers.length === 0}
		<div class="card empty">登録済みのサーバーはありません。</div>
	{:else}
		<div class="table-card">
			<table class="data-table">
				<thead>
					<tr>
						<th>名前</th>
						<th>ユニット名</th>
						<th class="col-actions">操作</th>
					</tr>
				</thead>
				<tbody>
					{#each data.servers as server (server.id)}
						<tr>
							<td>{server.name}</td>
							<td class="mono muted">{server.unitName}</td>
							<td class="col-actions">
								<a href="{base}/admin/servers/{server.id}" class="btn btn--ghost btn--sm">詳細 →</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<div class="card add-card">
		<h2 class="section-title">サーバーを追加</h2>

		{#if form?.error}
			<div class="banner banner--error" role="alert">
				<span class="banner-dot"></span>
				<span>{form.error}</span>
			</div>
		{:else if form?.created}
			<div class="banner banner--success" role="status">
				<span class="banner-dot"></span>
				<span>サーバーを追加しました。</span>
			</div>
		{/if}

		<form method="POST" action="?/create" class="stack">
			<label class="field">
				<span class="field-label">サーバー名</span>
				<input
					class="input"
					type="text"
					name="name"
					value={form?.name ?? ''}
					required
					placeholder="例: Minecraft サバイバル"
				/>
				<span class="field-hint">表示名・Discordコマンドの引数にも使われます。</span>
			</label>
			<label class="field">
				<span class="field-label">ユニット名</span>
				<span class="unit-input">
					<span class="unit-affix unit-affix--prefix">game-</span>
					<input
						type="text"
						name="unitBase"
						value={form?.unitBase ?? ''}
						required
						pattern="[A-Za-z0-9_.@-]+"
						placeholder="minecraft"
					/>
					<span class="unit-affix unit-affix--suffix">.service</span>
				</span>
				<span class="field-hint">
					中央部分のみ入力します。許可文字は英数字と <span class="mono">. _ @ -</span>
				</span>
			</label>
			<div>
				<button type="submit" class="btn btn--primary">追加</button>
			</div>
		</form>
	</div>
</main>

<style>
	.page {
		max-width: 840px;
		margin: 0 auto;
		padding: 32px 24px 64px;
	}
	.page-sub {
		margin-bottom: 24px;
	}
	.table-card {
		margin-bottom: 28px;
	}
	.empty {
		font-size: 13.5px;
		color: var(--muted);
		margin-bottom: 28px;
	}
	.add-card .section-title {
		margin-bottom: 18px;
	}
	.banner {
		margin-bottom: 18px;
	}
</style>
