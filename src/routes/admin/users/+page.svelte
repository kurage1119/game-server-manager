<script lang="ts">
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>ユーザー管理</title>
</svelte:head>

<main class="page">
	<h1 class="page-title">ユーザー管理</h1>
	<p class="page-sub">ユーザーの一覧・追加・仮パスワード再発行・削除を行います。</p>

	{#if form?.error}
		<div class="banner banner--error" role="alert">
			<span class="banner-dot"></span>
			<span>{form.error}</span>
		</div>
	{:else if form?.deleted}
		<div class="banner banner--success" role="status">
			<span class="banner-dot"></span>
			<span>ユーザーを削除しました。</span>
		</div>
	{/if}

	{#if form?.tempPassword}
		<div class="temp-panel" role="alert">
			<div class="temp-head">
				<span class="warn-icon">!</span>
				仮パスワード発行(この画面でしか表示されません)
			</div>
			<div class="temp-target">対象ユーザー: <strong>{form.tempPasswordFor}</strong></div>
			<p class="temp-value">{form.tempPassword}</p>
			<p class="temp-note">
				この値は再表示できません。今すぐ本人に伝えてください。初回ログイン時に新しいパスワードの設定が求められます。
			</p>
		</div>
	{/if}

	<div class="table-card">
		<table class="data-table">
			<thead>
				<tr>
					<th>ユーザー名</th>
					<th>管理者</th>
					<th>仮PW状態</th>
					<th>作成日</th>
					<th class="col-actions">操作</th>
				</tr>
			</thead>
			<tbody>
				{#each data.users as user (user.id)}
					<tr>
						<td>{user.username}</td>
						<td>
							{#if user.isAdmin}
								<span class="admin-yes">✓</span>
							{:else}
								<span class="muted">—</span>
							{/if}
						</td>
						<td>
							{#if user.mustChangePassword}
								<span class="badge badge--yellow">仮PW(変更待ち)</span>
							{:else}
								<span class="muted">—</span>
							{/if}
						</td>
						<td class="mono muted">{user.createdAt}</td>
						<td class="col-actions">
							<div class="row-actions">
								<form method="POST" action="?/reissuePassword">
									<input type="hidden" name="userId" value={user.id} />
									<button
										type="submit"
										class="btn btn--ghost btn--sm"
										onclick={(e) => {
											if (
												!confirm(
													`${user.username} の仮パスワードを再発行します。既存のログインセッションはすべて無効になります。よろしいですか?`
												)
											) {
												e.preventDefault();
											}
										}}>仮PW再発行</button
									>
								</form>
								<form method="POST" action="?/delete">
									<input type="hidden" name="userId" value={user.id} />
									<button
										type="submit"
										class="btn btn--danger-soft btn--sm"
										onclick={(e) => {
											if (!confirm(`ユーザー「${user.username}」を削除します。よろしいですか?`)) {
												e.preventDefault();
											}
										}}>削除</button
									>
								</form>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<div class="card add-card">
		<h2 class="section-title">ユーザーを追加</h2>
		<p class="section-desc">
			作成すると12文字の仮パスワードが発行され、初回ログイン時に本パスワードの設定が強制されます。
		</p>
		<form method="POST" action="?/create" class="form-row">
			<label class="field grow">
				<span class="field-label">ユーザー名</span>
				<input class="input" type="text" name="username" required placeholder="例: tanaka" />
			</label>
			<label class="check">
				<input type="checkbox" name="isAdmin" />
				管理者にする
			</label>
			<button type="submit" class="btn btn--primary">追加</button>
		</form>
	</div>
</main>

<style>
	.page {
		max-width: 900px;
		margin: 0 auto;
		padding: 32px 24px 64px;
	}
	.page-sub {
		margin-bottom: 24px;
	}
	.banner,
	.temp-panel {
		margin-bottom: 24px;
	}
	.table-card {
		margin-bottom: 28px;
	}
	.add-card .section-title {
		margin-bottom: 4px;
	}
	.admin-yes {
		color: var(--green);
		font-weight: 600;
	}
	.grow {
		flex: 1;
		min-width: 200px;
	}
	.check {
		padding: 11px 0;
	}
</style>
