import { consoleIntro, createAssetPlugin, sharedPlugins } from './rollup.shared.js';

const common = {
  context: 'window',
  plugins: [createAssetPlugin('extension'), ...sharedPlugins],
};

const scripts = ['background', 'options', 'content', 'content-main', 'injected'];

export default scripts.map((script) =>
  Object.assign(
    {},
    {
      input: `./src/scripts/${script}.js`,
      output: {
        file: `./dist/scripts/${script}.js`,
        format: 'iife',
        sourcemap: false,
        intro: consoleIntro,
      },
    },
    common
  )
);
