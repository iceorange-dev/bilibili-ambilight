import { supportsColorMix, supportsWebGL } from './generic';
import { getBrowser } from './utils';

const SettingsConfig = [
  {
    type: 'section',
    label: '設定',
    name: 'sectionSettingsCollapsed',
    default: true,
  },
  {
    name: 'advancedSettings',
    label: '顯示進階設定',
    type: 'checkbox',
    default: false,
  },
  {
    type: 'section',
    label: '統計資訊',
    name: 'sectionStatsCollapsed',
    default: true,
    advanced: true,
  },
  {
    name: 'showFPS',
    label: '影格率',
    type: 'checkbox',
    default: false,
    advanced: true,
  },
  {
    name: 'showFrametimes',
    label: '影格時間圖表',
    description: '會使用：CPU 效能',
    questionMark: {
      title:
        '測得的顯示器影格率並不代表實際效能，\n因為測量本身會額外佔用一部分 CPU。\n不過這項統計可以用來排查其他問題。',
    },
    type: 'checkbox',
    default: false,
    advanced: true,
  },
  {
    name: 'showResolutions',
    label: '解析度與繪製時間',
    type: 'checkbox',
    default: false,
    advanced: true,
  },
  {
    name: 'showBarDetectionStats',
    label: '黑邊偵測',
    type: 'checkbox',
    default: false,
    advanced: true,
  },
  {
    type: 'section',
    label: '品質與效能',
    name: 'sectionQualityPerformanceCollapsed',
    default: true,
  },
  {
    name: 'webGL',
    label: 'WebGL 渲染器（較省電）',
    description: '變更後會重新載入網頁',
    type: 'checkbox',
    default: true,
  },
  {
    name: 'resolution',
    label: '解析度',
    type: 'list',
    default: 100,
    unit: '%',
    valuePoints: (() => {
      const points = [6.25];
      while (points[points.length - 1] < 400) {
        points.push(points[points.length - 1] * 2);
      }
      return points;
    })(),
    manualinput: false,
  },
  {
    name: 'framerateLimit',
    label: '影格率上限（每秒）',
    type: 'list',
    default: 60,
    min: 0,
    max: 60,
    step: 1,
  },
  {
    name: 'frameSync',
    label: '同步方式',
    questionMark: {
      title:
        '要花多少資源讓環境光的影格與影片的影格同步。\n\n解碼影格率：CPU 與 GPU 使用量最低。\n可能會掉幀或延遲。\n\n顯示器影格率：CPU 與 GPU 使用量最高。\n在高更新率螢幕（120Hz 以上）或高於 1080p 的影片上仍可能延遲。\n\n影片影格率：CPU 與 GPU 使用量最低。\n使用最新的瀏覽器技術讓影格隨時保持同步。',
    },
    type: 'list',
    default: 2,
    min: 0,
    max: 2,
    step: 1,
    snapPoints: [
      { value: 0, label: '解碼' },
      { value: 1, label: '顯示器' },
      { value: 2, label: '影片' },
    ],
    manualinput: false,
    advanced: true,
    experimental: true,
  },
  {
    name: 'prioritizePageLoadSpeed',
    label: '優先載入網頁',
    description: '等網頁載入完成後再載入環境光',
    type: 'checkbox',
    default: true,
  },
  {
    name: 'debandingBlendMode',
    label: '去色帶最佳化對象',
    questionMark: {
      title:
        '一般混合模式適合修正 LCD 螢幕上暗色的色帶。\n但在 OLED 螢幕上，使用「疊加」混合模式可以保留純黑。',
    },
    type: 'list',
    default: 0,
    min: 0,
    max: 1,
    step: 1,
    snapPoints: [
      { value: 0, label: 'LCD（一般）' },
      { value: 1, label: 'OLED（疊加）' },
    ],
    manualinput: false,
    advanced: true,
  },
  {
    type: 'section',
    label: '頁首',
    name: 'sectionOtherPageHeaderCollapsed',
    default: true,
  },
  {
    name: 'headerShadowSize',
    label: '陰影大小',
    type: 'list',
    default: 0,
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    name: 'headerShadowOpacity',
    label: '陰影不透明度',
    type: 'list',
    default: 30,
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    name: 'headerImagesOpacity',
    label: '圖片不透明度',
    type: 'list',
    default: 100,
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    name: 'headerFillOpacity',
    label: '背景不透明度',
    description: '只在頁面往下捲動後套用',
    type: 'list',
    default: 100,
    min: -100,
    max: 100,
    step: 0.1,
    advanced: true,
  },

  {
    type: 'section',
    label: '頁面內容',
    name: 'sectionOtherPageContentCollapsed',
    default: true,
  },
  {
    name: 'surroundingContentShadowSize',
    label: '陰影大小',
    type: 'list',
    default: 15,
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    name: 'surroundingContentShadowOpacity',
    label: '陰影不透明度',
    type: 'list',
    default: 30,
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    name: 'surroundingContentTextAndBtnOnly',
    label: '只在文字與按鈕加上陰影',
    description: '減少捲動與影片卡頓',
    type: 'checkbox',
    advanced: true,
    default: true,
  },
  {
    name: 'surroundingContentImagesOpacity',
    label: '圖片不透明度',
    type: 'list',
    default: 100,
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    name: 'surroundingContentFillOpacity',
    label: '按鈕與區塊背景不透明度',
    type: 'list',
    default: 10,
    min: -100,
    max: 100,
    step: 0.1,
  },
  {
    name: 'pageBackgroundGreyness',
    label: '背景灰度',
    type: 'list',
    default: 0,
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    name: 'hideScrollbar',
    label: '隱藏捲軸',
    type: 'checkbox',
    advanced: true,
    default: false,
  },
  {
    type: 'section',
    label: '影片',
    name: 'sectionVideoResizingCollapsed',
    default: true,
  },
  {
    name: 'videoScale.SMALL',
    label: '大小（一般模式）',
    type: 'list',
    default: 100,
    min: 25,
    max: 200,
    step: 0.1,
  },
  {
    name: 'videoScale.THEATER',
    label: '大小（寬螢幕模式）',
    type: 'list',
    default: 100,
    min: 25,
    max: 200,
    step: 0.1,
  },
  {
    name: 'videoScale.FULLSCREEN',
    label: '大小（全螢幕）',
    type: 'list',
    default: 100,
    min: 25,
    max: 200,
    step: 0.1,
  },
  {
    name: 'videoShadowSize',
    label: '陰影大小',
    type: 'list',
    default: 0,
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    name: 'videoShadowOpacity',
    label: '陰影不透明度',
    type: 'list',
    default: 50,
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    name: 'videoDebandingStrength',
    label: '去色帶（雜訊）',
    questionMark: {
      title:
        '點擊查看去色帶（雜訊／抖色）的說明。\n提示：在 OLED 螢幕上，把「品質與效能 > 去色帶最佳化對象」設為「OLED」可以保留純黑。',
      href: 'https://www.lifewire.com/what-is-dithering-4686105',
    },
    type: 'list',
    default: 0,
    min: 0,
    max: 100,
    step: 1,
    advanced: true,
  },
  {
    name: 'videoOverlayEnabled',
    label: '讓影片與環境光同步',
    questionMark: {
      title:
        '依照環境光的影格時間延遲影片的影格，\n讓環境光永遠不會和影片不同步，\n但可能會造成卡頓或掉幀。',
    },
    type: 'checkbox',
    default: false,
    advanced: true,
  },
  {
    name: 'videoOverlaySyncThreshold',
    label: '停用影片同步的門檻',
    description: '掉幀比例超過此值時停用',
    type: 'list',
    default: 5,
    min: 1,
    max: 100,
    step: 1,
    advanced: true,
  },
  {
    name: 'chromiumBugVideoJitterWorkaround',
    label: '影片抖動修正',
    description: '會使用：CPU 與 GPU 效能',
    questionMark: {
      title:
        'Chromium 有個錯誤：螢幕更新率高於 60Hz 時，影片播放會抖動。\n此修正會強制瀏覽器以螢幕的更新率運作，避免抖動。\n點擊問號查看這個 Chromium 錯誤的詳細資訊。',
      href: 'https://github.com/WesselKroos/youtube-ambilight/issues/166',
    },
    type: 'checkbox',
    default: false, // Should not be enabled by default because it also adds CPU & GPU overhead on 60Hz displays. (60Hz+ detection keeps toggling between off/on when VRR is enabled in the OS.)
    advanced: true,
  },
  {
    name: 'chromiumDirectVideoOverlayWorkaround',
    label: '影片破圖修正',
    description:
      '使用 NVIDIA RTX Video Super Resolution (VSR)\n時必須關閉此修正',
    questionMark: {
      title: `影片使用硬體加速疊加層（MPO）時，此修正可以解決一些破圖問題。
例如：隨機出現的黑色／白色方塊、閃爍或影片被壓扁。

點擊問號查看這些問題的最新資訊。`,
      href: 'https://github.com/WesselKroos/youtube-ambilight/blob/master/TROUBLESHOOT.md#3-nvidia-rtx-video-super-resolution-vsr--nvidia-rtx-video-hdr-does-not-work',
    },
    type: 'checkbox',
    default: false,
    advanced: true,
  },
  {
    type: 'section',
    label: '移除黑邊與彩色邊',
    name: 'sectionHorizontalBarsCollapsed',
    default: true,
  },
  {
    name: 'detectHorizontalBarSizeEnabled',
    label: '移除上下黑邊',
    description: '會使用：CPU 效能',
    type: 'checkbox',
    default: false,
    defaultKey: 'B',
  },
  {
    name: 'detectVerticalBarSizeEnabled',
    label: '移除左右黑邊',
    description: '會使用：CPU 效能',
    type: 'checkbox',
    // Enabled by default, because Bilibili has a lot of 4:3 videos with the black bars encoded into the video.
    // The top and bottom bars are not removed by default, because they often contain the subtitles.
    default: true,
    defaultKey: 'V',
  },
  {
    name: 'detectColoredHorizontalBarSizeEnabled',
    label: '偵測：也移除彩色邊',
    type: 'checkbox',
    default: false,
  },
  {
    name: 'detectHorizontalBarSizeOffsetPercentage',
    label: '偵測：偏移',
    type: 'list',
    default: 0,
    min: -5,
    max: 5,
    step: 0.1,
    advanced: true,
  },
  {
    name: 'barSizeDetectionAverageHistorySize',
    label: '偵測：平均影格數',
    questionMark: {
      title:
        '用多少個影片影格來計算平均的黑邊大小。\n影格數越少偵測越快，\n但也越容易偵測錯誤。',
    },
    type: 'list',
    default: 4,
    min: 1,
    max: 30,
    step: 1,
    advanced: true,
  },
  {
    name: 'barSizeDetectionAllowedElementsPercentage',
    label: '偵測：確定性門檻',
    questionMark: {
      title:
        '設為 10% 時只會移除明顯的黑邊。\n比例越高，連帶有少量內容的邊也會被移除。\n再更高的話，可能會裁切到只剩中間的方形內容。',
    },
    type: 'list',
    default: 20,
    min: 10,
    max: 90,
    step: 10,
    // advanced: true,
  },
  {
    name: 'barSizeDetectionAllowedUnevenBarsPercentage',
    label: '偵測：不對稱門檻',
    questionMark: {
      title:
        '比例越高，越能偵測不對稱的黑邊。\n例如：上方的黑邊比下方的小。\n但比例越高，筆直的物體或線條也越容易被誤判為黑邊。',
    },
    type: 'list',
    default: 10,
    min: 1,
    max: 50,
    step: 1,
    advanced: true,
  },
  {
    name: 'horizontalBarsClipPercentage',
    label: '上下黑邊大小',
    type: 'list',
    default: 0,
    min: 0,
    max: 40,
    step: 0.1,
    snapPoints: [
      { value: 8.7, label: 8 },
      { value: 12.3, label: 12, flip: true },
      { value: 13.5, label: 13 },
    ],
    advanced: true,
  },
  {
    name: 'verticalBarsClipPercentage',
    label: '左右黑邊大小',
    type: 'list',
    default: 0,
    min: 0,
    max: 40,
    step: 0.1,
    advanced: true,
  },
  {
    name: 'horizontalBarsClipPercentageReset',
    label: '換影片時重設黑邊',
    type: 'checkbox',
    default: true,
    advanced: true,
  },
  {
    name: 'detectVideoFillScaleEnabled',
    label: '放大影片填滿移除的黑邊',
    type: 'checkbox',
    default: false,
    defaultKey: 'H',
  },
  {
    type: 'section',
    label: '濾鏡',
    name: 'sectionImageAdjustmentCollapsed',
    default: true,
  },
  {
    name: 'brightness',
    label: '亮度',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 1,
  },
  {
    name: 'contrast',
    label: '對比',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 1,
    advanced: true,
  },
  {
    name: 'vibrance',
    label: '色彩',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 0.1,
  },
  {
    name: 'saturation',
    label: '飽和度',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 1,
  },
  {
    type: 'section',
    label: 'HDR 濾鏡',
    name: 'sectionHdrImageAdjustmentCollapsed',
    default: false,
    hdr: true,
  },
  {
    name: 'hdrBrightness',
    label: '亮度',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 1,
    hdr: true,
  },
  {
    name: 'hdrContrast',
    label: '對比',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 1,
    hdr: true,
  },
  {
    name: 'hdrSaturation',
    label: '飽和度',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 1,
    hdr: true,
  },
  {
    type: 'section',
    label: '方向',
    name: 'sectionDirectionsCollapsed',
    default: true,
    advanced: true,
  },
  {
    name: 'directionTopEnabled',
    label: '上',
    type: 'checkbox',
    default: true,
    advanced: true,
  },
  {
    name: 'directionRightEnabled',
    label: '右',
    type: 'checkbox',
    default: true,
    advanced: true,
  },
  {
    name: 'directionBottomEnabled',
    label: '下',
    type: 'checkbox',
    default: true,
    advanced: true,
  },
  {
    name: 'directionLeftEnabled',
    label: '左',
    type: 'checkbox',
    default: true,
    advanced: true,
  },
  {
    type: 'section',
    label: '環境光',
    name: 'sectionAmbientlightCollapsed',
    default: false,
  },
  {
    name: 'blur2',
    label: '模糊',
    description: '會使用：GPU 記憶體',
    type: 'list',
    default: 30,
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    name: 'edge',
    label: '邊緣大小',
    description: '把模糊設為 0% 比較容易看出差異',
    type: 'list',
    default: 12,
    min: 2,
    max: 50,
    step: 0.1,
    advanced: true,
  },
  {
    name: 'spread',
    label: '擴散範圍',
    description: '會使用：GPU 效能',
    type: 'list',
    default: 17,
    min: 0,
    max: 400,
    step: 0.1,
  },
  {
    name: 'spreadFadeStart',
    label: '擴散淡出起點',
    type: 'list',
    default: 15,
    min: -50,
    max: 100,
    step: 0.1,
    advanced: true,
  },
  {
    name: 'spreadFadeCurve',
    label: '擴散淡出曲線',
    description: '把模糊設為 0% 比較容易看出差異',
    type: 'list',
    default: 35,
    min: 1,
    max: 100,
    step: 1,
    advanced: true,
  },
  {
    name: 'debandingStrength',
    label: '去色帶（雜訊）',
    questionMark: {
      title:
        '點擊查看去色帶（雜訊／抖色）的說明。\n提示：在 OLED 螢幕上，把「品質與效能 > 去色帶最佳化對象」設為「OLED」可以保留純黑。',
      href: 'https://www.lifewire.com/what-is-dithering-4686105',
    },
    type: 'list',
    default: 0,
    min: 0,
    max: 100,
    step: 1,
    advanced: true,
  },
  {
    name: 'frameFading',
    label: '淡入時間',
    description: '會使用：GPU 記憶體',
    questionMark: {
      title: '環境光變化時淡入淡出',
    },
    type: 'list',
    default: 0,
    min: 0,
    max: 21.2, // 15 seconds
    step: 0.02,
    manualinput: false,
  },
  {
    name: 'flickerReduction',
    label: '減少閃爍',
    questionMark: {
      title:
        '限制環境光亮度變化的速度，藉此減少閃爍',
    },
    type: 'list',
    default: 0,
    min: 0,
    max: 100,
    step: 1,
    manualinput: false,
    advanced: true,
  },
  {
    name: 'frameBlending',
    label: '平滑動態（影格混合）',
    questionMark: {
      title: '點擊查看影格混合的說明',
      href: 'https://www.youtube.com/watch?v=m_wfO4fvH8M&t=81s',
    },
    description: '會使用：GPU 效能。也可以搭配「讓影片與環境光同步」',
    type: 'checkbox',
    default: false,
    advanced: true,
  },
  {
    name: 'frameBlendingSmoothness',
    label: '平滑動態強度',
    type: 'list',
    default: 80,
    min: 0,
    max: 100,
    step: 1,
    advanced: true,
  },
  {
    name: 'fixedPosition',
    label: '固定位置',
    description: '不隨頁面捲動',
    type: 'checkbox',
    default: false,
    advanced: true,
  },
  {
    type: 'section',
    label: '沉浸',
    name: 'sectionImmersiveCollapsed',
    default: false,
  },
  {
    name: 'immersiveHeader',
    label: '頁首與搜尋框融入背景',
    description: '頁面在最上方時頁首完全透明',
    type: 'checkbox',
    default: true,
  },
  {
    name: 'immersiveTheaterView',
    label: '寬螢幕模式時隱藏頁首',
    description: '頁面在最上方時',
    type: 'checkbox',
    default: false,
  },
  {
    name: 'transparentSidePanels',
    label: '右側欄融入背景',
    description:
      '彈幕列表、選集、關注與訂閱按鈕。透明度可在「頁面內容 > 按鈕與區塊背景不透明度」調整',
    type: 'checkbox',
    default: true,
  },
  {
    name: 'transparentPageContent',
    label: '影片資訊與留言區融入背景',
    description:
      '影片標籤、活動與推廣卡片、留言輸入框。透明度可在「頁面內容 > 按鈕與區塊背景不透明度」調整',
    type: 'checkbox',
    default: true,
  },
  {
    name: 'transparentSendingBar',
    label: '彈幕輸入列融入背景',
    description:
      '影片下方的輸入列。透明度可在「頁面內容 > 按鈕與區塊背景不透明度」調整',
    type: 'checkbox',
    default: true,
  },
  {
    type: 'section',
    label: '顯示模式',
    name: 'sectionViewsCollapsed',
    default: false,
  },
  {
    name: 'enableInViews',
    label: '在哪些模式啟用',
    type: 'list',
    manualinput: false,
    default: 0,
    min: 0,
    max: 5,
    step: 1,
    snapPoints: [
      { value: 0, label: '全部' },
      { value: 1, label: '一般' },
      { value: 2, hiddenLabel: '一般與寬螢幕' },
      { value: 3, label: '寬螢幕' },
      { value: 4, hiddenLabel: '寬螢幕與全螢幕' },
      { value: 5, label: '全螢幕' },
    ],
  },
  {
    name: 'enableInPictureInPicture',
    label: '子母畫面',
    type: 'checkbox',
    default: false,
    advanced: true,
  },
  {
    type: 'section',
    label: '基本設定',
    name: 'sectionGeneralCollapsed',
    default: false,
  },
  {
    name: 'theme',
    label: '外觀（主題）',
    type: 'list',
    manualinput: false,
    default: 1,
    min: -1,
    max: 1,
    step: 1,
    snapPoints: [
      { value: -1, label: '淺色' },
      { value: 0, label: '跟隨 B 站' },
      { value: 1, label: '深色' },
    ],
  },
  {
    name: 'language',
    label: '語言',
    description: '介面語言，變更後會重新載入網頁',
    type: 'list',
    manualinput: false,
    default: -1,
    min: -1,
    max: 4,
    step: 1,
    // The values are the indexes of the locales defined in src/scripts/libs/i18n.js
    snapPoints: [
      { value: -1, label: '跟隨瀏覽器' },
      { value: 0, label: '繁體中文' },
      { value: 1, label: '简体中文' },
      { value: 2, label: 'English' },
      { value: 3, label: '日本語' },
      { value: 4, label: '한국어' },
    ],
  },
  {
    name: 'enabled',
    label: '啟用',
    type: 'checkbox',
    default: true,
    defaultKey: 'G',
  },
];

export const WebGLOnlySettings = [
  'resolution',
  'vibrance',
  'frameFading',
  'flickerReduction',
  'fixedPosition',
  'chromiumBugVideoJitterWorkaround',
];

let prepared = false;
export const prepareSettingsConfigOnce = () => {
  if (prepared) return;

  const settingsToRemove = [];
  for (const setting of SettingsConfig) {
    if (supportsWebGL()) {
      if (setting.name === 'resolution' && getBrowser() === 'Firefox') {
        setting.default = 50;
      }
    } else {
      if (WebGLOnlySettings.includes(setting.name)) {
        settingsToRemove.push(setting.name);
      }
      if (['webGL'].includes(setting.name)) {
        setting.default = false;
        setting.disabled = '你已在瀏覽器中停用 WebGL。';
      }
    }

    if (setting.name === 'frameSync') {
      if (!HTMLVideoElement.prototype.requestVideoFrameCallback) {
        setting.max = 1;
        setting.default = 0;
      } else if (getBrowser() === 'Firefox') {
        // FireFox workaround: requestVideoFrameCallback is limited to 24fps. Use decoded video frames by default instead
        // https://bugzilla.mozilla.org/show_bug.cgi?id=1935256
        setting.default = 0;
      }
    }
  }

  if (!supportsColorMix()) {
    settingsToRemove.push('pageBackgroundGreyness');
  }

  for (const settingName of settingsToRemove) {
    const settingIndex = SettingsConfig.findIndex(
      (setting) => setting.name === settingName
    );
    SettingsConfig.splice(settingIndex, 1);
  }

  prepared = true;
};

export default SettingsConfig;
