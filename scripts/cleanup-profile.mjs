import { rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const profileDir = join(__dirname, '..', 'chrome-test-profile');

rmSync(profileDir, { recursive: true, force: true });
console.log(`✓ Removed ${profileDir}`);
