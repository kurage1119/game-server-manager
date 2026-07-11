<script lang="ts">
	import '../app.css';
	import { base } from '$app/paths';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	// In forced password-change mode the user cannot navigate away, so the nav
	// is shown disabled to reflect that (hooks.server.ts enforces it server-side).
	const locked = $derived(data.user?.mustChangePassword ?? false);
</script>

{#if data.user}
	<header class="app-header">
		<a href="{base}/" class="brand">
			<span class="brand-mark"></span>
			<span class="brand-name">Server Manager</span>
		</a>
		<nav class="app-nav" class:app-nav--disabled={locked}>
			{#if data.user.isAdmin}
				<a href="{base}/admin/users">ユーザー管理</a>
				<a href="{base}/admin/servers">サーバー管理</a>
			{/if}
			<a href="{base}/change-password">パスワード変更</a>
		</nav>
		<div class="header-right">
			<ThemeToggle />
			<span class="header-user">{data.user.username}</span>
			<form method="POST" action="{base}/logout">
				<button type="submit" class="btn btn--ghost btn--sm">ログアウト</button>
			</form>
		</div>
	</header>
{/if}

{@render children()}

<style>
	form {
		margin: 0;
	}
</style>
