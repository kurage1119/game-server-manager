<script lang="ts">
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const levelLabels: Record<string, string> = {
		none: '不可',
		view: '閲覧のみ',
		operate: '操作可'
	};
</script>

<svelte:head>
	<title>サーバー詳細: {data.server.name}</title>
</svelte:head>

<main class="page">
	<a href="/admin/servers" class="back-link">← サーバー一覧へ戻る</a>
	<h1 class="page-title detail-title">サーバー詳細: {data.server.name}</h1>

	{#if form?.error}
		<div class="banner banner--error" role="alert">
			<span class="banner-dot"></span>
			<span>{form.error}</span>
		</div>
	{:else if form?.updated}
		<div class="banner banner--success" role="status">
			<span class="banner-dot"></span>
			<span>基本情報を更新しました。</span>
		</div>
	{:else if form?.permissionUpdated}
		<div class="banner banner--success" role="status">
			<span class="banner-dot"></span>
			<span>権限を更新しました。</span>
		</div>
	{:else if form?.discordUpdated}
		<div class="banner banner--success" role="status">
			<span class="banner-dot"></span>
			<span>Discord設定を更新しました。</span>
		</div>
	{/if}

	<!-- Section 1: basic info -->
	<section class="section">
		<div class="section-head">
			<span class="section-num">01</span>
			<h2 class="section-title">基本情報</h2>
		</div>
		<form method="POST" action="?/update" class="stack">
			<label class="field">
				<span class="field-label">サーバー名</span>
				<input class="input" type="text" name="name" value={data.server.name} required />
			</label>
			<label class="field">
				<span class="field-label">ユニット名</span>
				<span class="unit-input">
					<span class="unit-affix unit-affix--prefix">game-</span>
					<input type="text" name="unitBase" value={data.unitBase} required pattern="[A-Za-z0-9_.@-]+" />
					<span class="unit-affix unit-affix--suffix">.service</span>
				</span>
				<span class="field-hint">中央部分のみ入力(英数字と <span class="mono">. _ @ -</span>)</span>
			</label>
			<div>
				<button type="submit" class="btn btn--primary">更新</button>
			</div>
		</form>
	</section>

	<!-- Section 2: permissions -->
	<section class="section">
		<div class="section-head">
			<span class="section-num">02</span>
			<h2 class="section-title">権限設定</h2>
		</div>
		<p class="section-desc">
			ユーザーごとにこのサーバーへのアクセスレベルを設定します(管理者は常に全権限)。
		</p>
		<div class="perm-list">
			{#each data.permissions as perm (perm.userId)}
				<div class="perm-row">
					<div class="perm-name">{perm.username}</div>
					{#if perm.isAdmin}
						<span class="perm-fixed"><span class="badge-dot"></span>操作可(固定)</span>
					{:else}
						<form method="POST" action="?/setPermission" class="perm-controls">
							<input type="hidden" name="userId" value={perm.userId} />
							<select class="input" name="level">
								<option value="none" selected={perm.level === 'none'}>{levelLabels['none']}</option>
								<option value="view" selected={perm.level === 'view'}>{levelLabels['view']}</option>
								<option value="operate" selected={perm.level === 'operate'}>
									{levelLabels['operate']}
								</option>
							</select>
							<button type="submit" class="btn btn--ghost btn--sm">設定</button>
						</form>
					{/if}
				</div>
			{/each}
		</div>
	</section>

	<!-- Section 3: Discord -->
	<section class="section">
		<div class="section-head">
			<span class="section-num">03</span>
			<h2 class="section-title">Discord設定</h2>
		</div>
		<p class="section-desc">
			ここで許可した Discord チャンネルから、スラッシュコマンド(<span class="mono">/server start</span>
			など)でこのサーバーを操作できます。チャンネル単位の許可制で、許可のないチャンネルやDMからは操作できません。
		</p>

		<details class="help">
			<summary>DiscordサーバーID・チャンネルIDの取得方法</summary>
			<div class="help-body">
				<ol>
					<li>Discord の「ユーザー設定 → 詳細設定 → 開発者モード」を有効にする。</li>
					<li>Discordサーバー名を右クリック →「サーバーIDをコピー」でDiscordサーバーID。</li>
					<li>対象チャンネル名を右クリック →「チャンネルIDをコピー」でチャンネルID。</li>
				</ol>
			</div>
		</details>

		{#if data.discordChannels.length === 0}
			<p class="channels-empty">許可されたチャンネルはありません。</p>
		{:else}
			<div class="table-card channels-table">
				<table class="data-table">
					<thead>
						<tr>
							<th>DiscordサーバーID</th>
							<th>チャンネルID</th>
							<th class="col-actions"></th>
						</tr>
					</thead>
					<tbody>
						{#each data.discordChannels as channel (channel.id)}
							<tr>
								<td class="mono">{channel.guildId}</td>
								<td class="mono">{channel.channelId}</td>
								<td class="col-actions">
									<form method="POST" action="?/removeDiscordChannel">
										<input type="hidden" name="rowId" value={channel.id} />
										<button
											type="submit"
											class="btn btn--danger-soft btn--sm"
											onclick={(e) => {
												if (!confirm('このチャンネルの許可を削除します。よろしいですか?')) {
													e.preventDefault();
												}
											}}>削除</button
										>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<form method="POST" action="?/addDiscordChannel" class="form-row channel-form">
			<label class="field grow">
				<span class="field-label">DiscordサーバーID</span>
				<input
					class="input input--mono"
					type="text"
					name="guildId"
					required
					pattern="[0-9]+"
					placeholder="123456789012345678"
				/>
			</label>
			<label class="field grow">
				<span class="field-label">チャンネルID</span>
				<input
					class="input input--mono"
					type="text"
					name="channelId"
					required
					pattern="[0-9]+"
					placeholder="123456789012345678"
				/>
			</label>
			<button type="submit" class="btn btn--primary">チャンネルを許可</button>
		</form>
	</section>

	<!-- Danger zone -->
	<section class="danger-zone">
		<h2>このサーバーを削除</h2>
		<p>
			サーバーを削除すると、権限設定と Discord 設定も一緒に消えます。この操作は取り消せません。
		</p>
		<form
			method="POST"
			action="?/delete"
			onsubmit={(e) => {
				if (!confirm(`サーバー「${data.server.name}」を削除します。よろしいですか?`)) {
					e.preventDefault();
				}
			}}
		>
			<button type="submit" class="btn btn--danger">このサーバーを削除</button>
		</form>
	</section>
</main>

<style>
	.page {
		max-width: 760px;
		margin: 0 auto;
		padding: 28px 24px 64px;
	}
	.back-link {
		margin-bottom: 14px;
	}
	.detail-title {
		margin: 0 0 24px;
	}
	.banner {
		margin-bottom: 20px;
	}
	.channels-empty {
		font-size: 12.5px;
		color: var(--muted);
		margin: 16px 0;
	}
	.channels-table {
		margin: 18px 0;
	}
	.grow {
		flex: 1;
		min-width: 170px;
	}
</style>
