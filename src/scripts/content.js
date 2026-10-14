import { getVersion } from './libs/utils';
import {
  appendErrorStack,
  setErrorHandler,
  setWarning,
  wrapErrorHandler,
} from './libs/generic';
import ErrorReporter from './libs/errors/reporter';
import { injectedScript } from './libs/messaging/injected';
import { t } from './libs/i18n';

setErrorHandler((ex) => ErrorReporter.captureException(ex));

injectedScript.addMessageListener('error', (injectedEx) => {
  const ex = new Error(injectedEx.message);
  ex.name = injectedEx.name;
  ex.stack = injectedEx.stack;
  if (injectedEx.details) ex.details = injectedEx.details;

  ErrorReporter.captureException(ex);
});

const setResourceWarning = (url) => {
  setWarning(
    url
      ? t(`無法載入資源，請重新整理網頁再試一次。
更新擴充功能後可能會發生這種情況。

如果經常發生，可以在瀏覽器開發人員工具的 Console 面板查看錯誤。
提示：搜尋與這個網址有關的錯誤：{url}`, { url })
      : t(`擴充功能已經更新、重新載入或解除安裝，無法在這個網頁上載入。
請重新整理網頁來重新載入擴充功能。`)
  );
};

const waitForHtmlElement = async () => {
  if (document.documentElement) return;

  const stack = new Error().stack;
  await new Promise((resolve, reject) => {
    try {
      const observer = new MutationObserver(
        wrapErrorHandler(
          function onHtmlElementMutation() {
            if (!document.documentElement) return;

            observer.disconnect();
            resolve();
          }.bind(this),
          true
        )
      );
      observer.observe(document, { childList: true });
    } catch (ex) {
      appendErrorStack(stack, ex);
      reject(ex);
    }
  });
};

const waitForHeadElement = async () => {
  if (document.head) return;

  const stack = new Error().stack;
  await new Promise((resolve, reject) => {
    try {
      const observer = new MutationObserver(
        wrapErrorHandler(
          function onHeadElementMutation() {
            if (!document.head) return;

            observer.disconnect();
            resolve();
          }.bind(this),
          true
        )
      );
      observer.observe(document.documentElement, { childList: true });
    } catch (ex) {
      appendErrorStack(stack, ex);
      reject(ex);
    }
  });
};

const captureResourceLoadingException = async (url, event) => {
  if (!chrome?.runtime?.id) {
    setResourceWarning();
    return;
  }

  let error;
  try {
    const stack = new Error().stack;
    await new Promise((resolve, reject) => {
      try {
        const req = new XMLHttpRequest();
        req.onreadystatechange = () => {
          try {
            if (req.readyState == XMLHttpRequest.DONE) {
              if (req.status !== 200) {
                error = new Error(
                  `Cannot load ${url} (Status: ${req.statusText} ${req.status})`
                );
                appendErrorStack(stack, error);
              }
              resolve();
            }
          } catch (ex) {
            reject(ex);
          }
        };
        req.open('GET', url, true);
        req.send();
      } catch (ex) {
        appendErrorStack(stack, ex);
        reject(ex);
      }
    });
  } catch (ex) {
    error = ex;
  } finally {
    if (error) {
      error.details = event;
      ErrorReporter.captureException(error);
    }

    setResourceWarning(url);
  }
};

wrapErrorHandler(async function loadContentScript() {
  const version = getVersion();

  await waitForHtmlElement();
  await waitForHeadElement();

  // const addWebGLLint = () => {
  //   const s = document.createElement('script')
  //   s.src = 'https://greggman.github.io/webgl-lint/webgl-lint.js'
  //   s.setAttribute('data-gman-debug-helper', JSON.stringify({
  //     throwOnError: false
  //   }))
  //   s.onerror = function injectScriptOnError(ex) {
  //     console.error(ex)
  //   }.bind(this)
  //   document.body.appendChild(s)
  // }
  // addWebGLLint()

  if (!chrome?.runtime?.id) {
    setResourceWarning();
    return;
  }

  let loaded = await new Promise((resolve) => {
    let url;
    try {
      url = chrome.runtime.getURL('styles/content.css');
    } catch {
      setResourceWarning();
      resolve(false);
      return;
    }

    // Inject into <html> instead of <head>: on the bangumi/movie pages the React
    // head manager (Next.js updateHead) removes every <head> child of the same
    // tag type that it did not render this pass, which deletes a stylesheet
    // injected at document_start.
    if (document.querySelector(`link[href="${url}"]`)) {
      resolve(true);
      return;
    }

    const style = document.createElement('link');
    style.href = url;
    style.rel = 'stylesheet';
    style.addEventListener(
      'error',
      async function injectStyleOnError(event) {
        await captureResourceLoadingException(style.href, event);
        resolve(false);
      }.bind(this)
    );
    style.addEventListener(
      'load',
      function injectStyleOnLoad() {
        resolve(true);
      }.bind(this)
    );
    document.documentElement.appendChild(style);
  });
  if (!chrome?.runtime?.id) {
    setResourceWarning();
    return;
  }
  if (!loaded) return;

  loaded = await new Promise((resolve) => {
    let url;
    try {
      url = chrome.runtime.getURL('scripts/injected.js');
    } catch {
      setResourceWarning();
      resolve(false);
      return;
    }

    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.setAttribute('data-version', version);
    script.addEventListener(
      'error',
      async function injectScriptOnError(event) {
        await captureResourceLoadingException(script.src, event);
        resolve(false);
      }.bind(this)
    );
    script.addEventListener(
      'load',
      function injectStyleOnLoad() {
        resolve(true);
      }.bind(this)
    );
    document.head.appendChild(script);
  });
  if (!chrome?.runtime?.id) {
    setResourceWarning();
    return;
  }
  if (!loaded) return;

  let scriptUrl;
  try {
    scriptUrl = chrome.runtime.getURL('scripts/content-main.js');
  } catch {
    setResourceWarning();
    return;
  }

  try {
    await import(scriptUrl);
  } catch (error) {
    await captureResourceLoadingException(scriptUrl, error);
  }
})();
