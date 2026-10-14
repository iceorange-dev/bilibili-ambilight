/**
 * The menu entries of the userscript build.
 *
 * A userscript has no toolbar button, so the extension popup and the options
 * page are replaced by the menu of the userscript manager (Tampermonkey,
 * Violentmonkey, Greasemonkey). The settings itself are still changed in the
 * settings menu of the video player, like in the extension.
 */
import { setWarning } from './libs/generic';
import {
  copyToClipboard,
  downloadTextFile,
  getHomepageUrl,
  isUserscriptManagerAvailable,
  notify,
  openInTab,
  pickTextFile,
  registerMenuCommand,
  unregisterMenuCommand,
} from './libs/webext';
import {
  getSettingsExportJson,
  parseSettingsImport,
  removeAllStoredSettings,
  SETTINGS_FILE_NAME,
} from './libs/settings-io';
import { storage } from './libs/storage';
import { getVersion } from './libs/utils';

const getAmbientlight = () => {
  try {
    return window.ambientlight || undefined;
  } catch {
    return undefined;
  }
};

const showMessage = (text) => {
  try {
    if (document.documentElement) {
      setWarning(text);
      return;
    }
  } catch (ex) {
    console.warn(ex);
  }

  if (!notify(text)) console.warn(text);
};

const reloadWithMessage = (text) => {
  setWarning(text);

  globalThis.setTimeout(() => {
    const ambientlight = getAmbientlight();
    if (ambientlight?.settings?.reloadPage) ambientlight.settings.reloadPage();
    else location.reload();
  }, 3000);
};

const menuCommandIds = [];

const addMenuCommand = (name, callback) => {
  const id = registerMenuCommand(name, callback);
  if (id !== undefined) menuCommandIds.push(id);
};

const refreshMenu = () => {
  while (menuCommandIds.length) unregisterMenuCommand(menuCommandIds.pop());
  registerMenuCommands();
};

const registerMenuCommands = () => {
  const ambientlight = getAmbientlight();
  const enabled = ambientlight?.settings?.enabled;

  addMenuCommand(
    enabled === undefined
      ? '環境光：開啟／關閉（請先開啟 Bilibili 影片頁面）'
      : `環境光：${enabled ? '已開啟（點此關閉）' : '已關閉（點此開啟）'}`,
    async () => {
      const instance = getAmbientlight();
      if (!instance?.settings) {
        showMessage('請先開啟 Bilibili 影片頁面。');
        return;
      }

      await instance.toggleEnabled();
      refreshMenu();
    }
  );

  addMenuCommand('環境光：開啟設定選單', () => {
    const menuBtn = getAmbientlight()?.settings?.menuBtn;
    if (!menuBtn) {
      showMessage('找不到設定選單。請先開啟 Bilibili 影片頁面。');
      return;
    }

    menuBtn.click();
  });

  addMenuCommand('設定：匯出（檔案＋剪貼簿）', async () => {
    try {
      const jsonString = await getSettingsExportJson();
      const copied = copyToClipboard(jsonString);
      downloadTextFile(SETTINGS_FILE_NAME, jsonString, 'text/plain');

      showMessage(
        `已匯出設定${
          copied ? '，並複製到剪貼簿' : ''
        }。\n（檔案：${SETTINGS_FILE_NAME}）`
      );
    } catch (ex) {
      showMessage(`無法匯出設定：${ex?.message}`);
    }
  });

  addMenuCommand('設定：匯入（選擇檔案）', async () => {
    try {
      const jsonString = await pickTextFile();
      if (!jsonString) return;

      const { settings, warnings } = parseSettingsImport(jsonString);
      await storage.set(settings);

      reloadWithMessage(
        `已匯入 ${Object.keys(settings).length} 項設定，頁面即將重新載入。${
          warnings.length
            ? `\n\n有 ${warnings.length} 個警告：\n- ${warnings.join('\n- ')}`
            : ''
        }`
      );
    } catch (ex) {
      showMessage(`無法匯入設定：${ex?.message}`);
    }
  });

  addMenuCommand('設定：匯入（貼上 JSON）', async () => {
    try {
      if (typeof globalThis.prompt !== 'function') {
        showMessage('這個使用者腳本管理員不支援輸入視窗，請改用「匯入（選擇檔案）」。');
        return;
      }

      const jsonString = globalThis.prompt('請貼上設定的 JSON：');
      if (!jsonString) return;

      const { settings, warnings } = parseSettingsImport(jsonString);
      await storage.set(settings);

      reloadWithMessage(
        `已匯入 ${Object.keys(settings).length} 項設定，頁面即將重新載入。${
          warnings.length
            ? `\n\n有 ${warnings.length} 個警告：\n- ${warnings.join('\n- ')}`
            : ''
        }`
      );
    } catch (ex) {
      showMessage(`無法匯入設定：${ex?.message}`);
    }
  });

  addMenuCommand('設定：重設所有設定', async () => {
    if (!globalThis.confirm('確定要重設「所有」設定並重新載入頁面嗎？')) return;

    try {
      const ambientlight = getAmbientlight();
      if (ambientlight?.settings?.resetAllSettings) {
        await ambientlight.settings.resetAllSettings();
      } else {
        await removeAllStoredSettings();
      }

      reloadWithMessage('已重設所有設定，頁面即將重新載入。');
    } catch (ex) {
      showMessage(`無法重設設定：${ex?.message}`);
    }
  });

  addMenuCommand('關於（版本／專案首頁）', () => {
    showMessage(
      `Bilibili 環境光（使用者腳本版）v${getVersion()}\n\n` +
        `環境光設定在影片播放器的控制列中：齒輪按鈕左邊的「光芒螢幕」圖示。\n` +
        `匯出／匯入設定請用本選單。\n\n專案首頁：${getHomepageUrl()}`
    );
  });

  addMenuCommand('開啟專案首頁', () => openInTab(getHomepageUrl()));
};

export const registerUserscriptMenu = () => {
  if (!isUserscriptManagerAvailable) {
    console.warn(
      '找不到使用者腳本管理員的 API，將不會新增選單項目。'
    );
    return;
  }

  registerMenuCommands();

  // The label of the first menu entry shows whether the ambient light is
  // enabled, but the engine is initialized asynchronously.
  let attempts = 0;
  const interval = globalThis.setInterval(() => {
    attempts += 1;

    if (getAmbientlight()) {
      globalThis.clearInterval(interval);
      refreshMenu();
      return;
    }

    if (attempts >= 60) globalThis.clearInterval(interval);
  }, 1000);
};
