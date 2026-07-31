import { defineConfig } from 'vite';

// Project pages are served at https://<user>.github.io/<repo>/, so every
// asset URL needs that repo-name prefix baked in at build time — hence the
// non-root base here (must match the GitHub repo name exactly).
export default defineConfig({
  base: '/Sierpi-ski_Tetrahedron/',
});
