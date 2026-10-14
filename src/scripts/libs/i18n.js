/**
 * Translations of the user interface.
 *
 * The user interface is written in Traditional Chinese, which is also the
 * default locale. Every user visible string is looked up by key through `t()`,
 * so that the menu, the warnings and the options page can be shown in another
 * language.
 *
 * Locales other than the default fall back to Traditional Chinese per key, so
 * a translation can be added or updated one string at a time.
 *
 * Note for the userscript build (see rollup.userscript.config.js): this module
 * deliberately does not use `chrome.i18n` or an `_locales` folder, because a
 * userscript has neither. The locale is detected from the browser language
 * instead.
 */
import zhTW from '../locales/zh-TW';
import zhCN from '../locales/zh-CN';
import en from '../locales/en';
import ja from '../locales/ja';
import ko from '../locales/ko';

export const DEFAULT_LOCALE = 'zh-TW';

/** Languages of the "language" setting. The native names do not get translated. */
export const LOCALES = [
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
];

/** The value of the "language" setting that means "follow the browser". */
export const LANGUAGE_AUTO = -1;

const MESSAGES = {
  'zh-TW': zhTW,
  'zh-CN': zhCN,
  en,
  ja,
  ko,
};

export const isSupportedLocale = (code) =>
  LOCALES.some((locale) => locale.code === code);

/**
 * Turns the language of the browser into one of our locales.
 * `zh-Hans`, `zh-CN`, `zh-SG` … become zh-CN, every other `zh-*` becomes zh-TW.
 */
export const detectBrowserLocale = () => {
  let language;
  try {
    language =
      (typeof chrome !== 'undefined' &&
        chrome.i18n &&
        chrome.i18n.getUILanguage &&
        chrome.i18n.getUILanguage()) ||
      globalThis.navigator?.language ||
      '';
  } catch {
    language = '';
  }

  const normalized = String(language).replace('_', '-');
  if (!normalized) return DEFAULT_LOCALE;

  if (normalized.toLowerCase().startsWith('zh')) {
    const lower = normalized.toLowerCase();
    if (
      lower.includes('-hans') ||
      lower.includes('-cn') ||
      lower.includes('-sg') ||
      lower.includes('-my')
    )
      return 'zh-CN';
    return 'zh-TW';
  }

  const exact = LOCALES.find(
    (locale) => locale.code.toLowerCase() === normalized.toLowerCase()
  );
  if (exact) return exact.code;

  const base = normalized.split('-')[0].toLowerCase();
  return (
    LOCALES.find((locale) => locale.code.toLowerCase() === base)?.code ||
    DEFAULT_LOCALE
  );
};

/**
 * Maps the value of the "language" setting to a locale.
 * `undefined`/`null`/LANGUAGE_AUTO mean "follow the browser".
 */
export const resolveLocale = (languageSettingValue) => {
  if (languageSettingValue === LANGUAGE_AUTO || languageSettingValue == null)
    return detectBrowserLocale();

  const locale = LOCALES[languageSettingValue];
  return locale ? locale.code : DEFAULT_LOCALE;
};

let currentLocale = DEFAULT_LOCALE;

export const getLocale = () => currentLocale;

export const setLocale = (code) => {
  currentLocale = isSupportedLocale(code) ? code : DEFAULT_LOCALE;
  return currentLocale;
};

const format = (template, substitutions) => {
  if (!substitutions) return template;

  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in substitutions ? String(substitutions[name]) : match
  );
};

/**
 * Looks a string up by key. `substitutions` replaces `{name}` placeholders.
 */
export const t = (key, substitutions) => {
  if (key === undefined || key === null) return '';

  const message =
    MESSAGES[currentLocale]?.[key] ?? MESSAGES[DEFAULT_LOCALE]?.[key];

  // Unknown keys are returned as-is: it makes a missing translation obvious in
  // the interface and does not crash anything.
  if (message === undefined) return key;

  return format(message, substitutions);
};

/** All keys of a locale, used by the tests and by the translation tooling. */
export const getMessages = (code = DEFAULT_LOCALE) => MESSAGES[code] ?? {};

/**
 * Replaces the content of every `[data-i18n]` element of `root` by its
 * translation. The value of the attribute is the key, which for this project
 * is the Traditional Chinese source text (see the note above).
 *
 * `data-i18n-title` translations are written to the `title` attribute.
 */
export const applyTranslations = (root = document) => {
  for (const elem of root.querySelectorAll('[data-i18n]')) {
    elem.textContent = t(elem.dataset.i18n);
  }

  for (const elem of root.querySelectorAll('[data-i18n-title]')) {
    elem.title = t(elem.dataset.i18nTitle);
  }
};
