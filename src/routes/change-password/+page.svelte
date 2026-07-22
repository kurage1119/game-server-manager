<script lang="ts">
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>パスワード変更</title>
</svelte:head>

<main class="page">
	<h1 class="page-title">パスワード変更</h1>
	<p class="page-sub">アカウントのパスワードを更新します。</p>

	{#if data.mustChangePassword}
		<div class="warn" role="status">
			<span class="warn-icon">!</span>
			<div>
				<div class="warn-title">仮パスワードでログインしています</div>
				<div class="warn-body">
					続行するには新しいパスワードを設定してください。設定が完了するまで他の画面には移動できません。
				</div>
			</div>
		</div>
	{/if}

	{#if form?.error}
		<div class="banner banner--error" role="alert">
			<span class="banner-dot"></span>
			<span>{form.error}</span>
		</div>
	{/if}

	<div class="card">
		<form method="POST" class="stack">
			{#if !data.mustChangePassword}
				<label class="field">
					<span class="field-label">現在のパスワード</span>
					<input
						class="input"
						type="password"
						name="currentPassword"
						required
						autocomplete="current-password"
					/>
				</label>
			{/if}
			<label class="field">
				<span class="field-label">新しいパスワード <span class="soft">(8文字以上)</span></span>
				<input
					class="input"
					type="password"
					name="newPassword"
					required
					autocomplete="new-password"
					minlength="8"
				/>
			</label>
			<label class="field">
				<span class="field-label">新しいパスワード(確認)</span>
				<input
					class="input"
					type="password"
					name="newPasswordConfirm"
					required
					autocomplete="new-password"
					minlength="8"
				/>
			</label>
			<button type="submit" class="btn btn--primary btn--block">パスワードを変更</button>
		</form>
	</div>
</main>

<style>
	.page {
		max-width: 480px;
		margin: 0 auto;
		padding: 40px 24px 60px;
	}
	.warn,
	.banner {
		margin: 22px 0;
	}
	.card {
		margin-top: 22px;
	}
	.btn--block {
		margin-top: 6px;
	}
</style>
