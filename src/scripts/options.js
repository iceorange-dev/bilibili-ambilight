import { storage } from './libs/storage';
import { syncStorage } from './libs/sync-storage';
import { originalProjectLink, troubleshootLink } from './libs/utils';
import SettingsConfig from './libs/settings-config';
import { on } from './libs/generic';
import { applyTranslations, resolveLocale, setLocale, t } from './libs/i18n';

document.querySelector('#originalProjectLink').href = originalProjectLink;
document.querySelector('#troubleshootLink').href = troubleshootLink;

const importExportStatus = document.querySelector('#importExportStatus');
const importExportStatusDetails = document.querySelector(
  '#importExportStatusDetails'
);

// The language of the interface is stored like every other setting
(async () => {
  const language = await storage.get('setting-language');
  setLocale(resolveLocale(language));
  applyTranslations();
})();

let importWarnings = [];
const importSettings = async (storageName, importJson) => {
  try {
    importExportStatus.textContent = '';
    importExportStatus.classList.remove('has-error');
    importExportStatusDetails.textContent = '';
    importExportStatusDetails.scrollTo(0, 0);

    const jsonString = await importJson();
    if (!jsonString) throw new Error(t('找不到可以匯入的設定'));

    let importedObject = JSON.parse(jsonString);
    if (typeof importedObject !== 'object')
      throw new Error(t('找不到可以匯入的設定'));

    // Temporarely import the setting blur as blur2
    // https://github.com/WesselKroos/youtube-ambilight/issues/191#issuecomment-1703792823
    if ('blur' in importedObject) {
      importedObject.blur2 = importedObject.blur;
      delete importedObject.blur;
    }

    importedObject = Object.keys(importedObject)
      .sort()
      .reduce((obj, key) => ((obj[key] = importedObject[key]), obj), {});

    const settings = {};
    for (const name in importedObject) {
      let value = importedObject[name];

      const setting = SettingsConfig.find((setting) => setting.name === name);
      if (!setting) {
        importWarnings.push(
          t('已略過「{name}」：{value}。此設定可能已在更新後被移除或改名。', {
            name,
            value: JSON.stringify(value),
          })
        );
        continue;
      }

      const { type, min = 0, step = 0.1, max } = setting;
      if (type === 'checkbox' || type === 'section') {
        if (typeof value !== 'boolean') {
          importWarnings.push(
            t('已略過「{name}」：{value} 不是布林值。', {
              name,
              value: JSON.stringify(value),
            })
          );
          continue;
        }
      } else if (type === 'list') {
        if (typeof value !== 'number') {
          importWarnings.push(
            t('已略過「{name}」：{value} 不是數字。', {
              name,
              value: JSON.stringify(value),
            })
          );
          continue;
        }
        const valueRoundingLeft = ((value - min) * 1000) % (step * 1000);
        if (valueRoundingLeft !== 0) {
          importWarnings.push(
            t('已將「{name}」向下取整：{value} 不是{min}以 {step} 為間隔的值。', {
              name,
              value: JSON.stringify(value),
              min: min === undefined ? '' : t('從 {min} 開始、', { min }),
              step,
            })
          );
          value = Math.round(value * 1000 - valueRoundingLeft) / 1000;
        }
        if (min !== undefined && value < min) {
          importWarnings.push(
            t('已調整「{name}」：{value} 低於最小值 {min}。', {
              name,
              value: JSON.stringify(value),
              min,
            })
          );
          value = min;
        }
        if (max !== undefined && value > max) {
          importWarnings.push(
            t('已調整「{name}」：{value} 高於最大值 {max}。', {
              name,
              value: JSON.stringify(value),
              max,
            })
          );
          value = max;
        }
      }

      settings[`setting-${name}`] = value;
    }

    if (!Object.keys(settings).length)
      throw new Error(t('找不到可以匯入的設定'));

    await storage.set(settings);

    importExportStatus.textContent = t(
      '已從{storageName}匯入 {count} 項設定。\n（請重新整理已開啟的 Bilibili 分頁來套用新的設定）{warnings}',
      {
        storageName,
        count: Object.keys(settings).length,
        warnings: importWarnings.length
          ? t('\n\n有 {count} 個警告：\n- {warnings}', {
              count: importWarnings.length,
              warnings: importWarnings.join('\n- '),
            })
          : '',
      }
    );
    if (importWarnings.length) {
      importExportStatus.classList.add('has-error');
    }
    importWarnings = [];

    importExportStatusDetails.textContent = t(
      '查看匯入的設定（點擊展開）\n注意：blur 設定在內部會轉換成 blur2\n\n{settings}',
      {
        settings: Object.keys(settings)
          .map(
            (key) =>
              `${key.substring('setting-'.length)}: ${JSON.stringify(
                settings[key]
              )}`
          )
          .join('\n'),
      }
    );
  } catch (ex) {
    console.error('Failed to import settings', ex);
    importExportStatus.classList.add('has-error');
    importExportStatus.textContent = t('無法匯入設定：\n{error}', {
      error: ex?.message,
    });
  }
};
const exportSettings = async (storageName, exportJson) => {
  try {
    importExportStatus.textContent = '';
    importExportStatus.classList.remove('has-error');
    importExportStatusDetails.textContent = '';
    importExportStatusDetails.scrollTo(0, 0);

    const storageData = await storage.get(null);

    let exportObject = {};
    const settings = Object.keys(storageData).filter((key) =>
      key.startsWith('setting-')
    );
    for (const key of settings) {
      const name = key.substring('setting-'.length);
      const existsInConfig = SettingsConfig.some(
        (setting) => setting.name === name
      );
      if (!existsInConfig) continue;

      exportObject[name] = storageData[key];
    }
    if (!Object.keys(exportObject).length)
      throw new Error(t('沒有可以匯出的設定。所有設定都還是預設值。'));

    // Temporarely export the setting blur2 as blur
    // https://github.com/WesselKroos/youtube-ambilight/issues/191#issuecomment-1703792823
    if ('blur2' in exportObject) {
      exportObject.blur = exportObject.blur2;
      delete exportObject.blur2;
    }

    exportObject = Object.keys(exportObject)
      .sort()
      .reduce((obj, key) => ((obj[key] = exportObject[key]), obj), {});

    const jsonString = JSON.stringify(exportObject, null, 2);
    await exportJson(jsonString);
    importExportStatus.textContent = t('已匯出 {count} 項設定{where}', {
      count: Object.keys(exportObject).length,
      where: storageName ? t('到{storageName}', { storageName }) : '',
    });
    importExportStatusDetails.textContent = t(
      '查看匯出的設定（點擊展開）\n\n{settings}',
      {
        settings: Object.keys(exportObject)
          .map((key) => `${key}: ${JSON.stringify(exportObject[key])}`)
          .join('\n'),
      }
    );
  } catch (ex) {
    console.error('Failed to export settings', ex);
    importExportStatus.classList.add('has-error');
    importExportStatus.textContent = t('無法匯出設定：\n{error}', {
      error: ex?.message,
    });
  }
};

const importFileButton = document.querySelector('#importFileBtn');
const importFileInput = document.querySelector('[name="import-settings-file"]');
on(importFileInput, 'change', async () => {
  if (!importFileInput.files.length) return;

  await importSettings(t('檔案'), async () => {
    return await new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        on(reader, 'load', (e) => resolve(e.target.result));
        reader.readAsText(importFileInput.files[0]);
      } catch (ex) {
        reject(ex);
      }
      importFileInput.value = '';
    });
  });
});
on(importFileButton, 'click', () => importFileInput.click());

let exportedSettingsLink;
const exportFileButton = document.querySelector('#exportFileBtn');
on(exportFileButton, 'click', async () => {
  await exportSettings('', (jsonString) => {
    const blob = new Blob([jsonString], { type: 'text/plain' });

    const link = (exportedSettingsLink =
      exportedSettingsLink ?? document.createElement('a'));
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', 'ambient-light-for-bilibili-settings.json');
    link.setAttribute(
      'title',
      t('如果自動下載被封鎖：\n1. 在這個連結上按右鍵\n2. 點選「另存連結為⋯」')
    );
    link.style.display = 'block';
    link.style.marginTop = '0';
    link.style.marginBottom = '4px';
    link.textContent = 'ambient-light-for-bilibili-settings.json';
    importExportStatusDetails.parentElement.insertBefore(
      link,
      importExportStatusDetails
    );

    link.click();
  });
});

const importAccountButton = document.querySelector('#importAccountBtn');
on(importAccountButton, 'click', async () => {
  await importSettings(t('雲端儲存空間'), async () => {
    return await syncStorage.get('settings');
  });
});

const exportAccountButton = document.querySelector('#exportAccountBtn');
on(exportAccountButton, 'click', async () => {
  await exportSettings(t('雲端儲存空間'), async (jsonString) => {
    await syncStorage.set('settings', jsonString);
    await syncStorage.set('settings-date', new Date().toJSON());
  });
});

const importableAccountStatus = document.querySelector(
  '#importableAccountStatus'
);
const updateImportableAccountStatus = async () => {
  const jsonString = await syncStorage.get('settings-date');
  if (jsonString) {
    const settingsDate = new Date(jsonString);
    importableAccountStatus.textContent = t(
      '上次匯出到雲端的時間：{date} {time}',
      {
        date: settingsDate.toLocaleDateString(),
        time: settingsDate.toLocaleTimeString(),
      }
    );
    importAccountButton.disabled = false;
  } else {
    importableAccountStatus.textContent = '';
    importAccountButton.disabled = true;
  }
};
updateImportableAccountStatus();

if (chrome?.storage?.sync?.onChanged) {
  syncStorage.addListener(updateImportableAccountStatus);
  on(window, 'beforeunload', () => {
    syncStorage.removeListener(updateImportableAccountStatus);
  });
}
