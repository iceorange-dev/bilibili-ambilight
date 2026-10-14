/**
 * Import and export of settings.
 *
 * Used by the options page of the extension (src/scripts/options.js) and by
 * the userscript menu (src/scripts/userscript-menu.js).
 */
import SettingsConfig from './settings-config';
import { storage } from './storage';

const SETTING_PREFIX = 'setting-';

const sortByKeys = (object) =>
  Object.keys(object)
    .sort()
    .reduce((sorted, key) => {
      sorted[key] = object[key];
      return sorted;
    }, {});

/**
 * Builds the object that is written to a settings file. It only contains the
 * settings that differ from their defaults.
 */
export const buildSettingsExportObject = async () => {
  const storageData = (await storage.get(null)) || {};

  let exportObject = {};
  const settings = Object.keys(storageData).filter((key) =>
    key.startsWith(SETTING_PREFIX)
  );
  for (const key of settings) {
    const name = key.substring(SETTING_PREFIX.length);
    const existsInConfig = SettingsConfig.some(
      (setting) => setting.name === name
    );
    if (!existsInConfig) continue;

    exportObject[name] = storageData[key];
  }

  if (!Object.keys(exportObject).length)
    throw new Error('沒有可以匯出的設定。所有設定都還是預設值。');

  // Temporarely export the setting blur2 as blur
  // https://github.com/WesselKroos/youtube-ambilight/issues/191#issuecomment-1703792823
  if ('blur2' in exportObject) {
    exportObject.blur = exportObject.blur2;
    delete exportObject.blur2;
  }

  return sortByKeys(exportObject);
};

/**
 * Validates the JSON of a settings file.
 *
 * Returns the storage entries to write (`{ 'setting-name': value }`) and the
 * warnings of the settings that had to be skipped or adjusted. Throws when the
 * file does not contain a single usable setting.
 */
export const parseSettingsImport = (jsonString) => {
  const warnings = [];

  let importedObject = JSON.parse(jsonString);
  if (!importedObject || typeof importedObject !== 'object')
    throw new Error('找不到可以匯入的設定');

  // Temporarely import the setting blur as blur2
  // https://github.com/WesselKroos/youtube-ambilight/issues/191#issuecomment-1703792823
  if ('blur' in importedObject) {
    importedObject.blur2 = importedObject.blur;
    delete importedObject.blur;
  }

  importedObject = sortByKeys(importedObject);

  const settings = {};
  for (const name in importedObject) {
    let value = importedObject[name];

    const setting = SettingsConfig.find((setting) => setting.name === name);
    if (!setting) {
      warnings.push(
        `已略過「${name}」：${JSON.stringify(
          value
        )}。此設定可能已在更新後被移除或改名。`
      );
      continue;
    }

    const { type, min = 0, step = 0.1, max } = setting;
    if (type === 'checkbox' || type === 'section') {
      if (typeof value !== 'boolean') {
        warnings.push(
          `已略過「${name}」：${JSON.stringify(value)} 不是布林值。`
        );
        continue;
      }
    } else if (type === 'list') {
      if (typeof value !== 'number') {
        warnings.push(
          `已略過「${name}」：${JSON.stringify(value)} 不是數字。`
        );
        continue;
      }
      const valueRoundingLeft = ((value - min) * 1000) % (step * 1000);
      if (valueRoundingLeft !== 0) {
        warnings.push(
          `已將「${name}」向下取整：${JSON.stringify(
            value
          )} 不是${min === undefined ? '' : `從 ${min} 開始、`}以 ${step} 為間隔的值。`
        );
        value = Math.round(value * 1000 - valueRoundingLeft) / 1000;
      }
      if (min !== undefined && value < min) {
        warnings.push(
          `已調整「${name}」：${JSON.stringify(
            value
          )} 低於最小值 ${min}。`
        );
        value = min;
      }
      if (max !== undefined && value > max) {
        warnings.push(
          `已調整「${name}」：${JSON.stringify(
            value
          )} 高於最大值 ${max}。`
        );
        value = max;
      }
    }

    settings[`${SETTING_PREFIX}${name}`] = value;
  }

  if (!Object.keys(settings).length)
    throw new Error('找不到可以匯入的設定');

  return { settings, warnings };
};

/**
 * Removes every stored setting so that the defaults apply again.
 * Used when there is no running Ambientlight instance to ask (for example when
 * the userscript menu is used on a page without a video player).
 */
export const removeAllStoredSettings = async () => {
  const names = [];
  for (const setting of SettingsConfig) {
    names.push(`${SETTING_PREFIX}${setting.name}`);
    if (setting.defaultKey !== undefined)
      names.push(`${SETTING_PREFIX}${setting.name}-key`);
  }

  for (const name of names) {
    await storage.set(name, undefined);
  }
};

export const getSettingsExportJson = async () =>
  JSON.stringify(await buildSettingsExportObject(), null, 2);

export const SETTINGS_FILE_NAME = 'ambient-light-for-bilibili-settings.json';
