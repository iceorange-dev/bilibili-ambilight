/**
 * Platform abstraction layer.
 *
 * Everything below src/scripts/ is shared by two very different builds:
 *
 * - the WebExtension build (rollup.config.js), which runs as a Chrome/Firefox
 *   content script and talks to the `chrome.*` APIs;
 * - the userscript build (rollup.userscript.config.js), which runs as a single
 *   Tampermonkey / Violentmonkey / Greasemonkey script and talks to the `GM_*`
 *   APIs, falling back to `localStorage` when none of them exist.
 *
 * The build target is baked in at build time (`ambilight:build-target`) instead
 * of being detected at runtime, because userscript managers also expose a
 * `chrome` object which would make a runtime detection unreliable.
 */
import buildTarget from 'ambilight:build-target';
import buildVersion from 'ambilight:version';

const globalScope = globalThis;

export const isExtensionBuild = buildTarget === 'extension';
export const isUserscriptBuild = !isExtensionBuild;

const chromeApi = isExtensionBuild ? globalScope.chrome : undefined;
const chromeStorage = chromeApi?.storage;

// ---------------------------------------------------------------------------
// Userscript manager API
// ---------------------------------------------------------------------------

// Userscript managers implement different subsets of the GM_* API, so every
// function is looked up on its own. Managers that do not know a function
// simply leave it undefined.
const gm = {
  getValue: typeof GM_getValue === 'function' ? GM_getValue : undefined,
  setValue: typeof GM_setValue === 'function' ? GM_setValue : undefined,
  deleteValue: typeof GM_deleteValue === 'function' ? GM_deleteValue : undefined,
  listValues: typeof GM_listValues === 'function' ? GM_listValues : undefined,
  addValueChangeListener:
    typeof GM_addValueChangeListener === 'function'
      ? GM_addValueChangeListener
      : undefined,
  removeValueChangeListener:
    typeof GM_removeValueChangeListener === 'function'
      ? GM_removeValueChangeListener
      : undefined,
  registerMenuCommand:
    typeof GM_registerMenuCommand === 'function'
      ? GM_registerMenuCommand
      : undefined,
  unregisterMenuCommand:
    typeof GM_unregisterMenuCommand === 'function'
      ? GM_unregisterMenuCommand
      : undefined,
  addStyle: typeof GM_addStyle === 'function' ? GM_addStyle : undefined,
  notification:
    typeof GM_notification === 'function' ? GM_notification : undefined,
  setClipboard:
    typeof GM_setClipboard === 'function' ? GM_setClipboard : undefined,
  openInTab: typeof GM_openInTab === 'function' ? GM_openInTab : undefined,
  info: typeof GM_info === 'object' && GM_info !== null ? GM_info : undefined,
};

// ---------------------------------------------------------------------------
// Runtime information
// ---------------------------------------------------------------------------

/**
 * The extension code uses this to detect that the extension has been reloaded
 * or uninstalled while the page was open. A userscript always has its storage.
 */
export const isContextValid = () =>
  isExtensionBuild ? Boolean(globalScope.chrome?.runtime?.id) : true;

export const getVersion = () => {
  try {
    if (isExtensionBuild) return chromeApi.runtime.getManifest().version;
    return gm.info?.script?.version || buildVersion;
  } catch (ex) {
    console.warn('無法取得擴充功能／腳本的版本號', ex);
    return buildVersion;
  }
};

/**
 * The original code links to the README and the troubleshooting guide of the
 * original YouTube extension.
 */
export const getHomepageUrl = () =>
  gm.info?.script?.homepageURL ||
  gm.info?.script?.namespace ||
  'https://github.com/iceorange-dev/bilibili-ambilight';

// ---------------------------------------------------------------------------
// Settings storage (chrome.storage compatible)
// ---------------------------------------------------------------------------

/**
 * Chrome's storage API is callback based and reports failures through
 * `chrome.runtime.lastError`. The shim below implements the same shape on top
 * of the GM_* API (or localStorage) so that src/scripts/libs/storage.js and
 * src/scripts/libs/sync-storage.js do not need to branch.
 */
class StorageChangeListeners {
  listeners = [];

  addListener(handler) {
    if (typeof handler !== 'function') return;
    if (this.listeners.includes(handler)) return;
    this.listeners.push(handler);
  }

  removeListener(handler) {
    const index = this.listeners.indexOf(handler);
    if (index !== -1) this.listeners.splice(index, 1);
  }

  emit(changes) {
    for (const handler of [...this.listeners]) {
      try {
        handler(changes);
      } catch (ex) {
        console.warn('儲存空間的變更監聽器發生錯誤', ex);
      }
    }
  }
}

const LOCAL_STORAGE_PREFIX = 'ambientlight-userscript:';

const createGmValueStore = () => ({
  getValue: (key) =>
    gm.getValue ? gm.getValue(key) : undefined,
  setValue: (key, value) => {
    if (gm.setValue) gm.setValue(key, value);
  },
  deleteValue: (key) => {
    if (gm.deleteValue) gm.deleteValue(key);
  },
  listKeys: () => (gm.listValues ? gm.listValues() : []),
});

const createLocalStorageValueStore = () => {
  const storage = globalScope.localStorage;
  const namespacedKey = (key) => `${LOCAL_STORAGE_PREFIX}${key}`;
  return {
    getValue(key) {
      const raw = storage.getItem(namespacedKey(key));
      if (raw === null) return undefined;
      try {
        const value = JSON.parse(raw);
        return value === null ? undefined : value;
      } catch {
        return undefined;
      }
    },
    setValue(key, value) {
      storage.setItem(
        namespacedKey(key),
        JSON.stringify(value === undefined ? null : value)
      );
    },
    deleteValue(key) {
      storage.removeItem(namespacedKey(key));
    },
    listKeys() {
      const keys = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key?.startsWith(LOCAL_STORAGE_PREFIX))
          keys.push(key.substring(LOCAL_STORAGE_PREFIX.length));
      }
      return keys;
    },
  };
};

const createMemoryValueStore = () => {
  const values = new Map();
  return {
    getValue: (key) => values.get(key),
    setValue: (key, value) => values.set(key, value),
    deleteValue: (key) => values.delete(key),
    listKeys: () => [...values.keys()],
  };
};

const createValueStore = () => {
  if (gm.getValue && gm.setValue) return createGmValueStore();

  try {
    const testKey = `${LOCAL_STORAGE_PREFIX}test`;
    globalScope.localStorage.setItem(testKey, '1');
    globalScope.localStorage.removeItem(testKey);
    return createLocalStorageValueStore();
  } catch {
    console.warn(
      '無法使用 GM 儲存空間與 localStorage，設定將不會被保存。'
    );
    return createMemoryValueStore();
  }
};

const valueStore = isExtensionBuild ? undefined : createValueStore();

class ShimStorageArea {
  lastError = null;
  onChanged = new StorageChangeListeners();
  watchedKeys = new Set();

  constructor(store, keyPrefix = '') {
    this.store = store;
    this.keyPrefix = keyPrefix;
  }

  getStorageKey(name) {
    return `${this.keyPrefix}${name}`;
  }

  getNames(keys) {
    if (keys === null || keys === undefined) {
      return this.store
        .listKeys()
        .filter((key) => key.startsWith(this.keyPrefix))
        .map((key) => key.substring(this.keyPrefix.length));
    }
    if (Array.isArray(keys)) return keys;
    if (typeof keys === 'string') return [keys];
    return Object.keys(keys);
  }

  /**
   * Reports changes that were made in another tab. GM_addValueChangeListener
   * needs a key, so listeners are registered lazily for keys we have seen.
   */
  watchKey(name) {
    if (!gm.addValueChangeListener) return;

    const storageKey = this.getStorageKey(name);
    if (this.watchedKeys.has(storageKey)) return;
    this.watchedKeys.add(storageKey);

    gm.addValueChangeListener(
      storageKey,
      (key, oldValue, newValue, remote) => {
        if (!remote) return; // Changes of this tab are reported by set()/remove()
        this.onChanged.emit({ [name]: { oldValue, newValue } });
      }
    );
  }

  get(keys, callback) {
    const result = {};
    for (const name of this.getNames(keys)) {
      this.watchKey(name);
      const value = this.store.getValue(this.getStorageKey(name));
      if (value !== undefined) result[name] = value;
    }

    // chrome.storage supports passing defaults as an object
    if (keys && typeof keys === 'object' && !Array.isArray(keys)) {
      for (const [name, defaultValue] of Object.entries(keys)) {
        if (!(name in result)) result[name] = defaultValue;
      }
    }

    if (callback) callback(result);
  }

  set(namesAndValues, callback) {
    const changes = {};
    for (const [name, value] of Object.entries(namesAndValues ?? {})) {
      this.watchKey(name);

      const storageKey = this.getStorageKey(name);
      const oldValue = this.store.getValue(storageKey);

      if (value === undefined) {
        if (oldValue === undefined) continue;
        this.store.deleteValue(storageKey);
        changes[name] = { oldValue, newValue: undefined };
        continue;
      }

      this.store.setValue(storageKey, value);
      changes[name] = { oldValue, newValue: value };
    }

    if (Object.keys(changes).length) this.onChanged.emit(changes);
    if (callback) callback();
  }

  remove(names, callback) {
    const changes = {};
    for (const name of Array.isArray(names) ? names : [names]) {
      const storageKey = this.getStorageKey(name);
      const oldValue = this.store.getValue(storageKey);
      if (oldValue === undefined) continue;

      this.store.deleteValue(storageKey);
      changes[name] = { oldValue, newValue: undefined };
    }

    if (Object.keys(changes).length) this.onChanged.emit(changes);
    if (callback) callback();
  }
}

class ChromeStorageArea {
  constructor(area) {
    this.area = area;
  }

  get lastError() {
    return globalScope.chrome?.runtime?.lastError;
  }

  get onChanged() {
    return this.area.onChanged;
  }

  get(keys, callback) {
    this.area.get(keys, callback);
  }

  set(namesAndValues, callback) {
    this.area.set(namesAndValues, callback);
  }

  remove(names, callback) {
    this.area.remove(names, callback);
  }
}

export const storageLocal = chromeStorage?.local
  ? new ChromeStorageArea(chromeStorage.local)
  : new ShimStorageArea(valueStore);

export const storageSync = chromeStorage?.sync
  ? new ChromeStorageArea(chromeStorage.sync)
  : new ShimStorageArea(valueStore, 'sync:');

// ---------------------------------------------------------------------------
// Debanding noise textures
// ---------------------------------------------------------------------------

// The extension ships the textures as image files next to the scripts. The
// userscript build embeds them as data URLs (see rollup.shared.js).
let noiseImageUrls = {};

export const setNoiseImageUrls = (urls) => {
  noiseImageUrls = urls ?? {};
};

export const getNoiseImageUrl = (index) =>
  isExtensionBuild
    ? `${chromeApi.runtime.getURL('')}images/noise-${index}.png`
    : noiseImageUrls[index] || '';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

let injectedStyleElem;

/**
 * Injects the stylesheet of the script and keeps it alive.
 *
 * On the bangumi/movie pages Bilibili uses a React head manager (Next.js
 * updateHead) that removes every <head> child it did not render itself. The
 * extension therefore injects into <html> instead of <head>, which this
 * function does as well.
 */
export const addStyle = (css) => {
  if (injectedStyleElem?.isConnected) return injectedStyleElem;

  let elem;
  try {
    if (gm.addStyle) elem = gm.addStyle(css);
  } catch (ex) {
    console.warn('GM_addStyle 失敗，改用 <style> 元素注入樣式', ex);
  }

  if (!elem || !elem.parentNode) {
    elem = document.createElement('style');
    elem.textContent = css;
  }

  if (elem.parentElement !== document.documentElement)
    document.documentElement.appendChild(elem);

  injectedStyleElem = elem;
  return elem;
};

export const watchStyleElement = () => {
  const observer = new MutationObserver(() => {
    if (injectedStyleElem && !injectedStyleElem.isConnected)
      document.documentElement.appendChild(injectedStyleElem);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  return observer;
};

export const waitForDocumentElement = () =>
  new Promise((resolve) => {
    if (document.documentElement) {
      resolve();
      return;
    }

    const observer = new MutationObserver(() => {
      if (!document.documentElement) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(document, { childList: true });
  });

// ---------------------------------------------------------------------------
// Userscript menu and dialogs
// ---------------------------------------------------------------------------

export const isUserscriptManagerAvailable = Boolean(
  gm.getValue || gm.setValue || gm.registerMenuCommand
);

export const registerMenuCommand = (name, callback) => {
  try {
    if (!gm.registerMenuCommand) return undefined;
    return gm.registerMenuCommand(name, callback);
  } catch (ex) {
    console.warn('無法新增使用者腳本選單項目', ex);
    return undefined;
  }
};

export const unregisterMenuCommand = (menuCommandId) => {
  try {
    if (gm.unregisterMenuCommand && menuCommandId !== undefined)
      gm.unregisterMenuCommand(menuCommandId);
  } catch (ex) {
    console.warn('無法移除使用者腳本選單項目', ex);
  }
};

export const notify = (text, title = 'Bilibili 環境光') => {
  try {
    if (gm.notification) {
      gm.notification(text, title);
      return true;
    }
  } catch (ex) {
    console.warn('無法顯示通知，改在頁面上顯示訊息', ex);
  }
  return false;
};

export const copyToClipboard = (text) => {
  try {
    if (gm.setClipboard) {
      gm.setClipboard(text, 'text');
      return true;
    }
  } catch (ex) {
    console.warn('無法複製到剪貼簿', ex);
  }
  return false;
};

export const openInTab = (url) => {
  try {
    if (gm.openInTab) return gm.openInTab(url, true);
    return globalScope.open(url, '_blank', 'noopener');
  } catch (ex) {
    console.warn(`無法開啟 ${url}`, ex);
    return undefined;
  }
};

export const downloadTextFile = (fileName, text, mimeType = 'application/json') => {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  (document.body || document.documentElement).appendChild(link);
  link.click();

  globalScope.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 5000);

  return true;
};

/**
 * Reads a text file that the user picks in a file dialog.
 * Resolves with null when the user closes the dialog without picking a file.
 */
export const pickTextFile = (accept = '.json,application/json') =>
  new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) {
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(String(reader.result)));
      reader.addEventListener('error', () => reject(reader.error));
      reader.readAsText(file);
    });

    (document.body || document.documentElement).appendChild(input);
    input.click();
  });
