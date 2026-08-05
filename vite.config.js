import { defineConfig } from 'vite';

export default defineConfig({
  // .glb isn't in Vite's default known-asset list (confirmed by the dev
  // server erroring "invalid JS syntax" on it, not just from docs) — needed
  // for src/assets/mano_orco.glb, the orc-hand skin (RIG_SPEC.md).
  assetsInclude: ['**/*.glb'],
  build: {
    target: 'esnext'
  },
  esbuild: {
    target: 'esnext'
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext'
    }
  }
});
