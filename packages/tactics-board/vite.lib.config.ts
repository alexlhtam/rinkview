import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'dist/lib',
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
      cssFileName: 'style',
    },
    rollupOptions: { external: /^(react|react-dom)(\/|$)/ },
  },
})
