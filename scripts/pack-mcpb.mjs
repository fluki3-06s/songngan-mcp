import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const readJson = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));

const pkg = readJson('package.json');
const manifest = readJson('manifest.json');
const stage = join(root, 'build', 'mcpb');
const releaseDir = join(root, 'release');
const output = join(releaseDir, `song-ngan-${pkg.version}.mcpb`);

if (!existsSync(join(root, 'dist', 'index.js'))) {
  console.error('dist/index.js not found. Run `npm run build` first.');
  process.exit(1);
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'dist'), { recursive: true });
mkdirSync(releaseDir, { recursive: true });

cpSync(join(root, 'dist', 'index.js'), join(stage, 'dist', 'index.js'));
for (const file of ['README.md', 'LICENSE', 'icon.png']) {
  if (existsSync(join(root, file))) cpSync(join(root, file), join(stage, file));
}

const finalManifest = { ...manifest, version: pkg.version };
if (existsSync(join(stage, 'icon.png'))) finalManifest.icon = 'icon.png';
writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(finalManifest, null, 2)}\n`);

const result = spawnSync('npx', ['--yes', '@anthropic-ai/mcpb', 'pack', stage, output], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.status === 0) console.log(`\nCreated ${output}`);
process.exit(result.status ?? 1);
