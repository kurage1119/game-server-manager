<script lang="ts">
	import { onMount } from 'svelte';

	// `floating` positions the toggle top-right on the header-less auth pages.
	let { floating = false }: { floating?: boolean } = $props();

	let theme = $state('light');

	onMount(() => {
		theme = document.documentElement.dataset.theme ?? 'light';
	});

	function toggle() {
		theme = theme === 'dark' ? 'light' : 'dark';
		document.documentElement.dataset.theme = theme;
		try {
			localStorage.setItem('sm-theme', theme);
		} catch {
			// Private mode / storage disabled — the toggle still works for this session.
		}
	}
</script>

<button
	type="button"
	class="theme-toggle"
	class:theme-toggle--floating={floating}
	onclick={toggle}
	title="テーマ切替"
>
	◐{#if floating}&nbsp;テーマ{/if}
</button>
