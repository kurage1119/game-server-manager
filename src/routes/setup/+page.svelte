<script lang="ts">
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>初回セットアップ</title>
</svelte:head>

<div class="auth-wrap">
	<ThemeToggle floating />

	<div class="auth-inner">
		<div class="auth-brand">
			<span class="brand-mark"></span>
			<span class="auth-brand-name">Server Manager</span>
		</div>

		<div class="auth-card">
			<span class="auth-pill">初回インストール</span>
			<h1 class="auth-title">初回セットアップ</h1>
			<p class="auth-sub">
				このツールはまだ管理者アカウントが登録されていません。最初の管理者アカウントを作成してください。
				作成すると自動的にログインします。
			</p>

			{#if form?.error}
				<div class="banner banner--error" role="alert">
					<span class="banner-dot"></span>
					<span>{form.error}</span>
				</div>
			{/if}

			<form method="POST" class="stack">
				<label class="field">
					<span class="field-label">ユーザー名</span>
					<input
						class="input"
						type="text"
						name="username"
						value={form?.username ?? ''}
						required
						autocomplete="username"
						placeholder="admin"
					/>
				</label>
				<label class="field">
					<span class="field-label">パスワード <span class="soft">(8文字以上)</span></span>
					<input
						class="input"
						type="password"
						name="password"
						required
						autocomplete="new-password"
						minlength="8"
					/>
				</label>
				<label class="field">
					<span class="field-label">パスワード(確認)</span>
					<input
						class="input"
						type="password"
						name="passwordConfirm"
						required
						autocomplete="new-password"
						minlength="8"
					/>
				</label>
				<button type="submit" class="btn btn--primary btn--block">管理者アカウントを作成</button>
			</form>
		</div>
	</div>
</div>

<style>
	.banner {
		margin-bottom: 20px;
	}
	.btn--block {
		margin-top: 8px;
	}
</style>
