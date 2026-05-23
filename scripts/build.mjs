import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { copyFileSync } from 'fs';
import { spawnSync } from 'child_process';

const outDir = 'dist';

// Helper: run a command and exit on failure
function runStep(label, cmd, args) {
  console.log(label);
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`\n❌ ${label.trim().replace(/[.][\.]*$/, '')} failed. Aborting build.`);
    process.exit(1);
  }
  console.log(`  ✓ ${label.trim().replace(/[.][\.]*$/, '').replace(/.*\n/, '')} passed`);
}

// 0. TypeScript type-check
runStep('Type-checking with tsc...', 'npx', ['tsc', '--noEmit']);

// 0b. Test coverage (with threshold check)
runStep('Checking test coverage thresholds...\n', 'npx', ['vitest', 'run', '--coverage']);

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
