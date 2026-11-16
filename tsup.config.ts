import { readFileSync } from 'node:fs';
import { defineConfig, type Options } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

const requireShim = [
  "import { createRequire as __songNganCreateRequire } from 'node:module';",
  'const require = __songNganCreateRequire(import.meta.url);',
].join('\n');

const shared: Options = {
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  splitting: false,
  sourcemap: false,
  minify: false,
  noExternal: [/.*/],
  external: ['@napi-rs/keyring'],
  define: {
    __SONGNGAN_VERSION__: JSON.stringify(pkg.version),
  },
};

export default defineConfig([
  {
    ...shared,
    entry: { index: 'src/index.ts' },
    banner: { js: `#!/usr/bin/env node\n${requireShim}` },
  },
  {
    ...shared,
    entry: { lib: 'src/lib.ts' },
    dts: true,
    banner: { js: requireShim },
  },
]);
