# Bilibili 環境光（Ambient light for Bilibili）

在 Bilibili 影片周圍加上環境光（Ambilight）效果。同一個原始碼可以建置成兩種版本：

- **瀏覽器擴充功能**（Chrome / Edge / Firefox）
- **使用者腳本**（Tampermonkey / Violentmonkey / Greasemonkey 等「篡改猴」類管理器）

介面支援繁體中文、简体中文、English、日本語、한국어（預設跟隨瀏覽器語言，可在設定選單的「語言」變更）。

> 本專案為非官方的第三方擴充功能，與嗶哩嗶哩（Bilibili）及 YouTube 無關。

本專案是 [Ambient light for YouTube™](https://github.com/WesselKroos/youtube-ambilight)（作者 Wessel Kroos，MIT License）的 Bilibili 移植版。渲染引擎（WebGL / Canvas2D 投影、黑邊偵測、統計）沿用原專案，網站整合的部分則改寫給 Bilibili 使用。

## 支援的頁面

- `https://www.bilibili.com/video/*`（一般影片、分 P）
- `https://www.bilibili.com/bangumi/play/*`（番劇／影視，DRM 保護的影片無法顯示環境光）
- `https://www.bilibili.com/list/*`、`/medialist/play/*`（播放清單）
- `https://www.bilibili.com/festival/*`、`/cheese/play/*`

支援播放器的所有模式：一般、寬螢幕、網頁全螢幕、全螢幕，以及 B 站的「鏡像畫面」設定。往下捲動出現小窗播放器時只會隱藏環境光，深色主題與融入背景的效果會保留。

## 安裝（使用者腳本／篡改猴）

1. 安裝使用者腳本管理器：[Tampermonkey](https://www.tampermonkey.net/)（Chrome / Edge / Firefox）、[Violentmonkey](https://violentmonkey.github.io/) 或 Greasemonkey
2. 安裝腳本：
   - 直接點安裝網址（Raw）：`https://raw.githubusercontent.com/iceorange-dev/bilibili-ambilight/userscript/bilibili-ambilight.user.js`
     - 如果連不上 `raw.githubusercontent.com`（例如在中國大陸），可以改用 jsDelivr 鏡像：
       `https://cdn.jsdelivr.net/gh/iceorange-dev/bilibili-ambilight@userscript/bilibili-ambilight.user.js`
     - 管理器會從安裝時的網址檢查更新，所以用哪個網址安裝，之後就會從哪個網址更新
     - `userscript` 分支只放正式版本：每次發佈新版時由 CI 建置並更新
   - 或自己建置（見下方），再把 `bilibili-ambilight.user.js` 拖進瀏覽器，或在管理器中新增腳本後貼上內容（這樣安裝的不會自動更新）
3. 重新整理 Bilibili 影片頁面

Chrome / Chromium 核心的瀏覽器請確認已開啟擴充功能的「開發人員模式」，以及在管理器中允許使用者腳本執行（詳見 [Tampermonkey 官方說明](https://www.tampermonkey.net/faq.php#Q209)）。

> 使用者腳本的中繼資料（`@namespace`、`@homepageURL`、`@icon`）來自 `package.json` 的 `userscript` 欄位，預設指向專案首頁。如果要發佈到自己的 fork，把 `userscript.namespace`／`userscript.homepage` 改成你的 repo，再重新執行 `npm run build:userscript` 即可（`bilibili-ambilight.user.js` 是建置產物，不要手改）。

使用者腳本版**沒有擴充功能的工具列圖示與選項頁面**，因此：

- 環境光的設定一樣在播放器控制列（齒輪按鈕左邊的「光芒螢幕」圖示）
- 匯出／匯入設定、開關環境光、開啟設定選單、重設所有設定，改從**使用者腳本管理器的選單**（點 Tampermonkey 圖示 →「Bilibili 環境光」）操作
- 設定儲存在使用者腳本管理器自己的儲存空間（`GM_setValue` / `GM_getValue`）；管理器缺少這些 API 時會退回 `localStorage`

## 安裝（瀏覽器擴充功能，開發者模式）

需要 Node.js 22 以上。

```sh
git clone https://github.com/iceorange-dev/bilibili-ambilight.git
cd bilibili-ambilight
npm install
npm run build
```

1. Chrome / Edge：開啟 `chrome://extensions`，打開「開發人員模式」
2. 點「載入未封裝項目」，選擇 `dist` 資料夾
3. 重新整理 Bilibili 影片頁面

Firefox：改用 `npm run build:firefox` 建置（Firefox 的 manifest 需要 `background.scripts`，Chrome 則只接受 `background.service_worker`），再開啟 `about:debugging#/runtime/this-firefox` →「載入暫用附加元件」→ 選擇 `dist/manifest.json`。

使用者腳本：`npm run build:userscript` 會把整個擴充功能打包成單一檔案 `bilibili-ambilight.user.js`（建置產物，不會提交進 repo；正式版本由 CI 發佈到 Release 與 `userscript` 分支）。它會把樣式表與除雜訊貼圖（`src/images/noise-*.png`）內嵌進檔案，所以檔案比較大（約 1.5 MB）。

## 使用方式

- 播放器右下角的控制列中，B 站設定（齒輪）按鈕左邊的「光芒螢幕」圖示就是環境光設定選單
- 快捷鍵（可在設定選單中修改）：
  - `G`：開啟／關閉環境光
  - `B`：自動移除上下黑邊（預設關閉，因為燒在上下黑邊裡的字幕也會被裁掉）
  - `V`：自動移除左右黑邊（預設開啟）
  - `H`：將影片放大填滿移除黑邊後的空間
- 預設在開啟環境光時會把頁面切換成深色主題。可在「基本設定 → 外觀（主題）」改成「跟隨 B 站」或「淺色」
- 設定選單的「沉浸」區塊：
  - 頁首與搜尋框融入背景：頁面在最上方時導覽列透明，往下捲動後變成半透明模糊；搜尋框融入背景（預設開啟）
  - 寬螢幕模式時隱藏頁首：寬螢幕模式且在頁面最上方時隱藏導覽列
  - 右側欄融入背景：右側的彈幕列表、選集／合集清單、關注與訂閱合集按鈕融入背景（預設開啟）
  - 彈幕輸入列融入背景：影片下方的彈幕輸入列融入背景（預設開啟）
  - 影片資訊與留言區融入背景：影片標籤與留言輸入框融入背景（預設開啟）
  - 融入背景的元素透明度都跟隨「頁面內容 → 按鈕與區塊背景不透明度」

## 語言

介面支援 5 種語言，預設跟隨瀏覽器語言：

| 語言 | 程式碼 | 檔案 |
| --- | --- | --- |
| 繁體中文（預設） | `zh-TW` | `src/scripts/locales/zh-TW.js` |
| 简体中文 | `zh-CN` | `src/scripts/locales/zh-CN.js` |
| English | `en` | `src/scripts/locales/en.js` |
| 日本語 | `ja` | `src/scripts/locales/ja.js` |
| 한국어 | `ko` | `src/scripts/locales/ko.js` |

- 語言可以在設定選單的「基本設定 → 語言」切換（變更後會重新載入網頁），也可以設為「跟隨瀏覽器」
- 翻譯以**繁體中文原文當作 key**（gettext 風格）：`t('排解效能問題')`。任何語言缺少某條翻譯時會自動回退顯示繁體中文原文，所以翻譯可以一條一條補，不會出現空白或 key 外洩
- 需要插值時用 `{name}` 佔位符：`t('已匯出 {count} 項設定', { count })`

### 新增一種語言

1. 複製 `src/scripts/locales/zh-TW.js`（或從任一個 locale 檔案開始），命名為 `src/scripts/locales/<語言代碼>.js`，把值改成該語言的翻譯
2. 在 `src/scripts/libs/i18n.js` 的 `LOCALES` 陣列**末端**加上 `{ code: '<語言代碼>', name: '<語言自稱>' }`（順序不能改動中間的項目，因為設定選單的 `language` 值就是這個陣列的索引）
3. 在 `src/scripts/libs/settings-config.js` 的 `language` 設定 `snapPoints` 末端加上 `{ value: <索引>, label: '<語言自稱>' }`（語言名稱一律用該語言自己的寫法，不用翻譯）
4. 執行 `node scripts/extract-i18n-strings.mjs` 取得目前所有待翻譯字串的完整清單

> 繁體中文原文沒有放在 `zh-TW.js` 裡也一樣能顯示（`t()` 會回退成 key 本身）；`zh-TW.js` 是由 `scripts/extract-i18n-strings.mjs` 產生的完整參考清單，方便翻譯時對照。

## 與原版的差異

- 移除 Sentry 錯誤回報：錯誤只會記錄在網頁的 console 中，不會傳送任何資料
- 移除 YouTube 專屬功能：聊天室主題、VR/360 影片、嵌入式播放器、靜態畫面省電模式（依賴 YouTube storyboard）、YouTube 版面效能修正
- Bilibili 的 `<video>` 元素會撐滿整個播放器並用 `object-fit: contain` 加黑邊，所以環境光是依照影片實際畫面的位置計算
- 移除黑邊與影片縮放改用 `clip-path` 與 `scale` 屬性，不會影響 B 站用來鏡像影片的 `transform`
- 「移除左右黑邊」預設開啟（原版預設關閉），因為 B 站有很多把黑邊直接編碼進畫面的 4:3 影片
- 不支援 B 站以 `<bwp-video>` 播放的影片（例如部分 HEVC 影片的 WebAssembly 播放器）

## 專案結構

| 檔案 | 說明 |
| --- | --- |
| `src/scripts/content.js` | 內容腳本進入點（擴充功能）：載入 CSS、注入 `injected.js`、載入 `content-main.js` |
| `src/scripts/userscript.js` | 使用者腳本進入點：內嵌樣式與貼圖，並載入 `injected.js`、`content-main.js` 與使用者腳本選單 |
| `src/scripts/userscript-menu.js` | 使用者腳本管理器選單：開關環境光、匯出／匯入、重設設定 |
| `src/scripts/content-main.js` | 偵測 B 站播放器，並在播放器／影片元素被替換（換影片、換 P）時重新綁定 |
| `src/scripts/injected.js` | 在頁面主環境中執行：切換 B 站的深色／淺色主題（`html.night-mode` 與 `#__css-map__`） |
| `src/scripts/libs/webext.js` | 平台差異集中處：擴充功能走 `chrome.*`，使用者腳本走 `GM_*`（退回 `localStorage`） |
| `src/scripts/libs/ambientlight.js` | 環境光主邏輯：位置計算、檢視模式、影格排程 |
| `src/scripts/libs/settings.js`、`settings-config.js` | 播放器內的設定選單 |
| `src/scripts/libs/settings-io.js` | 設定的匯出／匯入（擴充功能選項頁與使用者腳本選單共用） |
| `src/scripts/libs/theming.js` | 頁面主題切換 |
| `src/userscript.meta.txt` | 使用者腳本的中繼資料區塊（`==UserScript==`） |
| `rollup.shared.js` | 兩個建置共用的 rollup 外掛（編譯 SCSS、內嵌貼圖、babel、eslint） |
| `rollup.userscript.config.js` | 使用者腳本的 rollup 設定 |
| `src/scripts/libs/i18n.js`、`src/scripts/locales/*.js` | 介面翻譯（繁中 / 简中 / English / 日本語 / 한국어） |
| `scripts/extract-i18n-strings.mjs` | 收集所有待翻譯字串，並重新產生 `locales/zh-TW.js` |
| `src/styles/content.scss` | 頁面、播放器與設定選單的樣式 |

## 建置

| 指令 | 產物 |
| --- | --- |
| `npm run build` | 擴充功能（`dist/`），Chrome / Edge 用 |
| `npm run build:firefox` | 擴充功能（`dist/`），Firefox 用 |
| `npm run build:userscript` | 使用者腳本（`bilibili-ambilight.user.js`） |

兩個建置共用 `src/` 底下所有程式碼，平台差異（儲存空間、樣式注入、貼圖來源、選單）都收在 `src/scripts/libs/webext.js` 與建置設定裡。

## 授權

MIT License，詳見 [LICENSE](LICENSE)。

- 原始作品 Ambient light for YouTube™：Copyright (c) 2017 Wessel Kroos
- Bilibili 移植與修改：Copyright (c) 2026 iceorange-dev

原專案的 git 歷史完整保留在本 repo 中。
