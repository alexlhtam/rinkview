import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { fileURLToPath } from 'node:url';

const proxy = { '/api/analyze': { target: 'http://127.0.0.1:8000', rewrite: () => '/analyze' } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), fileURLToPath(new URL('../../shared', import.meta.url))],
    },
  },
  preview: { proxy },
});
