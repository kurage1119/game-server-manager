<script lang="ts">
	import '../app.css';
	import { base } from '$app/paths';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
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
				<a href="{base}/admin/users" aria-label="ユーザー管理">
					<svg
						class="nav-icon"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
						<circle cx="9" cy="7" r="4" />
						<path d="M23 21v-2a4 4 0 0 0-3-3.87" />
						<path d="M16 3.13a4 4 0 0 1 0 7.75" />
					</svg>
					<span class="nav-label">ユーザー管理</span>
				</a>
				<a href="{base}/admin/servers" aria-label="サーバー管理">
					<svg
						class="nav-icon"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
						<rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
						<line x1="6" y1="6" x2="6.01" y2="6" />
						<line x1="6" y1="18" x2="6.01" y2="18" />
					</svg>
					<span class="nav-label">サーバー管理</span>
				</a>
			{/if}
			<a href="{base}/change-password" aria-label="パスワード変更">
				<svg
					class="nav-icon"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path
						d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"
					/>
				</svg>
				<span class="nav-label">パスワード変更</span>
			</a>
		</nav>
		<div class="header-right">
			<ThemeToggle />
			<span class="header-user">{data.user.username}</span>
			<form method="POST" action="{base}/logout">
				<button type="submit" class="btn btn--ghost btn--sm logout-btn" aria-label="ログアウト">
					<svg
						class="logout-icon"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
						<polyline points="16 17 21 12 16 7" />
						<line x1="21" y1="12" x2="9" y2="12" />
					</svg>
					<span class="logout-label">ログアウト</span>
				</button>
			</form>
		</div>
	</header>
{/if}

{@render children()}

<ConfirmDialog />

<style>
	form {
		margin: 0;
	}
	.logout-icon {
		display: none;
		width: 16px;
		height: 16px;
	}
	.app-nav a {
		display: inline-flex;
		align-items: center;
		gap: 7px;
	}
	.nav-icon {
		display: none;
		width: 16px;
		height: 16px;
	}
	/* On phones the header is cramped, so collapse nav links + logout to icons
	   and drop the username to keep everything on one row. */
	@media (max-width: 600px) {
		.nav-label,
		.logout-label,
		.header-user {
			display: none;
		}
		.nav-icon,
		.logout-icon {
			display: block;
		}
		.app-nav a {
			padding: 7px 9px;
		}
		.logout-btn {
			padding: 6px 9px;
		}
	}
</style>
