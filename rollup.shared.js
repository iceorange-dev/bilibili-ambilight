import fs from 'fs';
import { readFileSync } from 'fs';
import sass from 'sass';
import resolve from '@rollup/plugin-node-resolve';
import babel from '@rollup/plugin-babel';
import eslint from '@rollup/plugin-eslint';

// Shared between the extension build (rollup.config.js) and the userscript
// build (rollup.userscript.config.js).

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));

// Prepended to every bundle so that `console.*` calls are prefixed with the
// name of the script.
export const consoleIntro = fs
  .readFileSync('./src/scripts/intros/console.js', 'utf8')
  .replaceAll(/.*\/\/ eslint-disable.*/g, '');

export const sharedPlugins = [
  resolve(),
  eslint({
    overrideConfigFile: './eslint.config.js',
  }),
  babel({
    babelHelpers: 'bundled',
    comments: false,
    sourceMaps: true,
    plugins: [
      ['@babel/plugin-proposal-class-properties', { loose: true }],
      '@babel/plugin-proposal-optional-chaining',
      [
        'babel-plugin-transform-replace-expressions',
        {
          replace: {
            'globalThis.BARDETECTION_EDGE_RANGE': '32',
          },
        },
      ],
    ],
  }),
];

const NOISE_IMAGE_INDEXES = [1, 2, 3];

// The scripts are built for two very different hosts. `target` is baked into
// the bundle and read by src/scripts/libs/webext.js so that the runtime never
// has to guess (browser userscript managers do expose a `chrome` object).
const VIRTUAL_MODULES = {
  'ambilight:build-target': 'build target',
  'ambilight:version': 'version',
  'ambilight:content-css': 'stylesheet',
  'ambilight:noise-images': 'debanding noise textures',
};

const resolveVirtualId = (id) => `\0${id}`;

const loadVirtualModule = (id, target) => {
  if (id === resolveVirtualId('ambilight:build-target')) {
    return `export default ${JSON.stringify(target)};`;
  }

  if (id === resolveVirtualId('ambilight:version')) {
    return `export default ${JSON.stringify(packageJson.version)};`;
  }

  if (id === resolveVirtualId('ambilight:content-css')) {
    if (target !== 'userscript') {
      throw new Error('ambilight:content-css is only available in the userscript build');
    }

    const result = sass.compile('./src/styles/content.scss', {
      style: 'expanded',
      sourceMap: false,
    });
    return `export default ${JSON.stringify(result.css)};`;
  }

  if (id === resolveVirtualId('ambilight:noise-images')) {
    if (target !== 'userscript') {
      throw new Error('ambilight:noise-images is only available in the userscript build');
    }

    // The extension ships these tiles as image files. A userscript has no
    // extension folder to load them from, so they are embedded as data URLs
    // (which work in CSS, in every userscript manager, without any permission).
    const images = {};
    for (const index of NOISE_IMAGE_INDEXES) {
      const base64 = readFileSync(`./src/images/noise-${index}.png`).toString('base64');
      images[index] = `data:image/png;base64,${base64}`;
    }
    return `export default ${JSON.stringify(images)};`;
  }

  return null;
};

export const createAssetPlugin = (target) => ({
  name: 'ambilight-assets',
  resolveId(id) {
    if (id in VIRTUAL_MODULES) return resolveVirtualId(id);
    return null;
  },
  load(id) {
    const source = loadVirtualModule(id, target);
    if (source !== null) return source;
    return null;
  },
  // Keeps `rollup -c --watch` rebuilding when the embedded assets change.
  watchChange() {},
  buildStart() {
    if (target !== 'userscript') return;

    this.addWatchFile('./src/images/noise-1.png');
    this.addWatchFile('./src/images/noise-2.png');
    this.addWatchFile('./src/images/noise-3.png');
    this.addWatchFile('./src/styles/content.scss');
  },
});

export const userscriptConfig = packageJson.userscript;
export { packageJson };
