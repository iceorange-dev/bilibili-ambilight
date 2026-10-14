import { readFileSync } from 'fs';
import {
  consoleIntro,
  createAssetPlugin,
  packageJson,
  sharedPlugins,
  userscriptConfig,
} from './rollup.shared.js';

const metadata = readFileSync('./src/userscript.meta.txt', 'utf8')
  .replaceAll('\r\n', '\n')
  .replaceAll('{{version}}', packageJson.version)
  .replaceAll('{{namespace}}', userscriptConfig.namespace)
  .replaceAll('{{homepage}}', userscriptConfig.homepage);

// Builds ./bilibili-ambilight.user.js: the whole extension bundled into a
// single file that Tampermonkey, Violentmonkey and Greasemonkey can install.
export default {
  input: './src/scripts/userscript.js',
  output: {
    file: userscriptConfig.outputFile,
    format: 'iife',
    sourcemap: false,
    banner: metadata,
    intro: consoleIntro,
  },
  context: 'window',
  plugins: [createAssetPlugin('userscript'), ...sharedPlugins],
};
