import { getVersion as getPlatformVersion } from './webext';

const browsersUAList = [
  { ua: 'Firefox', name: 'Firefox' },
  { ua: 'OPR', name: 'Opera' },
  { ua: 'Edg', name: 'Edge' },
  { ua: 'Chrome', name: 'Chrome' },
];

export const getBrowser = () => {
  try {
    const ua = globalThis.navigator.userAgent;
    const browser = browsersUAList.find(
      (browser) => ua.indexOf(browser.ua) >= 0
    );
    return browser ? browser.name : '';
  } catch {
    return null;
  }
};

export const getVersion = getPlatformVersion;

export const originalProjectLink =
  'https://github.com/WesselKroos/youtube-ambilight';
export const troubleshootLink = `${originalProjectLink}/blob/master/TROUBLESHOOT.md`;
