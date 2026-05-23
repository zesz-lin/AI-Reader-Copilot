import { spawn } from 'child_process';
import { existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'dist');
const profileDir = join(root, 'chrome-test-profile');

async function build() {
  // 1. Type-check
  console.log('Type-checking…');
  await run('npx', ['tsc', '--noEmit']);

  // 2. Build side panel
  console.log('Building side panel…');
  await viteBuild();

  // 3. Build background & content scripts
  console.log('Building scripts…');
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

  // 4. Copy manifest
  copyFileSync(join(root, 'manifest.json'), join(outDir, 'manifest.json'));
  console.log('✓ Build complete');
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: true });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

function findChrome() {
  const candidates = [];

  if (process.platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LocalAppData'] || 'C:\\Users\\Default\\AppData\\Local';

    candidates.push(
      join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
      join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
      join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
      'chrome',
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      'google-chrome',
      'chrome',
    );
  } else {
    // Linux
    candidates.push(
      'google-chrome',
      'google-chrome-stable',
      'chromium-browser',
      'chromium',
      'chrome',
    );
  }

  for (const c of candidates) {
    if (existsSync(c) || c === 'chrome' || c === 'google-chrome' || c === 'google-chrome-stable' || c === 'chromium-browser' || c === 'chromium') {
      // For bare commands (no path), just check that they're available
      if (!c.includes('\\') && !c.includes('/')) {
        try {
          const proc = spawn(c, ['--version'], { stdio: 'pipe', shell: true });
          return new Promise((resolve) => {
            proc.on('close', (code) => resolve(code === 0 ? c : null));
            proc.on('error', () => resolve(null));
          });
        } catch { /* */ }
        continue;
      }
      return c;
    }
  }
  return null;
}

async function main() {
  const noBuild = process.argv.includes('--no-build');

  if (noBuild) {
    if (!existsSync(join(outDir, 'manifest.json'))) {
      console.error(`No build found in ${outDir}. Run without --no-build first, or run "npm run build".`);
      process.exit(1);
    }
    console.log('Skipping build (--no-build flag detected).');
  } else {
    try {
      await build();
    } catch (e) {
      console.error('Build failed:', e.message);
      process.exit(1);
    }
  }

  const chrome = await findChrome();
  if (!chrome) {
    console.error('Could not find Chrome installation. Please install Google Chrome.');
    process.exit(1);
  }

  console.log(`\nLaunching Chrome with extension from: ${outDir}`);
  console.log(`Using profile: ${profileDir}\n`);

  const child = spawn(chrome, [
    `--load-extension=${outDir}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });

  child.on('close', (code) => {
    if (code !== null && code !== 0) {
      console.log(`Chrome exited with code ${code}`);
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
