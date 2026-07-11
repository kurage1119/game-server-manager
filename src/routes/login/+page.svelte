<script lang="ts">
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>ログイン</title>
</svelte:head>

<div class="auth-wrap">
	<ThemeToggle floating />

	<div class="auth-inner">
		<div class="auth-brand">
			<span class="brand-mark"></span>
			<span class="auth-brand-name">Server Manager</span>
		</div>

		<div class="auth-card">
			<h1 class="auth-title">ログイン</h1>
			<p class="auth-sub">アカウント情報を入力してください。</p>

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
					/>
				</label>
				<label class="field">
					<span class="field-label">パスワード</span>
					<input
						class="input"
						type="password"
						name="password"
						required
						autocomplete="current-password"
					/>
				</label>
				<button type="submit" class="btn btn--primary btn--block">ログイン</button>
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
