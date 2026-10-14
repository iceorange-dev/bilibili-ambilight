/**
 * Userscript entry point.
 *
 * This file replaces src/scripts/content.js of the extension build. The
 * extension loads three separate scripts: content.js (injects the stylesheet,
 * injects injected.js into the page world and dynamically imports
 * content-main.js), injected.js and content-main.js. A userscript is a single
 * file that runs in one realm, so this entry point loads all of them itself.
 */
import noiseImageUrls from 'ambilight:noise-images';
import contentCss from 'ambilight:content-css';
import { setErrorHandler } from './libs/generic';
import ErrorReporter from './libs/errors/reporter';
import { injectedScript } from './libs/messaging/injected';
import {
  addStyle,
  getVersion,
  setNoiseImageUrls,
  waitForDocumentElement,
  watchStyleElement,
} from './libs/webext';
import { registerUserscriptMenu } from './userscript-menu';
// Evaluate injected.js (the page world part of the extension) before
// content-main.js (the engine), like the extension build does.
import './injected';
import './content-main';

// The debanding feature uses the noise textures that the extension ships as
// image files. The userscript build embeds them as data URLs.
setNoiseImageUrls(noiseImageUrls);

setErrorHandler((ex) => ErrorReporter.captureException(ex));

// injected.js reports its errors by messaging the content script (see
// content.js). Both scripts share this realm in the userscript build, so make
// sure the messages are still logged.
injectedScript.addMessageListener('error', (injectedEx) => {
  const ex = new Error(injectedEx.message);
  ex.name = injectedEx.name;
  ex.stack = injectedEx.stack;
  if (injectedEx.details) ex.details = injectedEx.details;

  ErrorReporter.captureException(ex);
});

waitForDocumentElement().then(() => {
  addStyle(contentCss);
  watchStyleElement();
});

registerUserscriptMenu();

console.log(`使用者腳本版 v${getVersion()} 已載入。`);
