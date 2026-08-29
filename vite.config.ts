import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * GitHub Pages serves this as a project site under /<repo>/, so every URL the
 * app emits needs that prefix. It is set once here and read everywhere else via
 * `import.meta.env.BASE_URL` (router basepath, manifest, icons). Local dev and
 * `vite preview` leave it as "/".
 */
const base = process.env.BASE_PATH ?? "/";

const config = defineConfig({
	base,
	resolve: { tsconfigPaths: true },
	server: {
		host: true,
		allowedHosts: true,
	},
	plugins: [
		devtools(),
		tailwindcss(),
		// No server functions or loaders in this app — everything talks to the
		// iAqualink APIs straight from the browser — so Start prerenders a static
		// shell and the whole thing ships as a plain SPA.
		tanstackStart({
			// Emit the prerendered shell straight to index.html; the build script
			// then copies it to 404.html so Pages can serve deep links.
			spa: { enabled: true, prerender: { outputPath: "/index" } },
		}),
		viteReact(),
	],
});

export default config;
