import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Context path for serving behind a reverse proxy under a subpath.
// Must start with '/' and NOT end with '/' (e.g. '/server-manager'). This is a
// BUILD-TIME constant baked into the output — set BASE_PATH before `npm run build`
// and rebuild to change it. Unset/empty = served at root '/' (unchanged behavior).
const base = process.env.BASE_PATH || '';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		paths: {
			base
		}
	}
};

export default config;
