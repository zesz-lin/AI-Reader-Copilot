import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { copyFileSync } from 'fs';

const outDir = 'dist';

// 1. Build the React side panel (Vite cleans dist by default, copies public/)
console.log('Building side panel...');
await viteBuild();
console.log('  ✓ Side panel built');

// 2. Build background & content scripts — flat output with named keys
console.log('Building background & content scripts...');
await esbuild({
  entryPoints: {
    background: 'src/background/index.ts',
    content: 'src/content/index.ts',
  },
  bundle: true,
  outdir: outDir,
  format: 'iife',
  target: 'es2020',
  platform: 'browser',
});
console.log('  ✓ Scripts built');

// 3. Copy manifest to dist
copyFileSync('manifest.json', `${outDir}/manifest.json`);
console.log('  ✓ Manifest copied');

console.log('\nBuild complete. Load the dist/ folder as an unpacked extension.');
