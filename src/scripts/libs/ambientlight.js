import {
  on,
  off,
  raf,
  ctxOptions,
  Canvas,
  SafeOffscreenCanvas,
  setTimeout,
  wrapErrorHandler,
  readyStateToString,
  networkStateToString,
  mediaErrorToString,
  requestIdleCallback,
  isWatchPageUrl,
  VIEW_DISABLED,
  VIEW_DETACHED,
  VIEW_SMALL,
  VIEW_THEATER,
  VIEW_FULLSCREEN,
  VIEW_POPUP,
  setStyleProperty,
  setWarning,
} from './generic';
import ErrorReporter from './errors/reporter';
import BarDetection from './bar-detection';
import Settings, {
  DEBANDING_BLEND_MODE_LCD,
  DEBANDING_BLEND_MODE_OLED,
  FRAMESYNC_DECODEDFRAMES,
  FRAMESYNC_DISPLAYFRAMES,
  FRAMESYNC_VIDEOFRAMES,
} from './settings';
import Projector2d from './projector-2d';
import ProjectorWebGL from './projector-webgl';
import { WebGLOffscreenCanvas } from './canvas-webgl';
import Theming from './theming';
import Stats from './stats';
import { injectedScript } from './messaging/injected';
import { getNodeTreeString, getPageElems } from './errors/dom';
import { getNoiseImageUrl } from './webext';

export default class Ambientlight {
  innerStrength = 2;
  lastUpdateSizesChanged = 0;
  averageVideoFramesDifference = 1;

  videoOffset = {};
  srcVideoOffset = {};
  videoScale = 100;

  isHidden = true;
  // The page style (theme and blended elements) is kept while only the ambient light is hidden
  keepPageStyle = false;
  isOnVideoPage = true;
  showedCompareWarning = false;
  getImageDataAllowed = true;
  catchedErrors = [];

  atTop = true;
  p = null;
  view = undefined;
  immersiveTheater = false;
  isFullscreen = false;
  isFillingFullscreen = false;
  isVideoHiddenOnWatchPage = false;
  isHdr = false;
  isMirrored = false;

  lastUpdateStatsTime = 0;
  updateStatsInterval = 1000;
  frameCountHistory = 4000;
  videoFrameCount = 0;
  displayFrameRate = 0;
  videoFrameRate = 0;
  ambientlightFrameCount = 0;
  ambientlightFrameRate = 0;
  ambientlightVideoDroppedFrameCount = 0;
  previousFrameTime = 0;
  previousDrawTime = 0;
  clearTime = 0;

  constructor(videoElem, appElem, mastheadElem) {
    return async function AmbientlightConstructor() {
      // The top level element of the webpage that contains the video player (For example: #app)
      if (appElem) appElem.toggleAttribute('data-ambientlight-app', true);
      this.appElem = appElem;
      // The Bilibili page header (optional)
      if (mastheadElem)
        mastheadElem.toggleAttribute('data-ambientlight-masthead', true);
      this.mastheadElem = mastheadElem;

      this.detectChromiumBug1142112Workaround();
      this.detectChromiumBugDirectVideoOverlayWorkaround();
      this.detectMozillaBug1606251Workaround();
      this.detectMozillaBugSlowCanvas2DReadPixelsWorkaround();
      this.detectChromiumBug1092080Workaround();

      this.initElems(videoElem);
      await this.initSettings();
      this.applyChromiumBugDirectVideoOverlayWorkaround();
      await this.waitForPageload();

      this.theming = new Theming(this);
      this.stats = new Stats(this);
      this.barDetection = new BarDetection(this);
      this.detectChromiumBug1123708Workaround();
      this.detectChromiumBugVideoJitterWorkaround();

      if (document.visibilityState === 'hidden') {
        await new Promise((resolve) => raf(resolve)); // Prevents lost WebGLContext on pageload in a background tab
      }
      await this.initAmbientlightElems();
      this.initBuffersWrapper();
      await this.initProjectorBuffers();
      this.recreateProjectors();
      this.stats.initElems();

      this.initStyles();
      this.updateStyles();

      this.checkGetImageDataAllowed();
      await this.initListeners();

      new Promise((resolve) =>
        wrapErrorHandler(() => {
          this.initializedTime = performance.now();
          this.settings.onLoaded();
          resolve();
        })()
      );

      if (this.settings.enabled) {
        await wrapErrorHandler(async () => {
          await this.enable(true);
        })();
      }

      return this;
    }.bind(this)();
  }

  initElems(videoElem) {
    this.initPlayerElems(videoElem);
    this.initVideoElem(videoElem, false);
  }

  // Bilibili video player structure:
  // .bpx-player-container[data-screen="normal|wide|web|full|mini"]
  //   .bpx-player-primary-area
  //     .bpx-player-video-area (videoAreaElem)
  //       .bpx-player-video-perch
  //         .bpx-player-video-wrap (videoContainerElem)
  //           video
  //       .bpx-player-control-wrap ... .bpx-player-control-bottom-right (settingsMenuBtnParent)
  //     .bpx-player-sending-area
  initPlayerElems(videoElem) {
    const videoPlayerElem = videoElem.closest('.bpx-player-container');
    if (!videoPlayerElem) {
      const error = new Error(
        'Cannot find videoPlayerElem: .bpx-player-container'
      );
      error.details = getPageElems();
      error.details.videoIsInDocument = document.contains(videoElem);
      error.details.videoTree = getNodeTreeString(videoElem);
      setWarning(`載入失敗。\n${error.message}`);
      throw error;
    }

    const settingsMenuBtnParent = videoPlayerElem.querySelector(
      '.bpx-player-control-bottom-right'
    );
    if (!settingsMenuBtnParent) {
      const error = new Error(
        'Cannot find settingsMenuBtnParent: .bpx-player-control-bottom-right'
      );
      error.details = getPageElems();
      setWarning(`載入失敗。\n${error.message}`);
      throw error;
    }

    this.videoPlayerElem = videoPlayerElem;
    this.videoPlayerElem.dataset.ytalElem = 'video-player';
    this.videoAreaElem =
      videoElem.closest('.bpx-player-video-area') ?? this.videoPlayerElem;
    this.videoContainerElem =
      videoElem.closest('.bpx-player-video-wrap') ?? videoElem.parentElement;
    this.settingsMenuBtnParent = settingsMenuBtnParent;
  }

  // Called when Bilibili has replaced the video player (For example: after navigating to another video)
  async reinitPlayerElems(videoElem) {
    const previousVideoPlayerElem = this.videoPlayerElem;
    this.resetVideoParentElemStyle();
    this.initPlayerElems(videoElem);
    this.initVideoElem(videoElem, false);

    if (previousVideoPlayerElem !== this.videoPlayerElem) {
      this.observePlayerElems();
      this.settings.attachToPlayer(
        this.settingsMenuBtnParent,
        this.videoAreaElem
      );
      this.stats.initElems();
    }
    this.initVideoListeners();

    this.view = undefined; // Force the view and the ambientlight element position to be updated
    this.sizesChanged = true;
    await this.updateView();
  }

  initVideoElem(videoElem, initListeners = true) {
    this.cancelScheduledRequestVideoFrame();

    videoElem.dataset.ytalElem = 'video';
    this.videoElem = videoElem;
    this.applyChromiumBugDirectVideoOverlayWorkaround();
    if (initListeners) this.initVideoListeners();
  }

  // FireFox workaround: WebGLParent::RecvReadPixels is slow when reading from a HtmlCanvasElement/OffscreenCanvas (performance scales linear with the amount of pixels to be read)
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1719154
  detectMozillaBugSlowCanvas2DReadPixelsWorkaround() {
    const match = navigator.userAgent.match(/Firefox\/((?:\.|[0-9])+)/);
    const version = match?.length > 1 ? parseFloat(match[1]) : null;
    if (version && (version < 123 || version > 124)) {
      this.enableMozillaBugReadPixelsWorkaround = true;
    }
  }
  shouldDrawDirectlyFromVideoElem = () =>
    this.enableMozillaBugReadPixelsWorkaround &&
    this.projector.webGLVersion === 2;

  // FireFox workaround: Force to rerender the outer blur of the canvasses
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1606251
  detectMozillaBug1606251Workaround() {
    const match = navigator.userAgent.match(/Firefox\/((?:\.|[0-9])+)/);
    const version = match?.length > 1 ? parseFloat(match[1]) : null;
    if (version && version < 74) {
      this.enableMozillaBug1606251Workaround = true;
    }
  }

  // Chromium workaround: The video player could drop the video quality because the video is dropping frames
  // for about ~2 seconds when requestVideoFrameCallback is used and the video
  // has been scrolled from onscreen to offscreen
  // https://bugs.chromium.org/p/chromium/issues/detail?id=1142112
  detectChromiumBug1142112Workaround() {
    const match = navigator.userAgent.match(/Chrome\/((?:\.|[0-9])+)/);
    const version = match?.length > 1 ? parseFloat(match[1]) : null;
    if (version && HTMLVideoElement.prototype.requestVideoFrameCallback) {
      this.enableChromiumBug1142112Workaround = true;
    }
  }

  applyChromiumBug1142112Workaround() {
    if (!this.enableChromiumBug1142112Workaround) return;

    injectedScript.postMessage('apply-chromium-bug-1142112-workaround');
  }

  // Chromium workaround: Force to render the blur originating from the canvasses past the browser window
  // https://bugs.chromium.org/p/chromium/issues/detail?id=1123708
  detectChromiumBug1123708Workaround() {
    if (this.settings.webGL) return;

    const match = navigator.userAgent.match(/Chrome\/((?:\.|[0-9])+)/);
    const version = match?.length > 1 ? parseFloat(match[1]) : null;
    if (version && version >= 85) {
      this.enableChromiumBug1123708Workaround = true;
    }
  }

  // Chromium workaround: drawImage randomly disables antialiasing in the videoOverlay and/or projectors
  // Additional 0.05ms performance impact per clearRect()
  // https://bugs.chromium.org/p/chromium/issues/detail?id=1092080
  detectChromiumBug1092080Workaround() {
    const match = navigator.userAgent.match(/Chrome\/((?:\.|[0-9])+)/);
    const version = match?.length > 1 ? parseFloat(match[1]) : null;
    if (version && version >= 82 && version < 88) {
      this.enableChromiumBug1092080Workaround = true;
    }
  }

  // Fixes video stuttering when display framerate > ambient framerate
  detectChromiumBugVideoJitterWorkaround() {
    if (!this.settings.webGL) return; // This has to much impact on the performance of the Canvas2D renderer

    const match = navigator.userAgent.match(/Chrome\/((?:\.|[0-9])+)/);
    const version = match?.length > 1 ? parseFloat(match[1]) : null;
    if (version) {
      this.enableChromiumBugVideoJitterWorkaround = true;
      this.settings.updateVisibility();
    }
  }

  // Disable the direct composition video overlay that can cause artifacts on Windows
  // https://github.com/WesselKroos/youtube-ambilight/blob/master/TROUBLESHOOT.md#3-nvidia-rtx-video-super-resolution-vsr--nvidia-rtx-video-hdr-does-not-work
  detectChromiumBugDirectVideoOverlayWorkaround() {
    const match = navigator.userAgent.match(/Windows/);
    if (match?.length > 0) {
      this.enableChromiumBugDirectVideoOverlayWorkaround = true;
    }
  }

  applyChromiumBugDirectVideoOverlayWorkaround() {
    if (!this.videoElem || !this.settings) return;

    this.videoElem.classList.toggle(
      'ambientlight__chromium-bug-direct-video-overlay-workaround',
      this.enableChromiumBugDirectVideoOverlayWorkaround &&
        this.settings.chromiumDirectVideoOverlayWorkaround
    );
  }

  applyChromiumBugVideoJitterWorkaround() {
    try {
      if (!this.enableChromiumBugVideoJitterWorkaround) return;
      if (!this.settings.chromiumBugVideoJitterWorkaround) {
        if (this.chromiumBugVideoJitterWorkaround) {
          const { elem } = this.chromiumBugVideoJitterWorkaround;
          if (elem.parentElement) elem.parentElement.removeChild(elem);
          this.chromiumBugVideoJitterWorkaround = undefined;
        }
        return;
      }
      if (this.chromiumBugVideoJitterWorkaround) return;

      const elem = document.createElement('div');
      elem.classList.add('ambientlight__chromium-bug-video-jitter-workaround');

      const update = wrapErrorHandler(
        function chromiumBugVideoJitterWorkaroundUpdate() {
          const isPlaying = !this.videoElem.paused && !this.videoElem.ended;

          const enable =
            this.averageVideoFramesDifference >=
              this.averageVideoFramesDifference1SecondThreshold &&
            isPlaying &&
            !this.isHidden &&
            !this.videoIsHidden &&
            !(this.settings.spread === 0 && this.settings.blur2 === 0);

          if (enable && elem.parentElement !== this.containerElem) {
            this.containerElem.appendChild(elem);
          } else if (!enable && elem.parentElement) {
            elem.parentElement.removeChild(elem);
          }
        }.bind(this),
        true
      );

      this.chromiumBugVideoJitterWorkaround = {
        elem,
        update,
      };

      update();
    } catch (ex) {
      console.warn(
        'applyChromiumBugVideoJitterWorkaround error. Continuing ambientlight initialization...'
      );
      ErrorReporter.captureException(ex);
      this.enableChromiumBugVideoJitterWorkaround = false; // Prevent retries
    }
  }

  waitForPageload = async () => {
    if (
      (this.settings.enabled && !this.settings.prioritizePageLoadSpeed) ||
      !this.videoElem ||
      !isWatchPageUrl()
    )
      return;

    if (this.videoElem.readyState < 3) {
      await new Promise((resolve) => {
        if (!(this.videoElem.readyState < 3)) {
          resolve();
          return;
        }

        const handleCanPlay = () => {
          off(this.videoElem, 'canplay', handleCanPlay);
          resolve();
        };
        on(this.videoElem, 'canplay', handleCanPlay);
      });

      await new Promise((resolve) =>
        requestIdleCallback(resolve, { timeout: 1000 })
      ); // Buffering/rendering budget for low-end devices
    } else {
      await new Promise((resolve) =>
        requestIdleCallback(resolve, { timeout: 2000 })
      ); // Buffering/rendering budget for low-end devices
    }

    if (document.visibilityState === 'hidden') {
      await new Promise((resolve) => raf(resolve));
    }
  };

  initStyles() {
    this.styleElem = document.createElement('style');
    this.styleElem.appendChild(document.createTextNode(''));
    document.head.appendChild(this.styleElem);
  }

  lastVideoElemSrc = '';
  initVideoIfSrcChanged = async () => {
    if (this.lastVideoElemSrc === this.videoElem.src) {
      return false;
    }

    this.lastVideoElemSrc = this.videoElem.src;
    await this.start();

    return true;
  };

  initVideoListeners() {
    ////// PLAYER FLOW
    //
    // LEGEND
    //
    // [  Start
    // ]  End
    // *  When drawImage is called
    //
    // FLOWS
    //
    // Start (paused):                                                                      [ *loadeddata -> canplay ]
    // Start (playing):                            [ play    ->                               *loadeddata -> canplay -> *playing ]
    // Start (from previous video):  [ emptied 2x -> play    ->                               *loadeddata -> canplay -> *playing ]
    // Video src change (paused):    [    emptied ->                               *seeked ->  loadeddata -> canplay ]
    // Video src change (playing):   [    emptied -> play                                     *loadeddata -> canplay -> *playing ]
    // Quality change (paused):      [    emptied ->            seeking ->         *seeked ->  loadeddata -> canplay ]
    // Quality change (playing):     [    emptied -> play    -> seeking ->         *seeked ->  loadeddata -> canplay -> *playing ]
    // Seek (paused):                                         [ seeking ->         *seeked ->                canplay ]
    // Seek (playing):                             [ pause   -> seeking -> play -> *seeked ->                canplay -> *playing ]
    // Play:                                                             [ play ->                                      *playing ]
    // Load more data (playing):                   [ waiting ->                                              canplay -> *playing ]
    // End video:  [ pause -> ended ]
    //
    //////

    this.videoListeners = this.videoListeners || {
      seeked: async () => {
        if (!this.settings.enabled || !this.isOnVideoPage) return;

        // Prevent WebGL flicker reduction from mixing old frames
        if (this.projectorBuffer?.ctx?.clearPreviousRect) {
          this.projectorBuffer.ctx.clearPreviousRect();
        }

        // When the video is paused this is the first event. Else [loadeddata] is first
        if (await this.initVideoIfSrcChanged()) return;

        this.previousPresentedFrames = 0;
        this.videoFrameCounts = [];
        this.videoPresentedFrames = 0;
        this.displayFrameCounts = [];
        this.ambientlightFrameCounts = [];
        this.lastUpdateStatsTime = performance.now();

        this.barDetection.cancel();

        // Prevent any old frames from being drawn
        this.buffersCleared = true;

        // Prevent WebGL frameFading/frameBlending from mixing old frames
        if (
          this.settings.webGL &&
          (this.settings.frameFading || this.settings.frameBlending)
        ) {
          this.projector.drawTextureSize = {
            width: 0,
            height: 0,
          };
        }

        await this.optionalFrame();
      },
      loadstart: () => {
        this.settings.setWarning(undefined, undefined, undefined, 'encrypted');
      },
      encrypted: () => {
        this.settings.setWarning(
          '這部影片受到 Bilibili 的 DRM 保護，無法顯示環境光',
          true,
          true,
          'encrypted'
        );
      },
      loadeddata: async () => {
        if (!this.settings.enabled || !this.isOnVideoPage) return;

        this.sizesChanged = true;
        this.buffersCleared = true;

        // Prevent WebGL flicker reduction from mixing old frames
        if (this.projectorBuffer?.ctx?.clearPreviousRect) {
          this.projectorBuffer.ctx.clearPreviousRect();
        }

        // Whent the video is playing this is the first event. Else [seeked] is first
        this.checkGetImageDataAllowed(); // Re-check after crossOrigin attribute has been applied
        await this.updateHdr();
        await this.initVideoIfSrcChanged();
      },
      playing: async () => {
        this.chromiumBugVideoJitterWorkaround?.update?.();
        if (!this.settings.enabled || !this.isOnVideoPage) return;
        if (this.videoElem.paused) return; // When paused handled by [seeked]

        await this.optionalFrame();
      },
      pause: () => {
        this.chromiumBugVideoJitterWorkaround?.update?.();
      },
      ended: () => {
        this.chromiumBugVideoJitterWorkaround?.update?.();
        if (!this.settings.enabled || !this.isOnVideoPage) return;
        if (this.clearTime < performance.now() - 500) this.clear();
        this.stats.hide();
        this.scheduledNextFrame = false;
        this.resetVideoParentElemStyle(); // Prevent visible video element above player because of the modified style attribute
      },
      emptied: () => {
        if (!this.settings.enabled || !this.isOnVideoPage) return;
        if (this.clearTime < performance.now() - 500) this.clear();
        this.scheduledNextFrame = false;
      },
      error: (ex) => {
        const videoElem = ex?.target;
        const error = videoElem?.error;
        console.log(`Restoring the ambient light after a video error...
Video error: ${mediaErrorToString(error?.code)} ${
          error?.message ? `(${error?.message})` : ''
        }
Video network state: ${networkStateToString(videoElem?.networkState)}
Video ready state: ${readyStateToString(videoElem?.readyState)}`);
        if (this.clearTime < performance.now() - 500) this.clear();
        this.cancelScheduledRequestVideoFrame();
        if (this.handleVideoErrorTimeout) return;

        this.handleVideoErrorTimeout = setTimeout(this.handleVideoError, 1000);
      },
      click: this.settings.onCloseMenu,
      enterpictureinpicture: async () => {
        this.videoIsPictureInPicture = true;
        await this.optionalFrame();
      },
      leavepictureinpicture: async () => {
        this.videoIsPictureInPicture = false;
        await this.optionalFrame();
      },
    };
    for (const name in this.videoListeners) {
      off(this.videoElem, name, this.videoListeners[name]);
      on(this.videoElem, name, this.videoListeners[name]);
    }

    if (this.videoObserver) {
      this.videoObserver.disconnect();
    }
    this.videoIsHidden = false; // IntersectionObserver is always executed at least once when the observation starts
    if (!this.videoObserver) {
      this.videoObserver = new IntersectionObserver(
        wrapErrorHandler((entries, observer) => {
          if (!window.ambientlight) return;
          if (window.ambientlight !== this) {
            observer.disconnect(); // Disconnect, because ambientlight crashed on initialization and created a new instance
            return;
          }

          for (const entry of entries) {
            if (this.videoElem !== entry.target) {
              this.videoObserver.unobserve(entry.target); // video is detached and a new one was created
              continue;
            }
            this.videoIsHidden = entry.intersectionRatio === 0;
            this.videoVisibilityChangeTime = performance.now();
            // this.videoElem.getVideoPlaybackQuality(); // Correct dropped frames
          }

          if (this.chromiumBugVideoJitterWorkaround?.update)
            this.chromiumBugVideoJitterWorkaround.update();
        }, true),
        {
          rootMargin: '-70px 0px 0px 0px', // header height (64px) + additional pixels to be safe
          threshold: 0.0001, // Because sometimes a pixel in not visible on screen but the intersectionRatio is already 0
        }
      );
    }
    this.videoObserver.observe(this.videoElem);

    // The video element can be replaced by Bilibili
    if (this.videoResizeObserver) {
      this.videoResizeObserver.disconnect();
      this.videoResizeObserver.observe(this.videoElem);
    }

    this.applyChromiumBug1142112Workaround();
    this.applyChromiumBugVideoJitterWorkaround();
  }

  handleVideoError = () => {
    this.handleVideoErrorTimeout = undefined;
    this.initVideoListeners();
    if (!this.videoElem.paused) {
      this.videoListeners.playing();
    }
  };

  updateVideoPlayerSize = async () => {
    if (this.videoPlayerSetSizePromise) {
      await this.videoPlayerSetSizePromise;
      return;
    }

    await injectedScript.postAndReceiveMessage('video-player-set-size');
  };

  async initListeners() {
    this.initVideoListeners();

    if (this.settings.webGL) {
      this.projector.handleRestored = async () => {
        this.buffersCleared = true;
        this.sizesChanged = true;

        this.cancelScheduledRequestVideoFrame();
        // eslint-disable-next-line no-self-assign
        this.videoElem.currentTime = this.videoElem.currentTime; // Triggers video draw call

        await this.optionalFrame();
      };
    }

    on(
      document,
      'visibilitychange',
      this.handleDocumentVisibilityChange,
      false
    );
    on(
      document,
      'fullscreenchange',
      async function fullscreenchange() {
        await this.updateSizes();
      }.bind(this),
      false
    );

    on(document, 'keydown', this.handleKeyDown);

    if (this.topElem) {
      this.topElemObserver = new IntersectionObserver(
        wrapErrorHandler(async (entries) => {
          let atTop = true;
          for (const entry of entries) {
            atTop = entry.intersectionRatio !== 0;
          }
          if (this.atTop === atTop) return;

          this.atTop = atTop;
          await this.updateAtTop();

          // When the video is filled and paused in fullscreen the ambientlight is out of sync with the video
          if (this.isFillingFullscreen && !this.atTop) {
            this.buffersCleared = true;
            await this.optionalFrame();
          }
        }, true),
        {
          threshold: 0.0001, // Because sometimes a pixel in not visible on screen but the intersectionRatio is already 0
        }
      );
      this.topElemObserver.observe(this.topElem);
      this.atTop = window.scrollY === 0;
      await this.updateAtTop();
    }

    if (this.settings.webGL)
      on(window, 'resize', this.projector.handleWindowResize, false);

    const resizeTooSmall = (pRect, rect) =>
      Math.abs(rect.x - (pRect?.x || 0)) <= 2 &&
      Math.abs(rect.y - (pRect?.y || 0)) <= 2 &&
      Math.abs(rect.width - (pRect?.width || 0)) <= 2 &&
      Math.abs(rect.height - (pRect?.height || 0)) <= 2;
    // Only triggers when the html width changes because the height is 0
    let previousHtmlRect;
    this.htmlResizeObserver = new ResizeObserver(
      wrapErrorHandler(
        function htmlResize(e) {
          if (!this.settings.enabled || !this.isOnVideoPage) return;

          const rect = e[0].contentRect;
          if (resizeTooSmall(previousHtmlRect, rect)) return;

          previousHtmlRect = rect;
          this.resize(); // Because the video position could be shifted
        }.bind(this),
        true
      )
    );
    this.htmlResizeObserver.observe(document.documentElement);

    // Makes sure the player size is recalculated after the scrollbar has been hidden
    // and the styles are recalculated.
    // The website could calculate it before the styles are recalculated.
    let previousVideoPlayerRect;
    this.videoPlayerResizeObserver = new ResizeObserver(
      wrapErrorHandler(
        function videoPlayerResize(e) {
          if (!this.settings.enabled || !this.isOnVideoPage) {
            previousVideoPlayerRect = undefined;
            return;
          }

          const rect = e[0].contentRect;
          if (resizeTooSmall(previousVideoPlayerRect, rect)) return;

          // if(!this.isFullscreen) {
          //   try {
          //     await new Promise(resolve => raf(resolve)) // Wait for all layout style recalculations
          //     this.videoPlayerElem.setSize()
          //     this.videoPlayerElem.setInternalSize()
          //     await new Promise(resolve => raf(resolve)) // Wait for all layout style recalculations
          //     this.sizesChanged = true
          //   } catch(ex) {
          //     console.warn('Failed to resize the video player')
          //   }
          // }
          if (!this.settings.enabled) return;

          previousVideoPlayerRect = rect;
          this.resize(
            this.videoPlayerResizeToFullscreen
              ? 0
              : this.videoPlayerResizeFromFullscreen
              ? 0
              : 0
          );
          this.videoPlayerResizeFromFullscreen = false;
          this.videoPlayerResizeToFullscreen = false;
        }.bind(this),
        true
      )
    );

    // // Deprecated: Moved to videoPlayerResizeObserver
    // this.videoContainerResizeObserver = new ResizeObserver(wrapErrorHandler(function videoContainerResize() {
    //   this.resize()
    // }.bind(this), true))
    // this.videoContainerResizeObserver.observe(this.videoContainerElem)

    let previousVideoRect;
    this.videoResizeObserver = new ResizeObserver(
      wrapErrorHandler(
        function videoResize(e) {
          if (!this.settings.enabled || !this.isOnVideoPage) {
            previousVideoRect = undefined;
            return;
          }

          const rect = e[0].contentRect;
          if (resizeTooSmall(previousVideoRect, rect)) {
            return;
          }

          previousVideoRect = rect;
          this.resize();
        }.bind(this),
        true
      )
    );
    this.videoResizeObserver.observe(this.videoElem);

    injectedScript.addMessageListener('sizes-changed', () => {
      this.sizesChanged = true;
    });

    this.theming.initListeners();

    // Bilibili changes the view with the data-screen attribute
    // and the mirror setting with the bpx-state-mirror class
    this.videoPlayerObserver = new MutationObserver(
      wrapErrorHandler(
        async function videoPlayerMutation() {
          const mirroredChanged = this.updateIsMirrored();
          const viewChanged = await this.updateView();
          if (!viewChanged && !mirroredChanged) return;

          await this.optionalFrame();
        }.bind(this),
        true
      )
    );
    this.observePlayerElems();

    await this.updateView();
  }

  observePlayerElems() {
    this.videoPlayerResizeObserver.disconnect();
    this.videoPlayerResizeObserver.observe(this.videoPlayerElem);

    this.videoPlayerObserver.disconnect();
    this.videoPlayerObserver.observe(this.videoPlayerElem, {
      attributes: true,
      attributeFilter: ['class', 'data-screen'],
    });
    this.updateIsMirrored();
  }

  updateIsMirrored = () => {
    const isMirrored =
      this.videoPlayerElem?.classList.contains('bpx-state-mirror') ?? false;
    if (this.isMirrored === isMirrored) return false;

    this.isMirrored = isMirrored;
    this.sizesChanged = true;
    return true;
  };

  delayResizes = true;
  resizeDurationThreshold = 300;
  resizeDurations = [
    this.resizeDurationThreshold,
    this.resizeDurationThreshold,
    this.resizeDurationThreshold,
    this.resizeDurationThreshold,
  ];

  resizeAfterFrames = 0;
  resize = wrapErrorHandler(async (afterFrames = 0) => {
    if (!this.settings.enabled || !this.isOnVideoPage || this.pendingStart) {
      this.resizeAfterFrames = 0;
      if (this.scheduledResize) cancelAnimationFrame(this.scheduledResize);
      this.scheduledResize = undefined;
      return;
    }

    this.delayResizes =
      this.delayResizes ||
      this.videoPlayerResizeFromFullscreen ||
      this.videoPlayerResizeToFullscreen;
    this.resizeAfterFrames = this.delayResizes
      ? Math.max(this.resizeAfterFrames, afterFrames)
      : 0;

    if (this.scheduledResize) return;

    if (this.resizeAfterFrames === 0) {
      this.sizesInvalidated = true;
      const start = performance.now();
      await this.optionalFrame();
      requestIdleCallback(() => this.measureResizeDuration(start), {
        timeout: 1000,
      });
    }

    // Do not resize untill the next animation frame
    this.scheduledResize = raf(() => {
      this.scheduledResize = undefined;
      if (this.resizeAfterFrames === 0) return;

      this.resizeAfterFrames--;
      this.resize();
    });
  });

  measureResizeDuration = (start) => {
    const duration = Math.min(1000, performance.now() - start);
    this.resizeDurations.push(duration);
    if (this.resizeDurations.length > 4) this.resizeDurations.splice(0, 1);
    const averageDuration =
      this.resizeDurations.reduce((a, b) => a + b) /
      this.resizeDurations.length;
    this.delayResizes = averageDuration >= this.resizeDurationThreshold;
  };

  handleDocumentVisibilityChange = async () => {
    if (this.handlePageVisibilityTimeout) {
      clearTimeout(this.handlePageVisibilityTimeout);
      this.handlePageVisibilityTimeout = undefined;
    }

    if (!this.settings.enabled || !this.isOnVideoPage) return;

    const isPageHidden = document.visibilityState === 'hidden';
    if (this.isPageHidden === isPageHidden) return;
    this.isPageHidden = isPageHidden;

    if (isPageHidden) {
      this.pageHiddenTime = performance.now();
      this.checkIfNeedToHideVideoOverlay();
      this.buffersCleared = true;
      this.sizesChanged = true;

      this.handlePageVisibilityTimeout = setTimeout(
        function handlePageVisibility() {
          this.handlePageVisibilityTimeout = undefined;
          this.pageHiddenClearTime = performance.now();

          // const lintExt = this.ctx.getExtension('GMAN_debug_helper');
          // if(lintExt) lintExt.disable() // weblg-lint throws incorrect errors after the WebGL context has been lost once

          // Set canvas sizes & textures to 1x1 to clear GPU memory
          this.clear();
        }.bind(this),
        3000
      );
    } else {
      this.pageShownTime = performance.now();
      await this.theming.updateTheme();
      await this.optionalFrame();
    }
  };

  handleKeyDown = async (e) => {
    if (!this.isOnVideoPage) return;
    if (document.activeElement) {
      const el = document.activeElement;
      const tag = el.tagName;
      const inputs = ['INPUT', 'SELECT', 'TEXTAREA'];
      if (
        inputs.indexOf(tag) !== -1 ||
        (el.getAttribute('contenteditable') != null &&
          el.getAttribute('contenteditable') !== 'false')
      ) {
        return;
      }
    }
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;

    await this.onKeyPressed(e.key?.toUpperCase());
  };

  onKeyPressed = async (key) => {
    if (key === ' ') return;

    const keys = this.settings.getKeys();
    if (key === keys.detectHorizontalBarSizeEnabled)
      this.settings.clickUI('detectHorizontalBarSizeEnabled');
    if (key === keys.detectVerticalBarSizeEnabled)
      this.settings.clickUI('detectVerticalBarSizeEnabled');
    if (key === keys.detectVideoFillScaleEnabled)
      this.settings.clickUI('detectVideoFillScaleEnabled');
    if (key === keys.enabled) await this.toggleEnabled();
  };

  async toggleEnabled(enabled) {
    if (this.pendingStart) return;
    enabled = enabled !== undefined ? enabled : !this.settings.enabled;
    if (enabled) {
      await this.enable();
    } else {
      await this.disable();
    }
    this.settings.displayBezelForSetting('enabled');
  }

  checkGetImageDataAllowed() {
    const isSameOriginVideo =
      !!this.videoElem.src &&
      this.videoElem.src.indexOf(location.origin) !== -1;
    const getImageDataAllowed =
      !window.chrome ||
      isSameOriginVideo ||
      (!isSameOriginVideo && !!this.videoElem.crossOrigin);

    if (this.getImageDataAllowed === getImageDataAllowed) return;

    this.getImageDataAllowed = getImageDataAllowed;
    this.settings.updateVisibility();
  }

  async initAmbientlightElems() {
    this.elem = document.createElement('div');
    this.elem.classList.add('ambientlight');

    this.containerElem = document.createElement('div');
    this.containerElem.classList.add('ambientlight__container');
    this.containerElem.style.position = 'absolute';
    this.elem.prepend(this.containerElem);

    // Always created, because Bilibili can render the header after the ambientlight has been initialized
    this.topElem = document.createElement('div');
    this.topElem.classList.add('ambientlight__top');
    this.elem.prepend(this.topElem);

    this.clearfixElem = document.createElement('div');
    this.clearfixElem.classList.add('ambientlight__clearfix');
    this.elem.prepend(this.clearfixElem);

    this.videoShadowElem = document.createElement('div');
    this.videoShadowElem.classList.add('ambientlight__video-shadow');
    this.containerElem.prepend(this.videoShadowElem);

    this.filterElem = document.createElement('div');
    this.filterElem.classList.add('ambientlight__filter');
    this.containerElem.prepend(this.filterElem);

    if (this.enableChromiumBug1123708Workaround) {
      this.chromiumBug1123708WorkaroundElem = new Canvas(1, 1, true);
      this.chromiumBug1123708WorkaroundElem.classList.add(
        'ambientlight__chromium-bug-1123708-workaround'
      );
      this.filterElem.prepend(this.chromiumBug1123708WorkaroundElem);
    }

    this.clipElem = document.createElement('div');
    this.clipElem.classList.add('ambientlight__clip');
    this.filterElem.prepend(this.clipElem);

    this.projectorsElem = document.createElement('div');
    this.projectorsElem.classList.add('ambientlight__projectors');
    this.clipElem.prepend(this.projectorsElem);

    this.projectorListElem = document.createElement('div');
    this.projectorListElem.classList.add('ambientlight__projector-list');
    this.projectorsElem.prepend(this.projectorListElem);

    this.appendElemToContentElem();

    await this.initProjector();
  }

  // Not inside #app, because Vue could re-render #app or mount other components in the ambientlight element
  getContentElem = () => document.body;

  // Bilibili can replace the top level element of the page (#app) and the header after the page has been loaded.
  // Returns true when an element has been replaced.
  updatePageElems(appElem, mastheadElem) {
    let changed = false;
    if (appElem && appElem !== this.appElem) {
      appElem.toggleAttribute('data-ambientlight-app', true);
      this.appElem = appElem;
      this.sizesChanged = true;
      changed = true;
    }
    if (mastheadElem && mastheadElem !== this.mastheadElem) {
      mastheadElem.toggleAttribute('data-ambientlight-masthead', true);
      this.mastheadElem = mastheadElem;
      this.mastheadElem.classList.toggle('at-top', this.atTop);
      this.updateStyles();
      changed = true;
    }
    return changed;
  }

  // In fullscreen and web fullscreen (data-screen="full" or "web") the player is
  // positioned above the page. So the ambient light has to be placed inside the player.
  getFullscreenContentElem() {
    if (
      document.fullscreenElement &&
      !document.fullscreenElement.contains(this.videoPlayerElem)
    ) {
      return document.fullscreenElement;
    }
    return this.videoPlayerElem;
  }

  appendElemToContentElem() {
    const contentElem = this.getContentElem();
    if (this.elem.parentElement === contentElem) return;

    contentElem.append(this.elem);
  }

  appendElemToFullscreenElem() {
    const fullscreenContentElem = this.getFullscreenContentElem();

    if (this.elem.parentElement === fullscreenContentElem) return;

    // Appended instead of prepended to prevent conflicts with the first child of the player
    fullscreenContentElem.append(this.elem);
  }

  initProjector = async () => {
    if (this.settings.webGL) {
      try {
        this.projector = await new ProjectorWebGL(
          this,
          this.projectorListElem,
          this.initProjectorListeners,
          this.settings
        );
      } catch (ex) {
        this.projector = undefined;
        if (!this.settings.webGLCrashDate) {
          ErrorReporter.captureException(ex);
        } else {
          console.log(ex);
          if (ex?.details) console.log(ex.details);
        }
        this.settings.handleWebGLCrash();
      }
    }

    if (!this.projector) {
      this.projector = new Projector2d(
        this,
        this.projectorListElem,
        this.initProjectorListeners,
        this.settings
      );
    }
    this.initProjectorListeners();
  };

  initProjectorListeners = () => {
    // Dont draw ambientlight when its not in viewport
    this.isAmbientlightHiddenOnWatchPage = false;
    if (this.ambientlightObserver) {
      this.ambientlightObserver.disconnect();
    }
    if (!this.ambientlightObserver) {
      this.ambientlightObserver = new IntersectionObserver(
        wrapErrorHandler(async (entries) => {
          for (const entry of entries) {
            this.isAmbientlightHiddenOnWatchPage =
              entry.intersectionRatio === 0;
            if (this.isAmbientlightHiddenOnWatchPage) continue;

            await this.optionalFrame();
          }
        }, true),
        {
          threshold: 0.0001, // Because sometimes a pixel in not visible on screen but the intersectionRatio is already 0
        }
      );
    }
    this.ambientlightObserver.observe(this.projector.boundaryElem);
  };

  initBuffersWrapper() {
    this.buffersWrapperElem = document.createElement('div');
    this.buffersWrapperElem.classList.add('ambientlight__buffers-wrapper');
    this.containerElem.appendChild(this.buffersWrapperElem);
  }

  async initProjectorBuffers() {
    let projectorsBufferElem;
    let projectorsBufferCtx;
    if (this.settings.webGL) {
      try {
        projectorsBufferElem = new WebGLOffscreenCanvas(
          1,
          1,
          this,
          this.settings
        );
        projectorsBufferCtx = await projectorsBufferElem.getContext(
          '2d',
          ctxOptions
        );

        if (this.settings.webGLCrashDate) {
          this.settings.webGLCrashDate = undefined;
          this.settings.webGLCrashVersion = undefined;
          this.settings.saveStorageEntry('webGLCrash', undefined);
          this.settings.saveStorageEntry('webGLCrashVersion', undefined);
          this.settings.updateWebGLCrashDescription();
        }
      } catch (ex) {
        projectorsBufferCtx = undefined;
        if (!this.settings.webGLCrashDate) {
          ErrorReporter.captureException(ex);
        } else {
          console.log(ex);
          if (ex?.details) console.log(ex.details);
        }
        this.settings.handleWebGLCrash();
      }
    }
    if (!projectorsBufferCtx) {
      projectorsBufferElem = new SafeOffscreenCanvas(1, 1, true);
      projectorsBufferCtx = projectorsBufferElem.getContext('2d', ctxOptions);
    }

    if (projectorsBufferElem.tagName === 'CANVAS') {
      this.buffersWrapperElem.appendChild(projectorsBufferElem);
    }
    this.nonHdrProjectorBuffer = {
      elem: projectorsBufferElem,
      ctx: projectorsBufferCtx,
    };
    this.projectorBuffer = this.nonHdrProjectorBuffer;
  }

  initWebGLHdrProjectorBuffer() {
    if (this.hdrProjectorBuffer) return;

    const hdrProjectorsBufferElem = new SafeOffscreenCanvas(1, 1, true);
    const hdrProjectorsBufferCtx = hdrProjectorsBufferElem.getContext(
      '2d',
      ctxOptions
    );

    if (hdrProjectorsBufferElem.tagName === 'CANVAS') {
      this.buffersWrapperElem.appendChild(hdrProjectorsBufferElem);
    }
    this.hdrProjectorBuffer = {
      elem: hdrProjectorsBufferElem,
      ctx: hdrProjectorsBufferCtx,
    };
  }

  async initSettings() {
    this.settings = await new Settings(
      this,
      this.settingsMenuBtnParent,
      this.videoAreaElem
    );
  }

  initVideoOverlay() {
    const videoOverlayElem = new Canvas(1, 1);
    videoOverlayElem.classList.add('ambientlight__video-overlay');
    this.videoOverlay = {
      elem: videoOverlayElem,
      ctx: videoOverlayElem.getContext('2d', {
        ...ctxOptions,
        alpha: true,
      }),
      isHiddenChangeTimestamp: 0,
    };
  }

  initFrameBlending() {
    const previousProjectorsBufferElem = new Canvas(
      this.projectorBuffer.elem.width,
      this.projectorBuffer.elem.height,
      true
    );
    if (previousProjectorsBufferElem.tagName === 'CANVAS') {
      this.buffersWrapperElem.appendChild(previousProjectorsBufferElem);
    }
    this.previousProjectorBuffer = {
      elem: previousProjectorsBufferElem,
      ctx: previousProjectorsBufferElem.getContext('2d', ctxOptions),
    };

    const blendedProjectorsBufferElem = new Canvas(
      this.projectorBuffer.elem.width,
      this.projectorBuffer.elem.height,
      true
    );
    if (blendedProjectorsBufferElem.tagName === 'CANVAS') {
      this.buffersWrapperElem.appendChild(blendedProjectorsBufferElem);
    }
    this.blendedProjectorBuffer = {
      elem: blendedProjectorsBufferElem,
      ctx: blendedProjectorsBufferElem.getContext('2d', ctxOptions),
    };
  }

  initVideoOverlayWithFrameBlending() {
    const videoOverlayBufferElem = new Canvas(
      this.srcVideoOffset.width,
      this.srcVideoOffset.height,
      true
    );
    if (videoOverlayBufferElem.tagName === 'CANVAS') {
      this.buffersWrapperElem.appendChild(videoOverlayBufferElem);
    }
    this.videoOverlayBuffer = {
      elem: videoOverlayBufferElem,
      ctx: videoOverlayBufferElem.getContext('2d', ctxOptions),
    };

    const previousVideoOverlayBufferElem = new Canvas(
      this.srcVideoOffset.width,
      this.srcVideoOffset.height,
      true
    );
    if (previousVideoOverlayBufferElem.tagName === 'CANVAS') {
      this.buffersWrapperElem.appendChild(previousVideoOverlayBufferElem);
    }
    this.previousVideoOverlayBuffer = {
      elem: previousVideoOverlayBufferElem,
      ctx: previousVideoOverlayBufferElem.getContext('2d', ctxOptions),
    };
  }

  async resetSettingsIfNeeded() {
    const videoPath = `${location.pathname}${location.search}`;
    if (!this.prevVideoPath || videoPath !== this.prevVideoPath) {
      if (this.settings.horizontalBarsClipPercentageReset) {
        const horizontalBarChanged = this.setHorizontalBars(0);
        const verticalBarChanged = this.setVerticalBars(0);
        if (horizontalBarChanged || verticalBarChanged) {
          this.sizesChanged = true;
          await this.optionalFrame();
        }
      }
    }
    this.prevVideoPath = videoPath;
    await this.settings.updateHdr();
  }

  setHorizontalBars(percentage) {
    if (this.settings.horizontalBarsClipPercentage === percentage) return false;

    this.settings.set('horizontalBarsClipPercentage', percentage, true);
    return true;
  }

  setVerticalBars(percentage) {
    if (this.settings.verticalBarsClipPercentage === percentage) return false;

    this.settings.set('verticalBarsClipPercentage', percentage, true);
    return true;
  }

  recreateProjectors() {
    this.levels = Math.max(
      2,
      Math.round(this.settings.spread / this.settings.edge) +
        this.innerStrength +
        1
    );
    if (this.projector.recreate) {
      this.projector.recreate(this.levels);
    }
  }

  clear() {
    this.clearTime = performance.now();
    this.barDetection.clear();

    // Clear canvasses
    const canvasses = [];
    if (this.projector) {
      canvasses.push({ ctx: this.projector });
    }
    if (this.projectorBuffer) {
      canvasses.push(this.projectorBuffer);
    }
    if (this.previousProjectorBuffer) {
      canvasses.push(this.previousProjectorBuffer);
      canvasses.push(this.blendedProjectorBuffer);
    }
    if (this.videoOverlay) {
      canvasses.push(this.videoOverlay);
      if (this.videoOverlayBuffer) {
        canvasses.push(this.videoOverlayBuffer);
        canvasses.push(this.previousVideoOverlayBuffer);
      }
    }
    for (const canvas of canvasses) {
      if (canvas.ctx?.clearRect) {
        if (!canvas.ctx.isContextLost || !canvas.ctx.isContextLost()) {
          if (canvas.elem) {
            canvas.ctx.clearRect(0, 0, canvas.elem.width, canvas.elem.height);
          } else {
            canvas.ctx.clearRect();
          }
        }
      } else if (canvas.elem) {
        canvas.elem.width = 1;
      }
    }

    this.buffersCleared = true;
    this.sizesChanged = true;
    this.checkIfNeedToHideVideoOverlay();
    this.scheduleNextFrame();
  }

  updateVideoScale() {
    let videoScale = this.settings[`videoScale.${this.view}`] ?? 100;

    const videoContentRect = this.getVideoContentRect();
    const videoAreaElem = this.videoAreaElem ?? this.videoPlayerElem;
    if (
      this.settings.detectVideoFillScaleEnabled &&
      videoContentRect.width &&
      videoContentRect.height &&
      videoAreaElem?.offsetWidth &&
      videoAreaElem?.offsetHeight
    ) {
      const barScaleX =
        (100 - this.settings.verticalBarsClipPercentage * 2) / 100;
      const barScaleY =
        (100 - this.settings.horizontalBarsClipPercentage * 2) / 100;
      const barScaledVideoWidth = videoContentRect.width * barScaleX;
      const barScaledVideoHeight = videoContentRect.height * barScaleY;

      const containerWidth = videoAreaElem.offsetWidth * (videoScale / 100);
      const containerHeight = videoAreaElem.offsetHeight * (videoScale / 100);

      const filledVideoScaleX = containerWidth / barScaledVideoWidth;
      const filledVideoScaleY = containerHeight / barScaledVideoHeight;
      const filledVideoScale =
        Math.round(Math.min(filledVideoScaleX, filledVideoScaleY) * 10000) /
        100;

      if (
        !isNaN(filledVideoScale) &&
        !(filledVideoScale > 100 && filledVideoScale < 100.5)
      ) {
        videoScale = filledVideoScale;
      }
    }

    this.videoScale = videoScale;

    // Video scale
    setStyleProperty(
      document.documentElement,
      '--ytal-html5-video-player-overflow',
      this.videoScale > 100 ? 'visible' : ''
    );
  }

  // Bilibili stretches the video element to the size of the player and
  // letterboxes the video frame inside it (object-fit: contain).
  // Returns the area of the video frame inside the video element (without transforms)
  getVideoContentRect() {
    const width = this.videoElem?.offsetWidth ?? 0;
    const height = this.videoElem?.offsetHeight ?? 0;
    const videoWidth = this.videoElem?.videoWidth;
    const videoHeight = this.videoElem?.videoHeight;
    if (!width || !height || !videoWidth || !videoHeight)
      return { x: 0, y: 0, width, height };

    let scaleX = width / videoWidth;
    let scaleY = height / videoHeight;
    const objectFit = this.videoObjectFit ?? 'contain';
    if (objectFit === 'contain' || objectFit === 'scale-down') {
      const scale = Math.min(scaleX, scaleY);
      scaleX = scaleY = objectFit === 'scale-down' ? Math.min(1, scale) : scale;
    } else if (objectFit === 'cover') {
      scaleX = scaleY = Math.max(scaleX, scaleY);
    } else if (objectFit === 'none') {
      scaleX = scaleY = 1;
    } // fill: The video frame is stretched to the size of the video element

    const contentWidth = videoWidth * scaleX;
    const contentHeight = videoHeight * scaleY;
    return {
      x: (width - contentWidth) / 2,
      y: (height - contentHeight) / 2,
      width: contentWidth,
      height: contentHeight,
    };
  }

  // The position and size of the video frame relative to the ambientlight container (with transforms)
  getVideoRect() {
    const rect = this.getElemRect(this.videoElem);
    const width = this.videoElem.offsetWidth;
    const height = this.videoElem.offsetHeight;
    if (!width || !height) return rect;

    const content = this.getVideoContentRect();
    const scaleX = rect.width / width;
    const scaleY = rect.height / height;
    return {
      top: rect.top + content.y * scaleY,
      left: rect.left + content.x * scaleX,
      width: content.width * scaleX,
      height: content.height * scaleY,
    };
  }

  getView = () => {
    if (!this.settings.enabled) return VIEW_DISABLED;

    if (!document.contains(this.videoPlayerElem)) return VIEW_DETACHED;

    const screen = this.videoPlayerElem.getAttribute('data-screen');
    if (document.fullscreenElement || screen === 'full' || screen === 'web')
      return VIEW_FULLSCREEN;

    if (screen === 'mini') return VIEW_POPUP;

    if (screen === 'wide') return VIEW_THEATER;

    return VIEW_SMALL;
  };

  updateView = async (skipUpdateImmersiveMode = false) => {
    const view = this.getView();
    if (this.view === view) {
      // Bilibili could have removed the ambientlight element from the page
      if (this.elem && !this.elem.isConnected) this.appendElemToViewContainer();
      return false;
    }

    this.view = view;

    if (!skipUpdateImmersiveMode) await this.updateImmersiveMode();

    const isFullscreen = view == VIEW_FULLSCREEN;
    const fullscreenChanged = isFullscreen !== this.isFullscreen;
    this.isFullscreen = isFullscreen;

    this.updateFixedStyle();
    this.settings.updateVisibility();

    if (fullscreenChanged && this.settings.enabled && this.isOnVideoPage) {
      this.videoPlayerResizeFromFullscreen = !this.isFullscreen;
      this.videoPlayerResizeToFullscreen = this.isFullscreen;
    }

    this.appendElemToViewContainer();

    if (!skipUpdateImmersiveMode) {
      raf(() => this.updateVideoPlayerSize());
    }

    return true;
  };

  appendElemToViewContainer() {
    if (!this.elem) return;

    if (this.isFullscreen) {
      this.appendElemToFullscreenElem();
    } else {
      this.appendElemToContentElem();
    }
  }

  isInEnabledView = () => {
    const enableInViews = this.settings.enableInViews;
    const enabledInView =
      {
        [VIEW_SMALL]: enableInViews <= 2,
        [VIEW_THEATER]:
          enableInViews === 0 || (enableInViews >= 2 && enableInViews <= 4),
        [VIEW_FULLSCREEN]: enableInViews === 0 || enableInViews >= 4,
      }[this.view] || false;

    const enabledInPictureInPicture =
      this.settings.enableInPictureInPicture || !this.videoIsPictureInPicture;

    return enabledInView && enabledInPictureInPicture;
  };

  async updateSizes() {
    await this.updateView();
    this.videoObjectFit = getComputedStyle(this.videoElem).objectFit;
    this.updateVideoScale();

    const noClipOrScale =
      this.settings.horizontalBarsClipPercentage == 0 &&
      this.settings.verticalBarsClipPercentage == 0 &&
      this.videoScale == 100;

    const notVisible =
      !this.settings.enabled ||
      !this.videoContainerElem ||
      !this.videoPlayerElem ||
      !this.isInEnabledView();
    if (notVisible || noClipOrScale) {
      this.resetVideoParentElemStyle();
    }
    this.lastUpdateSizesChanged = performance.now();
    if (notVisible) {
      await this.hide();
      return false;
    }

    this.barsClip = [
      this.settings.verticalBarsClipPercentage,
      this.settings.horizontalBarsClipPercentage,
    ].map((percentage) => percentage / 100);
    this.clippedVideoScale = this.barsClip.map((clip) => 1 - clip * 2);
    this.shouldStyleVideoParentElem =
      this.isOnVideoPage &&
      !this.isVideoHiddenOnWatchPage &&
      !this.videoElem.ended &&
      !noClipOrScale;
    if (this.shouldStyleVideoParentElem) {
      // Hide the removed bars with a clip-path and scale the video with the scale property.
      // Both properties are independent of the transform that Bilibili uses to mirror the video.
      const content = this.getVideoContentRect();
      const clipX = Math.max(
        0,
        Math.round((content.x + content.width * this.barsClip[0]) * 100) / 100
      );
      const clipY = Math.max(
        0,
        Math.round((content.y + content.height * this.barsClip[1]) * 100) / 100
      );
      setStyleProperty(
        this.videoContainerElem,
        '--ytal-video-clip-path',
        `inset(${clipY}px ${clipX}px)`
      );
      setStyleProperty(
        this.videoContainerElem,
        '--ytal-video-scale',
        `${this.videoScale / 100}`
      );
    } else {
      this.resetVideoParentElemStyle();
    }

    this.videoOffset = this.getVideoRect();
    this.isFillingFullscreen =
      this.isFullscreen &&
      Math.abs(this.videoOffset.width - window.innerWidth) < 10 &&
      Math.abs(this.videoOffset.height - window.innerHeight) < 10 &&
      noClipOrScale;

    if (
      this.videoOffset.top === undefined ||
      !this.videoOffset.width ||
      !this.videoOffset.height ||
      !this.videoElem.videoWidth ||
      !this.videoElem.videoHeight
    )
      return false; //Not ready

    const unscaledWidth = Math.round(
      this.videoOffset.width / (this.videoScale / 100)
    );
    const unscaledHeight = Math.round(
      this.videoOffset.height / (this.videoScale / 100)
    );
    const unscaledLeft = Math.round(
      this.videoOffset.left +
        window.scrollX -
        (unscaledWidth - this.videoOffset.width) / 2
    );
    const unscaledTop = Math.round(
      this.videoOffset.top - (unscaledHeight - this.videoOffset.height) / 2
    );

    this.projectorsElem.style.left = `${unscaledLeft}px`;
    this.projectorsElem.style.top = `${unscaledTop - 1}px`;
    this.projectorsElem.style.width = `${unscaledWidth}px`;
    this.projectorsElem.style.height = `${unscaledHeight}px`;
    this.projectorsElem.style.transform = `
      scale(${this.videoScale / 100})
      scale(${this.clippedVideoScale[0]}, ${this.clippedVideoScale[1]})
      ${this.isMirrored ? 'scaleX(-1)' : ''}
    `;
    if (this.settings.webGL) this.projector.cropped = false;

    if (
      this.settings.videoShadowOpacity != 0 &&
      this.settings.videoShadowSize != 0
    ) {
      this.videoShadowElem.style.display = 'block';
      this.videoShadowElem.style.left = `${unscaledLeft}px`;
      this.videoShadowElem.style.top = `${unscaledTop}px`;
      this.videoShadowElem.style.width = `${
        unscaledWidth * this.clippedVideoScale[0]
      }px`;
      this.videoShadowElem.style.height = `${
        unscaledHeight * this.clippedVideoScale[1]
      }px`;
      this.videoShadowElem.style.transform = `
        translate3d(0,0,0)
        translate(${unscaledWidth * this.barsClip[0]}px, ${
        unscaledHeight * this.barsClip[1]
      }px)
        scale(${this.videoScale / 100})
      `;
      this.videoShadowElem.style.borderRadius = '';
    } else {
      this.videoShadowElem.style.display = '';
    }

    const contrast =
      this.settings.contrast +
      (this.isHdr ? this.settings.hdrContrast - 100 : 0);
    const brightness =
      this.settings.brightness +
      (this.isHdr ? this.settings.hdrBrightness - 100 : 0);
    const saturation =
      this.settings.saturation +
      (this.isHdr ? this.settings.hdrSaturation - 100 : 0);
    this.filterElem.style.filter = `
      ${
        !this.settings.webGL && blur != 0
          ? `blur(${Math.round(
              this.videoOffset.height * 0.0025 * this.settings.blur2
            )}px)`
          : ''
      }
      ${contrast != 100 ? `contrast(${contrast}%)` : ''}
      ${brightness != 100 ? `brightness(${brightness}%)` : ''}
      ${saturation != 100 ? `saturate(${saturation}%)` : ''}
    `.trim();

    this.srcVideoOffset = {
      top: this.videoOffset.top,
      width: this.videoElem.videoWidth,
      height: this.videoElem.videoHeight,
    };

    let pScale;
    if (this.settings.webGL) {
      const relativeBlur =
        (this.settings.resolution / 100) *
        (this.isHdr ? 0 : this.settings.blur2);
      let pMinSize =
        (this.settings.resolution / 100) *
        (this.isHdr ? 2 : 1) *
        (this.settings.detectHorizontalBarSizeEnabled ||
        this.settings.detectVerticalBarSizeEnabled
          ? 256
          : relativeBlur >= 20
          ? 128
          : relativeBlur >= 10
          ? 192
          : 256);
      if (this.settings.spread > 200) pMinSize = pMinSize / 2;

      pScale = Math.min(
        0.5,
        Math.max(
          pMinSize / this.srcVideoOffset.width,
          pMinSize / this.srcVideoOffset.height
        ),
        Math.min(
          1024 / this.srcVideoOffset.width,
          1024 / this.srcVideoOffset.height
        )
      );
    } else {
      // A size of 512 videoWidth/videoHeight is required to prevent pixel flickering because CanvasContext2D uses no mipmaps
      // A CanvasContext2D size of > 256 is required to enable GPU acceleration in Chrome
      const pMinSize = Math.max(
        257,
        Math.min(512, this.srcVideoOffset.width, this.srcVideoOffset.height)
      );
      pScale = Math.max(
        pMinSize / this.srcVideoOffset.width,
        pMinSize / this.srcVideoOffset.height
      );
    }
    const p = {
      w: Math.ceil(this.srcVideoOffset.width * pScale),
      h: Math.ceil(this.srcVideoOffset.height * pScale),
    };
    if (this.p?.w !== p.w || this.p?.h !== p.h) {
      // console.log(`projector: ${this.srcVideoOffset.height} * ${pScale} = ${p.h}`)
      this.p = p;
    }
    this.projector.resize(this.p.w, this.p.h);

    if (this.projector.webGLVersion === 1) {
      const pbSize = Math.min(
        512,
        Math.max(this.srcVideoOffset.width, this.srcVideoOffset.height)
      );
      const pbSizePowerOf2 = Math.pow(
        2,
        1 + Math.ceil(Math.log(pbSize / 2) / Math.log(2))
      ); // projectorBuffer size must always be a power of 2 for WebGL1 mipmap generation in projector
      this.projectorBuffer.elem.width = pbSizePowerOf2;
      this.projectorBuffer.elem.height = pbSizePowerOf2;
    } else if (this.projector.webGLVersion === 2) {
      const projectorBufferWidth = this.p.w * 2;
      const projectorBufferHeight = this.p.h * 2;
      if (
        this.projectorBuffer.elem.width !== projectorBufferWidth ||
        this.projectorBuffer.elem.height !== projectorBufferHeight
      ) {
        // console.log(`projectorBuffer: ${this.p.h} * 2 = ${projectorBufferHeight}`)
        this.projectorBuffer.elem.width = projectorBufferWidth;
        this.projectorBuffer.elem.height = projectorBufferHeight;
      }
    } else {
      this.projectorBuffer.elem.width = this.p.w;
      this.projectorBuffer.elem.height = this.p.h;
    }

    const frameBlending = this.settings.frameBlending;
    if (frameBlending) {
      if (!this.previousProjectorBuffer || !this.blendedProjectorBuffer) {
        this.initFrameBlending();
      }
      this.previousProjectorBuffer.elem.width = this.projectorBuffer.elem.width;
      this.previousProjectorBuffer.elem.height =
        this.projectorBuffer.elem.height;
      this.blendedProjectorBuffer.elem.width = this.projectorBuffer.elem.width;
      this.blendedProjectorBuffer.elem.height =
        this.projectorBuffer.elem.height;
    }
    const videoOverlayEnabled = this.settings.videoOverlayEnabled;
    const videoOverlay = this.videoOverlay;
    if (videoOverlayEnabled && !videoOverlay) {
      this.initVideoOverlay();
    }
    if (
      videoOverlayEnabled &&
      frameBlending &&
      !this.previousVideoOverlayBuffer
    ) {
      this.initVideoOverlayWithFrameBlending();
    }
    if (videoOverlayEnabled) this.checkIfNeedToHideVideoOverlay();

    if (
      videoOverlayEnabled &&
      videoOverlay &&
      videoOverlay.elem.previousElementSibling !== this.videoElem
    ) {
      this.videoElem.after(videoOverlay.elem);
    } else if (
      !videoOverlayEnabled &&
      videoOverlay &&
      videoOverlay.elem.parentNode
    ) {
      videoOverlay.elem.parentNode.removeChild(videoOverlay.elem);
    }

    const videoElemStyle = this.videoElem.getAttribute('style') || '';
    if (this.videoDebandingElem) {
      if (this.videoDebandingElem.getAttribute('style') !== videoElemStyle) {
        this.videoDebandingElem.setAttribute('style', videoElemStyle);
      }
      if (!this.videoDebandingElem.isConnected) {
        this.videoContainerElem.appendChild(this.videoDebandingElem);
      }
    }

    if (videoOverlayEnabled && videoOverlay) {
      if (videoOverlay.elem.getAttribute('style') !== videoElemStyle) {
        videoOverlay.elem.setAttribute('style', videoElemStyle);
      }
      // The overlay is stretched over the video element with the same object-fit as the video.
      // So the resolution only has to match the displayed size of the video frame
      const content = this.getVideoContentRect();
      const videoOverlayWidth =
        Math.min(
          this.srcVideoOffset.width,
          Math.round(content.width * window.devicePixelRatio)
        ) || this.srcVideoOffset.width;
      const videoOverlayHeight =
        Math.min(
          this.srcVideoOffset.height,
          Math.round(content.height * window.devicePixelRatio)
        ) || this.srcVideoOffset.height;
      if (
        this.videoOverlay.elem.width !== videoOverlayWidth ||
        this.videoOverlay.elem.height !== videoOverlayHeight
      ) {
        this.videoOverlay.elem.width = videoOverlayWidth;
        this.videoOverlay.elem.height = videoOverlayHeight;
      }

      if (frameBlending) {
        this.videoOverlayBuffer.elem.width = videoOverlayWidth;
        this.videoOverlayBuffer.elem.height = videoOverlayHeight;

        this.previousVideoOverlayBuffer.elem.width = videoOverlayWidth;
        this.previousVideoOverlayBuffer.elem.height = videoOverlayHeight;
      }
    }

    this.resizeCanvasses();
    this.stats.initElems();

    this.sizesChanged = false;
    this.buffersCleared = true;
    return true;
  }

  resetVideoParentElemStyle() {
    this.shouldStyleVideoParentElem = false;
    if (!this.videoContainerElem) return;

    setStyleProperty(this.videoContainerElem, '--ytal-video-clip-path', '');
    setStyleProperty(this.videoContainerElem, '--ytal-video-scale', '');
  }

  updateFixedStyle() {
    document.body.toggleAttribute(
      'data-ambientlight-fixed',
      this.settings.fixedPosition
    );
  }

  updateStyles() {
    this.updateFixedStyle();

    // Immersive
    const html = document.documentElement;
    html.toggleAttribute(
      'data-ambientlight-immersive-header',
      !!this.settings.immersiveHeader
    );
    html.toggleAttribute(
      'data-ambientlight-transparent-side-panels',
      !!this.settings.transparentSidePanels
    );
    html.toggleAttribute(
      'data-ambientlight-transparent-sending-bar',
      !!this.settings.transparentSendingBar
    );
    html.toggleAttribute(
      'data-ambientlight-transparent-page-content',
      !!this.settings.transparentPageContent
    );

    // Page background
    let pageBackgroundGreyness = this.settings.pageBackgroundGreyness;
    pageBackgroundGreyness = pageBackgroundGreyness
      ? `${pageBackgroundGreyness}%`
      : '';
    setStyleProperty(
      document.documentElement,
      '--ytal-page-background-greyness',
      pageBackgroundGreyness
    );

    // Fill transparency
    let fillOpacity = this.settings.surroundingContentFillOpacity;
    fillOpacity = fillOpacity !== 10 ? (fillOpacity + 100) / 200 : '';
    setStyleProperty(document.documentElement, '--ytal-fill-opacity', fillOpacity);

    if (this.mastheadElem) {
      // Header transparency
      let headerFillOpacity = this.settings.headerFillOpacity;
      headerFillOpacity =
        headerFillOpacity !== 100 ? (headerFillOpacity + 100) / 200 : '';
      setStyleProperty(
        this.mastheadElem,
        '--ytal-fill-opacity',
        headerFillOpacity
      );
      this.mastheadElem.classList.toggle(
        'ytal-header-transparent',
        headerFillOpacity !== ''
      );
    }

    // Images transparency
    let imageOpacity = this.settings.surroundingContentImagesOpacity;
    imageOpacity = imageOpacity !== 100 ? imageOpacity / 100 : '';
    setStyleProperty(document.documentElement, '--ytal-image-opacity', imageOpacity);

    if (this.mastheadElem) {
      // Header transparency
      let headerImageOpacity = this.settings.headerImagesOpacity;
      headerImageOpacity = imageOpacity !== 100 ? headerImageOpacity / 100 : '';
      setStyleProperty(
        this.mastheadElem,
        '--ytal-image-opacity',
        headerImageOpacity
      );
    }

    // Shadows
    const textAndBtnOnly = this.settings.surroundingContentTextAndBtnOnly;
    const getFilterShadow = (color, size, opacity) =>
      size && opacity
        ? opacity > 0.5
          ? `
          drop-shadow(0 0 ${size}px rgba(${color},${opacity})) 
          drop-shadow(0 0 ${size}px rgba(${color},${opacity}))
        `
          : `drop-shadow(0 0 ${size}px rgba(${color},${opacity * 2}))`
        : '';
    const getTextShadow = (color, size, opacity) =>
      size && opacity
        ? `
        rgba(${color},${opacity}) 0 0 ${size * 2}px,
        rgba(${color},${opacity}) 0 0 ${size * 2}px
      `
        : '';

    if (this.mastheadElem) {
      // Header shadow
      const headerShadowSize = this.settings.headerShadowSize / 5;
      const headerShadowOpacity = this.settings.headerShadowOpacity / 100;
      this.mastheadElem.classList.toggle(
        'ytal-header-shadow',
        headerShadowSize && headerShadowOpacity
      );

      const getHeaderFilterShadow = (color) =>
        getFilterShadow(color, headerShadowSize, headerShadowOpacity);
      const getHeaderTextShadow = (color) =>
        getTextShadow(color, headerShadowSize, headerShadowOpacity);

      // Header !textAndBtnOnly
      setStyleProperty(
        this.mastheadElem,
        `--ytal-filter-shadow`,
        !textAndBtnOnly ? getHeaderFilterShadow('0,0,0') : ''
      );
      setStyleProperty(
        this.mastheadElem,
        `--ytal-filter-shadow-inverted`,
        !textAndBtnOnly ? getHeaderFilterShadow('255,255,255') : ''
      );

      // Header textAndBtnOnly
      setStyleProperty(
        this.mastheadElem,
        `--ytal-button-shadow`,
        textAndBtnOnly ? getHeaderFilterShadow('0,0,0') : ''
      );
      setStyleProperty(
        this.mastheadElem,
        `--ytal-button-shadow-inverted`,
        textAndBtnOnly ? getHeaderFilterShadow('255,255,255') : ''
      );

      setStyleProperty(
        this.mastheadElem,
        '--ytal-text-shadow',
        textAndBtnOnly ? getHeaderTextShadow('0,0,0') : ''
      );
      setStyleProperty(
        this.mastheadElem,
        '--ytal-text-shadow-inverted',
        textAndBtnOnly ? getHeaderTextShadow('255,255,255') : ''
      );
      this.mastheadElem.toggleAttribute(
        'data-ambientlight-text-shadow',
        textAndBtnOnly
      );
    }

    // Content shadow
    const contentShadowSize = this.settings.surroundingContentShadowSize / 5;
    const contentShadowOpacity =
      this.settings.surroundingContentShadowOpacity / 100;
    const getContentFilterShadow = (color) =>
      getFilterShadow(color, contentShadowSize, contentShadowOpacity);
    const getContentTextShadow = (color) =>
      getTextShadow(color, contentShadowSize, contentShadowOpacity);

    // Content !textAndBtnOnly
    setStyleProperty(
      document.documentElement,
      `--ytal-filter-shadow`,
      !textAndBtnOnly ? getContentFilterShadow('0,0,0') : ''
    );
    setStyleProperty(
      document.documentElement,
      `--ytal-filter-shadow-inverted`,
      !textAndBtnOnly ? getContentFilterShadow('255,255,255') : ''
    );

    // Content textAndBtnOnly
    setStyleProperty(
      document.documentElement,
      `--ytal-button-shadow`,
      textAndBtnOnly ? getContentFilterShadow('0,0,0') : ''
    );
    setStyleProperty(
      document.documentElement,
      `--ytal-button-shadow-inverted`,
      textAndBtnOnly ? getContentFilterShadow('255,255,255') : ''
    );

    setStyleProperty(
      document.documentElement,
      '--ytal-text-shadow',
      textAndBtnOnly ? getContentTextShadow('0,0,0') : ''
    );
    setStyleProperty(
      document.documentElement,
      '--ytal-text-shadow-inverted',
      textAndBtnOnly ? getContentTextShadow('255,255,255') : ''
    );
    document.body.toggleAttribute(
      'data-ambientlight-text-shadow',
      textAndBtnOnly
    );

    // Video shadow
    const videoShadowSize =
      parseFloat(this.settings.videoShadowSize, 10) / 2 +
      Math.pow(this.settings.videoShadowSize / 5, 1.77); // Chrome limit: 250px | Firefox limit: 100px
    const videoShadowOpacity = this.settings.videoShadowOpacity / 100;

    setStyleProperty(
      document.documentElement,
      '--ytal-video-shadow-background',
      videoShadowSize && videoShadowOpacity
        ? `rgba(0,0,0,${videoShadowOpacity})`
        : ''
    );
    setStyleProperty(
      document.documentElement,
      '--ytal-video-shadow-box-shadow',
      videoShadowSize && videoShadowOpacity
        ? `
          rgba(0,0,0,${videoShadowOpacity}) 0 0 ${videoShadowSize}px,
          rgba(0,0,0,${videoShadowOpacity}) 0 0 ${videoShadowSize}px
        `
        : ''
    );

    // Video Debanding
    const videoDebandingStrength = parseFloat(
      this.settings.videoDebandingStrength
    );
    if (videoDebandingStrength) {
      if (!this.videoDebandingElem) {
        this.videoDebandingElem = document.createElement('div');
        this.videoDebandingElem.classList.add('ambientlight__video-debanding');
      }
      this.videoDebandingElem.setAttribute(
        'style',
        this.videoElem.getAttribute('style') || ''
      );
      if (!this.videoDebandingElem.isConnected) {
        this.videoContainerElem.appendChild(this.videoDebandingElem);
      }
    } else if (this.videoDebandingElem) {
      this.videoDebandingElem.remove();
      this.videoDebandingElem = undefined;
    }

    const videoNoiseImageIndex =
      videoDebandingStrength > 75 ? 3 : videoDebandingStrength > 50 ? 2 : 1;
    const videoNoiseOpacity =
      videoDebandingStrength /
      (videoDebandingStrength > 75
        ? 100
        : videoDebandingStrength > 50
        ? 75
        : 50);

    setStyleProperty(
      document.documentElement,
      '--ytal-video-debanding-background',
      videoDebandingStrength
        ? `url('${getNoiseImageUrl(videoNoiseImageIndex)}')`
        : ''
    );
    setStyleProperty(
      document.documentElement,
      '--ytal-video-debanding-opacity',
      videoDebandingStrength ? videoNoiseOpacity : ''
    );

    // Debanding
    const debandingStrength = parseFloat(this.settings.debandingStrength);
    const noiseImageIndex =
      debandingStrength > 75 ? 3 : debandingStrength > 50 ? 2 : 1;
    const noiseOpacity =
      debandingStrength /
      (debandingStrength > 75 ? 100 : debandingStrength > 50 ? 75 : 50);

    setStyleProperty(
      document.documentElement,
      '--ytal-debanding-content',
      debandingStrength ? `''` : ''
    );
    setStyleProperty(
      document.documentElement,
      '--ytal-debanding-background',
      debandingStrength
        ? `url('${getNoiseImageUrl(noiseImageIndex)}')`
        : ''
    );
    setStyleProperty(
      document.documentElement,
      '--ytal-debanding-opacity',
      debandingStrength ? noiseOpacity : ''
    );
    setStyleProperty(
      document.documentElement,
      '--ytal-debanding-blend-mode',
      {
        [DEBANDING_BLEND_MODE_LCD]: '',
        [DEBANDING_BLEND_MODE_OLED]: 'overlay',
      }[this.settings.debandingBlendMode]
    );
  }

  resizeCanvasses() {
    if (this.canvassesInvalidated) {
      this.recreateProjectors();
      this.canvassesInvalidated = false;
    }

    const projectorSize = {
      w: Math.round(this.p.w * this.clippedVideoScale[0]),
      h: Math.round(this.p.h * this.clippedVideoScale[1]),
    };
    const ratio =
      this.p.w > this.p.h
        ? {
            x: this.p.w / projectorSize.w,
            y:
              (this.p.w / projectorSize.w) *
              (projectorSize.w / projectorSize.h),
          }
        : {
            x:
              (this.p.h / projectorSize.h) *
              (projectorSize.h / projectorSize.w),
            y: this.p.h / projectorSize.h,
          };
    const lastScale = {
      x: 1,
      y: 1,
    };

    //To prevent 0x0 sized canvas elements causing a GPU memory leak
    const minScale = {
      x: 1 / projectorSize.w,
      y: 1 / projectorSize.h,
    };

    const scaleStep = this.settings.edge / 100;
    const scales = [];
    for (let i = 0; i < this.levels; i++) {
      const pos = i - this.innerStrength;
      let scaleX = 1;
      let scaleY = 1;

      if (pos > 0) {
        scaleX = 1 + scaleStep * ratio.x * pos;
        scaleY = 1 + scaleStep * ratio.y * pos;
      }

      if (pos < 0) {
        scaleX = 1 - scaleStep * ratio.x * -pos;
        scaleY = 1 - scaleStep * ratio.y * -pos;
        if (scaleX < 0) scaleX = 0;
        if (scaleY < 0) scaleY = 0;
      }
      lastScale.x = scaleX;
      lastScale.y = scaleY;

      scales.push({
        x: Math.max(minScale.x, scaleX),
        y: Math.max(minScale.y, scaleY),
      });
    }

    this.projector.rescale(
      scales,
      lastScale,
      projectorSize,
      this.barsClip,
      this.settings
    );
  }

  updatedSizesChanged = false;
  updateSizesChanged(checkPosition) {
    if (this.updatedSizesChanged) {
      return;
    }

    this.sizesChanged =
      this.sizesChanged || this.getSizesChanged(checkPosition);
    this.lastUpdateSizesChanged = performance.now();
    this.sizesInvalidated = false;

    this.updatedSizesChanged = true;
    raf(() => {
      this.updatedSizesChanged = false;
    });
  }

  getSizesChanged(checkPosition = true) {
    //Resized
    if (this.previousEnabled !== this.settings.enabled) {
      this.previousEnabled = this.settings.enabled;
      return true;
    }

    //Auto quality moved up or down
    if (
      this.srcVideoOffset.width !== this.videoElem.videoWidth ||
      this.srcVideoOffset.height !== this.videoElem.videoHeight
    ) {
      return true;
    }

    if (
      this.settings.videoOverlayEnabled &&
      this.videoOverlay &&
      this.videoElem.getAttribute('style') !==
        this.videoOverlay.elem.getAttribute('style')
    ) {
      return true;
    }

    if (
      this.videoContainerElem &&
      !this.videoContainerElem.contains(this.videoElem)
    ) {
      return true;
    }

    if (checkPosition) {
      const projectorsElemRect = this.getElemRect(this.projectorsElem);
      const videoElemRect = this.getVideoRect();
      const topExtraOffset = this.settings.horizontalBarsClipPercentage
        ? videoElemRect.height *
          (this.settings.horizontalBarsClipPercentage / 100)
        : 0;
      const leftExtraOffset = this.settings.verticalBarsClipPercentage
        ? videoElemRect.width * (this.settings.verticalBarsClipPercentage / 100)
        : 0;
      const expectedProjectorsRect = {
        width: videoElemRect.width - leftExtraOffset * 2,
        height: videoElemRect.height - topExtraOffset * 2,
        top: videoElemRect.top + topExtraOffset,
        left: videoElemRect.left + leftExtraOffset,
      };
      if (
        Math.abs(projectorsElemRect.height - expectedProjectorsRect.height) >
          1 ||
        Math.abs(projectorsElemRect.width - expectedProjectorsRect.width) > 1 ||
        Math.abs(projectorsElemRect.top - expectedProjectorsRect.top) > 2 ||
        Math.abs(projectorsElemRect.left - expectedProjectorsRect.left) > 2
      ) {
        return true;
      }
    }

    return false;
  }

  getElemRect(elem) {
    const scrollableRect = (
      this.clearfixElem.offsetParent ||
      (this.isFullscreen
        ? document.fullscreenElement || document.body
        : document.body)
    ).getBoundingClientRect();
    const elemRect = elem.getBoundingClientRect();

    return {
      top: elemRect.top - scrollableRect.top,
      left: elemRect.left - scrollableRect.left,
      width: elemRect.width,
      height: elemRect.height,
    };
  }

  scheduleNextFrame() {
    if (this.scheduledNextFrame || !this.canScheduleNextFrame()) return;

    this.scheduleRequestVideoFrame();
    if (
      this.settings.frameSync == FRAMESYNC_VIDEOFRAMES &&
      this.requestVideoFrameCallbackId &&
      !this.videoIsHidden &&
      !this.settings.frameBlending &&
      !this.settings.frameFading &&
      !this.settings.showFrametimes
    )
      return;

    this.scheduledNextFrame = true;
    if (!this.videoIsHidden) {
      requestAnimationFrame(this.onNextFrameWrapped);
    } else {
      const realFramerateLimit = this.getRealFramerateLimit();
      const frameRate = Math.min(
        Math.max(this.videoFrameRate || 30),
        realFramerateLimit
      );
      setTimeout(this.scheduleNextFrameDelayed, frameRate);
    }
  }

  onNextFrame = async function onNextFrame(compose) {
    if (!this.scheduledNextFrame) return;

    this.scheduledNextFrame = false;
    if (this.videoElem.ended) return;

    this.displayFrameTime = compose;
    this.displayFrameCount++;

    if (
      this.settings.showFrametimes &&
      this.settings.frameSync !== FRAMESYNC_VIDEOFRAMES
    ) {
      const presentedFrames = this.getVideoFrameCount();
      if (
        this.settings.frameSync === FRAMESYNC_DISPLAYFRAMES ||
        this.settings.frameBlending ||
        this.previousPresentedFrames !== presentedFrames
      ) {
        this.stats.receiveAnimationFrametimes(compose, presentedFrames);
      }
      this.previousPresentedFrames = presentedFrames;
    }

    if (this.settings.framerateLimit || this.limitFramerateToSaveEnergy()) {
      await this.onNextLimitedFrame(compose);
    } else {
      await this.nextFrame(compose);
      this.nextFrameTime = undefined;
    }
  }.bind(this);
  onNextFrameWrapped = wrapErrorHandler(this.onNextFrame);
  scheduleNextFrameDelayed = () =>
    requestAnimationFrame(this.onNextFrameWrapped);

  onNextLimitedFrame = async (compose) => {
    const time = performance.now();
    if (
      this.nextFrameTime &&
      !this.buffersCleared &&
      !this.sizesChanged &&
      !this.sizesInvalidated
    ) {
      if (
        this.settings.frameSync === FRAMESYNC_VIDEOFRAMES &&
        !this.videoIsHidden
      ) {
        if (this.nextFrameTime > time && this.videoFrameCallbackReceived) {
          this.videoFrameCallbackReceived = false;
        }
        if (!this.videoFrameCallbackReceived) {
          this.scheduleNextFrame();
          return;
        }
      } else if (this.nextFrameTime > time) {
        this.scheduleNextFrame();
        return;
      }
    }

    const ambientlightFrameCount = this.ambientlightFrameCount;
    await this.nextFrame(compose);
    if (this.ambientlightFrameCount <= ambientlightFrameCount) {
      return;
    }

    const realFramerateLimit = this.getRealFramerateLimit();
    this.nextFrameTime = Math.max(
      (this.nextFrameTime || time) + 1000 / realFramerateLimit,
      time
    );
  };

  averageVideoFramesDifference5SecondsThreshold = 0.002;
  averageVideoFramesDifference1SecondThreshold = 0.0175;

  getRealFramerateLimit = () => {
    if (this.limitFramerateToSaveEnergy()) {
      if (
        this.averageVideoFramesDifference <
        this.averageVideoFramesDifference5SecondsThreshold
      )
        return 0.2; // 5 seconds
      if (
        this.averageVideoFramesDifference <
        this.averageVideoFramesDifference1SecondThreshold
      )
        return 1; // 1 seconds
    }

    const frameFading = this.settings.frameFading
      ? Math.round(Math.pow(this.settings.frameFading, 2))
      : 0;
    const frameFadingMax =
      15 * Math.pow(ProjectorWebGL.subProjectorDimensionMax, 2) - 1;
    const realFramerateLimit =
      this.settings.webGL && frameFading > frameFadingMax
        ? Math.max(
            1,
            (frameFadingMax / (frameFading || 1)) * this.settings.framerateLimit
          )
        : this.settings.framerateLimit;
    return realFramerateLimit;
  };

  limitFramerateToSaveEnergy = () =>
    this.averageVideoFramesDifference <
      this.averageVideoFramesDifference1SecondThreshold &&
    !this.sizesInvalidated &&
    !this.buffersCleared &&
    this.videoElem.currentTime > 5 &&
    this.videoElem.currentTime < this.videoElem.duration - 5;

  canScheduleNextFrame = () =>
    !(
      !this.settings.enabled ||
      !this.isOnVideoPage ||
      this.pendingStart ||
      this.videoElem.ended ||
      this.videoElem.paused ||
      this.videoElem.seeking ||
      this.isVideoHiddenOnWatchPage ||
      this.isAmbientlightHiddenOnWatchPage
    );

  optionalFrame = async () => {
    if (
      !this.initializedTime ||
      !this.settings.enabled ||
      !this.isOnVideoPage ||
      this.pendingStart ||
      this.resizeAfterFrames > 0 ||
      this.videoElem.ended ||
      (!this.videoElem.paused &&
        !this.videoElem.seeking &&
        this.scheduledNextFrame)
    )
      return;

    await this.nextFrame();
  };

  nextFrame = async (compose) => {
    try {
      const frameTimes = this.settings.showFrametimes
        ? {
            frameStart: performance.now(),
          }
        : {};

      this.delayedUpdateSizesChanged = false;
      if (this.p && this.sizesInvalidated) {
        this.updateSizesChanged();
      }
      if (!this.p || this.sizesChanged) {
        //If was detected hidden by updateSizes, this.p won't be initialized yet
        if (!(await this.updateSizes())) return;
      } else {
        this.delayedUpdateSizesChanged = true;
      }

      let results = {};
      if (this.settings.showFrametimes) {
        this.stats.addVideoFrametimes(frameTimes, compose);
        frameTimes.drawStart = performance.now();
      }

      if (!this.settings.webGL || this.getImageDataAllowed) {
        results = (await this.drawAmbientlight(compose)) || {};
      }

      if (this.settings.showFrametimes) frameTimes.drawEnd = performance.now();

      this.scheduleNextFrame();

      if (results?.detectBarSize) {
        await this.scheduleBarSizeDetection();
      }

      if (
        this.settings.frameSync === FRAMESYNC_DISPLAYFRAMES ||
        results?.hasNewFrame ||
        this.settings.frameBlending
      ) {
        this.stats.addAmbientFrametimes(frameTimes);
      }

      if (
        this.afterNextFrameIdleCallback ||
        (!this.settings.videoOverlayEnabled &&
          !(
            this.delayedUpdateSizesChanged &&
            performance.now() - this.lastUpdateSizesChanged > 2000
          ) &&
          !(
            performance.now() - this.lastUpdateStatsTime >
            this.updateStatsInterval
          ))
      )
        return;

      this.afterNextFrameIdleCallback = requestIdleCallback(
        this.afterNextFrame,
        { timeout: 1000 / 30 }
      );
    } catch (ex) {
      this.setDrawWarning(ex);
      if (this.catchedErrors[ex.name]) {
        console.error(ex);
        return;
      }

      this.catchedErrors[ex.name] = true;
      if (
        [
          'SecurityError',
          'NS_ERROR_NOT_AVAILABLE',
          'NS_ERROR_OUT_OF_MEMORY',
        ].includes(ex.name)
      ) {
        console.warn('Failed to display the ambient light');
        console.error(ex);
        return;
      }

      throw ex;
    }
  };

  setDrawWarning = (ex) => {
    const message =
      ex.name === 'SecurityError'
        ? '重新整理可能有幫助，但最可能的原因是瀏覽器不允許環境光讀取這部 Bilibili 影片的像素。其他 Bilibili 影片應該不會有這個問題。'
        : `重新整理頁面可能有幫助。如果沒有，可能是這部 Bilibili 影片本身有問題，也可以搜尋下方的錯誤訊息。\n\n錯誤：${ex.name}\n原因：${ex.message}`;

    this.settings.setWarning(
      `無法顯示環境光\n\n${message}`
    );
  };

  afterNextFrame = async function afterNextFrame() {
    try {
      this.afterNextFrameIdleCallback = undefined;

      if (this.settings.videoOverlayEnabled) {
        this.detectFrameRates();
        this.checkIfNeedToHideVideoOverlay();
      }

      if (
        this.delayedUpdateSizesChanged &&
        performance.now() - this.lastUpdateSizesChanged > 2000
      ) {
        this.updateSizesChanged(true);
        if (this.sizesChanged) {
          await this.optionalFrame();
        }
      }
      if (
        performance.now() - this.lastUpdateStatsTime >
        this.updateStatsInterval
      ) {
        this.lastUpdateStatsTime = performance.now();
        requestIdleCallback(
          function afterNextFrameUpdateStats() {
            if (!this.settings.videoOverlayEnabled) {
              this.detectFrameRates();
            }
            this.stats.update();
          }.bind(this),
          { timeout: 100 }
        );
      }
    } catch (ex) {
      // Prevent recursive error reporting
      if (this.scheduledNextFrame) {
        cancelAnimationFrame(this.scheduledNextFrame);
        this.scheduledNextFrame = undefined;
      }

      throw ex;
    }
  }.bind(this);

  // Todo:
  // - Fix frame drops on 60hz monitors with a 50hz video playing?:
  //     Was caused by faulty NVidia 3050TI driver
  //     and chromium video callback being sometimes 1 frame delayed
  //     and requestVideoFrameCallback being executed at the end of the draw flow
  // - Do more complex logic at a later time
  detectFrameRate(list, count, currentFrameRate, currentFrameTime, update) {
    const time = currentFrameTime || performance.now();

    // Add new item
    let fps = 0;
    if (list.length) {
      if (count < list[0].count) {
        // Clear list with invalid values
        list.splice(0, list.length);
      } else {
        const previous = list[0];
        fps = Math.max(
          0,
          (count - previous.count) / ((time - previous.time) / 1000)
        );
      }
    }
    list.push({
      count,
      time,
      fps,
    });

    if (!update) return currentFrameRate;
    if (list.length < 2) return 0;

    // Remove old items
    const thresholdTime = time - this.frameCountHistory;
    const thresholdIndex = list.findIndex((i) => i.time >= thresholdTime);
    if (thresholdIndex > 0) list.splice(0, thresholdIndex - 1);

    // Calculate fps
    const aligableList = list.filter((i) => i.fps);
    if (!aligableList.length) return 0;

    aligableList.sort((a, b) => a.fps - b.fps);
    if (aligableList.length > 10) {
      const bound = Math.floor(aligableList.length / 16);
      aligableList.splice(0, bound);
      aligableList.splice(aligableList.length - bound, bound);
    }

    const difference = Math.min(
      5,
      aligableList[aligableList.length - 1].fps - aligableList[0].fps
    );
    const deleteCount = Math.min(
      aligableList.length - 2,
      Math.max(0, Math.floor(aligableList.length * (difference / 5) - 2))
    );
    if (deleteCount) {
      aligableList.sort((a, b) => a.time - b.time);
      aligableList.splice(0, deleteCount);
    }

    const average =
      aligableList.reduce((sum, i) => sum + i.fps, 0) / aligableList.length;

    return average;
  }

  detectFrameRates() {
    const update =
      performance.now() > (this.previousUpdate || 0) + this.updateStatsInterval;
    if (update) this.previousUpdate = performance.now();
    this.detectDisplayFrameRate(update);
    this.detectAmbientlightFrameRate(update);
    this.detectVideoFrameRate(update);

    if (this.chromiumBugVideoJitterWorkaround?.update)
      this.chromiumBugVideoJitterWorkaround.update();
  }

  videoFrameCounts = [];
  detectVideoFrameRate(update) {
    this.videoFrameRate = this.detectFrameRate(
      this.videoFrameCounts,
      this.getVideoFrameCount(),
      this.videoFrameRate,
      this.videoFrameTime,
      update
    );
    this.videoFrameTime = undefined;
  }

  displayFrameCounts = [];
  displayFrameCount = 0;
  detectDisplayFrameRate = (update) => {
    this.displayFrameRate = this.detectFrameRate(
      this.displayFrameCounts,
      this.displayFrameCount,
      this.displayFrameRate,
      this.displayFrameTime,
      update
    );
    this.displayFrameTime = undefined;
  };

  ambientlightFrameCounts = [];
  detectAmbientlightFrameRate(update) {
    this.ambientlightFrameRate = this.detectFrameRate(
      this.ambientlightFrameCounts,
      this.ambientlightFrameCount,
      this.ambientlightFrameRate,
      this.ambientlightFrameTime,
      update
    );
    this.ambientlightFrameTime = undefined;
  }

  getVideoDroppedFrameCount() {
    if (!this.videoElem) return 0;

    return this.videoElem.getVideoPlaybackQuality()?.droppedVideoFrames || 0;
  }

  getVideoFrameCount() {
    if (!this.videoElem) return 0;

    const videoPresentedFrames =
      this.settings.frameSync === FRAMESYNC_VIDEOFRAMES &&
      this.videoPresentedFrames
        ? this.videoPresentedFrames
        : 0;

    const totalVideoFrames =
      this.videoElem.getVideoPlaybackQuality()?.totalVideoFrames || 0;
    return Math.max(videoPresentedFrames, totalVideoFrames);
  }

  shouldShow = () =>
    this.settings.enabled && this.isOnVideoPage && this.isInEnabledView();

  async drawAmbientlight(compose) {
    const shouldShow = this.shouldShow();
    if (!shouldShow) {
      if (!this.isHidden) await this.hide();
      return;
    }

    const drawTime = performance.now();
    if (this.isHidden) this.show();

    if (
      (this.atTop &&
        this.isFillingFullscreen &&
        !this.settings.detectHorizontalBarSizeEnabled &&
        !this.settings.detectVerticalBarSizeEnabled &&
        !this.settings.frameBlending &&
        !this.settings.videoOverlayEnabled) ||
      this.isVideoHiddenOnWatchPage ||
      // this.isAmbientlightHiddenOnWatchPage || // Disabled because: When in fullscreen isFillingFullscreen goes to false the observer needs a frame to render the shown ambientlight element. So instead handle this in the canScheduleNextFrame check
      this.videoElem.ended ||
      this.videoElem.readyState === 0 || // HAVE_NOTHING
      this.videoElem.readyState === 1 // HAVE_METADATA
      // The video contains metadata about the resolution so videoWidth and videoHeight are set.
      // But the video could have no framedata yet. On Firefox this can result in a failed draw call
      // to WebGL into a texture with a 0x0 resolution.
      // And then the next videoframes will also fail because they are drawn into a 0x0 texture.
      // This can result in any of the following WebGL warnings:
      // - [.WebGL-0000772807FD7100] GL_INVALID_OPERATION: Texture format does not support mipmap generation.
      // - tex(Sub)Image[23]D: Resource has no data (yet?). Uploading zeros.
      // - texSubImage: source cannot be null.
      // - generateMipmap: The texture's base level must be complete.
      // - drawArraysInstanced: TEXTURE_2D at unit 1 is incomplete: The dimensions of level_base are not all positive.
    )
      return;

    let newVideoFrameCount = this.getVideoFrameCount();

    let hasNewFrame = false;
    if (this.settings.frameSync == FRAMESYNC_VIDEOFRAMES) {
      if (this.videoIsHidden) {
        hasNewFrame =
          this.previousFrameTime <
          drawTime - 1000 / Math.max(24, this.videoFrameRate); // Force video.webkitDecodedFrameCount to update on Chromium by always executing drawImage
      } else {
        if (
          this.videoFrameCallbackReceived &&
          this.videoFrameCount == newVideoFrameCount
        ) {
          newVideoFrameCount++;
        }
        hasNewFrame = this.videoFrameCallbackReceived;
        this.videoFrameCallbackReceived = false;

        // Fallback for when requestVideoFrameCallback stopped working
        if (!hasNewFrame) {
          hasNewFrame = this.videoFrameCount < newVideoFrameCount;
        }
      }
    } else if (this.settings.frameSync == FRAMESYNC_DECODEDFRAMES) {
      hasNewFrame = this.videoFrameCount < newVideoFrameCount;
    } else if (this.settings.frameSync == FRAMESYNC_DISPLAYFRAMES) {
      hasNewFrame = true;
    }
    hasNewFrame = hasNewFrame || this.buffersCleared;

    const droppedFrames =
      this.videoFrameCount > 120 &&
      this.videoFrameCount < newVideoFrameCount - 1;
    if (droppedFrames && !this.buffersCleared) {
      this.ambientlightVideoDroppedFrameCount +=
        newVideoFrameCount - (this.videoFrameCount + 1);
    }
    if (
      newVideoFrameCount > this.videoFrameCount ||
      newVideoFrameCount < this.videoFrameCount - 60
    ) {
      this.videoFrameCount = newVideoFrameCount;
    }

    const detectBarSize =
      hasNewFrame &&
      (this.settings.detectHorizontalBarSizeEnabled ||
        this.settings.detectVerticalBarSizeEnabled);

    const dontDrawAmbientlight =
      (this.atTop && this.isFillingFullscreen) ||
      (this.settings.spread === 0 && this.settings.blur2 === 0);

    const dontDrawBuffer = dontDrawAmbientlight && !detectBarSize;

    if (this.settings.frameBlending && this.settings.frameBlendingSmoothness) {
      if (!this.previousProjectorBuffer) {
        this.initFrameBlending();
      }
      if (
        this.settings.videoOverlayEnabled &&
        !this.previousVideoOverlayBuffer
      ) {
        this.initVideoOverlayWithFrameBlending();
      }

      // Prevents unnessecary frames from being drawn.
      // But when frameBlending is enabled also draw:
      // - when there is a new frame (hasNewFrame) or...
      // - when the current frame is not yet fully drawn (!previousDrawFullAlpha)
      if (hasNewFrame || this.buffersCleared || !this.previousDrawFullAlpha) {
        if (hasNewFrame || this.buffersCleared) {
          if (this.settings.videoOverlayEnabled) {
            this.previousVideoOverlayBuffer.ctx.drawImage(
              this.videoOverlayBuffer.elem,
              0,
              0
            );
            this.videoOverlayBuffer.ctx.drawImage(
              this.videoElem,
              0,
              0,
              this.videoOverlayBuffer.elem.width,
              this.videoOverlayBuffer.elem.height
            );
            if (this.buffersCleared) {
              this.previousVideoOverlayBuffer.ctx.drawImage(
                this.videoOverlayBuffer.elem,
                0,
                0
              );
            }
          }

          if (!dontDrawBuffer) {
            if (!this.buffersCleared) {
              this.previousProjectorBuffer.ctx.drawImage(
                this.projectorBuffer.elem,
                0,
                0
              );
            }
            // Prevent adjusted barsClipPx from leaking previous frame into the frame
            this.projectorBuffer.ctx.clearRect(
              0,
              0,
              this.projectorBuffer.elem.width,
              this.projectorBuffer.elem.height
            );

            this.projectorBuffer.ctx.drawImage(
              this.videoElem,
              0,
              0,
              this.projectorBuffer.elem.width,
              this.projectorBuffer.elem.height
            );
            if (this.buffersCleared) {
              this.previousProjectorBuffer.ctx.drawImage(
                this.projectorBuffer.elem,
                0,
                0
              );
            }
          }
        }

        let alpha = 1;
        const ambientlightFrameDuration = 1000 / this.ambientlightFrameRate;
        if (hasNewFrame) {
          this.frameBlendingFrameTimeStart =
            drawTime - ambientlightFrameDuration / 2;
        }
        if (this.displayFrameRate >= this.videoFrameRate * 1.33) {
          if (hasNewFrame && !this.previousDrawFullAlpha) {
            alpha = 0; // Show previous frame fully to prevent seams
          } else {
            const videoFrameDuration = 1000 / this.videoFrameRate;
            const frameToDrawDuration =
              drawTime - this.frameBlendingFrameTimeStart;
            const frameToDrawDurationThresshold =
              (frameToDrawDuration + ambientlightFrameDuration / 2) /
              (this.settings.frameBlendingSmoothness / 100);
            if (frameToDrawDurationThresshold < videoFrameDuration) {
              alpha = Math.min(
                1,
                frameToDrawDuration /
                  (1000 /
                    (this.videoFrameRate /
                      (this.settings.frameBlendingSmoothness / 100) || 1))
              );
            }
          }
        }
        if (alpha === 1) {
          this.previousDrawFullAlpha = true;
        } else {
          this.previousDrawFullAlpha = false;
        }

        if (
          this.settings.videoOverlayEnabled &&
          this.videoOverlay &&
          !this.videoOverlay.isHidden
        ) {
          if (alpha !== 1) {
            if (this.videoOverlay.ctx.globalAlpha !== 1) {
              this.videoOverlay.ctx.globalAlpha = 1;
            }
            this.videoOverlay.ctx.drawImage(
              this.previousVideoOverlayBuffer.elem,
              0,
              0
            );
          }
          if (alpha > 0.005) {
            this.videoOverlay.ctx.globalAlpha = alpha;
            this.videoOverlay.ctx.drawImage(this.videoOverlayBuffer.elem, 0, 0);
          }
          this.videoOverlay.ctx.globalAlpha = 1;
        }

        if (!dontDrawAmbientlight) {
          //this.blendedProjectorBuffer can contain an old frame and be impossible to drawImage onto
          //this.previousProjectorBuffer can also contain an old frame

          if (alpha !== 1) {
            if (this.blendedProjectorBuffer.ctx.globalAlpha !== 1)
              this.blendedProjectorBuffer.ctx.globalAlpha = 1;
            this.blendedProjectorBuffer.ctx.drawImage(
              this.previousProjectorBuffer.elem,
              0,
              0
            );
          }
          if (alpha > 0.005) {
            this.blendedProjectorBuffer.ctx.globalAlpha = alpha;
            this.blendedProjectorBuffer.ctx.drawImage(
              this.projectorBuffer.elem,
              0,
              0
            );
          }
          this.blendedProjectorBuffer.ctx.globalAlpha = 1;

          this.projector.draw(this.blendedProjectorBuffer.elem);
        }
      }
    } else {
      if (!hasNewFrame && !this.settings.frameFading) return;

      if (
        this.settings.videoOverlayEnabled &&
        this.videoOverlay &&
        !this.videoOverlay.isHidden
      ) {
        if (this.enableChromiumBug1092080Workaround) {
          this.videoOverlay.ctx.clearRect(
            0,
            0,
            this.videoOverlay.elem.width,
            this.videoOverlay.elem.height
          );
        }
        this.videoOverlay.ctx.drawImage(
          this.videoElem,
          0,
          0,
          this.videoOverlay.elem.width,
          this.videoOverlay.elem.height
        );
      }

      const shouldDrawDirectlyFromVideoElem =
        this.shouldDrawDirectlyFromVideoElem();
      if (!dontDrawBuffer) {
        if (!shouldDrawDirectlyFromVideoElem) {
          // console.log('draw', hasNewFrame, dontDrawAmbientlight, this.projectorBuffer.elem.width, this.projectorBuffer.elem.height)
          this.projectorBuffer.ctx.drawImage(
            this.videoElem,
            0,
            0,
            this.projectorBuffer.elem.width,
            this.projectorBuffer.elem.height
          );
        }

        if (!dontDrawAmbientlight) {
          if (!shouldDrawDirectlyFromVideoElem) {
            this.projector.draw(this.projectorBuffer.elem);
          } else {
            this.projector.draw(this.videoElem);
          }
        }
      }
    }

    this.buffersCleared = false;
    if (!dontDrawBuffer || this.settings.videoOverlayEnabled) {
      this.ambientlightFrameCount++;
      this.ambientlightFrameTime = compose;
    }
    this.previousDrawTime = drawTime;
    if (hasNewFrame) {
      this.previousFrameTime = drawTime;
    }

    if (this.enableMozillaBug1606251Workaround) {
      this.containerElem.style.transform = `translateZ(${
        this.ambientlightFrameCount % 10
      }px)`;
    }

    return { hasNewFrame, detectBarSize };
  }

  scheduleBarSizeDetection = async () => {
    try {
      this.checkGetImageDataAllowed();
      if (!this.getImageDataAllowed) return;

      await this.barDetection.detect(
        this.shouldDrawDirectlyFromVideoElem() ||
          ((this.projectorBuffer.elem.height < 256 ||
            this.projectorBuffer.elem.width < 256) &&
            this.projectorBuffer.elem.height < this.videoElem.videoHeight)
          ? this.videoElem
          : this.projectorBuffer.elem,
        this.settings.detectColoredHorizontalBarSizeEnabled,
        this.settings.detectHorizontalBarSizeOffsetPercentage,
        this.settings.detectHorizontalBarSizeEnabled,
        this.settings.horizontalBarsClipPercentage,
        this.settings.detectVerticalBarSizeEnabled,
        this.settings.verticalBarsClipPercentage,
        this.p ? this.p.h / this.p.w : 1,
        !this.settings.frameBlending,
        this.settings.barSizeDetectionAverageHistorySize || 1,
        this.settings.barSizeDetectionAllowedElementsPercentage || 20,
        this.settings.barSizeDetectionAllowedUnevenBarsPercentage || 20,
        wrapErrorHandler(this.scheduleBarSizeDetectionCallback)
      );
    } catch (ex) {
      if (!this.showedDetectBarSizeWarning) {
        this.showedDetectBarSizeWarning = true;
        throw ex;
      }
    }
  };

  scheduleBarSizeDetectionCallback = async (
    horizontalPercentage,
    verticalPercentage
  ) => {
    const horizontalBarChanged =
      this.settings.detectHorizontalBarSizeEnabled &&
      horizontalPercentage !== undefined &&
      this.setHorizontalBars(horizontalPercentage);
    const verticalBarChanged =
      this.settings.detectVerticalBarSizeEnabled &&
      verticalPercentage !== undefined &&
      this.setVerticalBars(verticalPercentage);
    if (!horizontalBarChanged && !verticalBarChanged) return;

    this.sizesChanged = true;
    await this.optionalFrame();
  };

  checkIfNeedToHideVideoOverlay() {
    if (!this.videoOverlay) return;

    if (!this.hideVideoOverlayCache) {
      this.hideVideoOverlayCache = {
        prevAmbientlightVideoDroppedFrameCount:
          this.ambientlightVideoDroppedFrameCount,
        framesInfo: [],
        isHiddenChangeTimestamp: 0,
      };
    }

    let {
      prevAmbientlightVideoDroppedFrameCount,
      framesInfo,
      isHiddenChangeTimestamp,
    } = this.hideVideoOverlayCache;

    const newFramesDropped = Math.max(
      0,
      this.ambientlightVideoDroppedFrameCount -
        prevAmbientlightVideoDroppedFrameCount
    );
    this.hideVideoOverlayCache.prevAmbientlightVideoDroppedFrameCount =
      this.ambientlightVideoDroppedFrameCount;
    framesInfo.push({
      time: performance.now(),
      framesDropped: newFramesDropped,
    });
    const frameDropTimeLimit = performance.now() - 2000;
    framesInfo = framesInfo.filter((info) => info.time > frameDropTimeLimit);
    this.hideVideoOverlayCache.framesInfo = framesInfo;

    let hide =
      this.videoElem.paused ||
      this.videoElem.seeking ||
      this.videoIsHidden ||
      (this.isFillingFullscreen && this.atTop && !this.settings.frameBlending);
    const syncThreshold = this.settings.videoOverlaySyncThreshold;
    if (!hide && syncThreshold !== 100) {
      if (framesInfo.length < 5) {
        hide = true;
      } else {
        const droppedFramesCount = framesInfo.reduce(
          (sum, info) => sum + info.framesDropped,
          0
        );
        const droppedFramesThreshold =
          this.videoFrameRate * 2 * (syncThreshold / 100);
        hide = droppedFramesCount > droppedFramesThreshold;
      }
    }

    if (hide) {
      if (!this.videoOverlay.isHidden) {
        this.videoOverlay.elem.classList.add(
          'ambientlight__video-overlay--hide'
        );
        this.videoOverlay.isHidden = true;
        this.hideVideoOverlayCache.isHiddenChangeTimestamp = performance.now();
        this.stats.update();
      }
    } else if (
      syncThreshold == 100 ||
      isHiddenChangeTimestamp + 2000 < performance.now()
    ) {
      if (this.videoOverlay.isHidden) {
        this.videoOverlay.elem.classList.remove(
          'ambientlight__video-overlay--hide'
        );
        this.videoOverlay.isHidden = false;
        this.hideVideoOverlayCache.isHiddenChangeTimestamp = performance.now();
        this.stats.update();
      }
    }
  }

  async enable(initial = false) {
    if (!initial) {
      this.settings.set('enabled', true, true);
    }

    await this.start(initial);
  }

  async disable() {
    if (this.pendingStart) return;
    this.settings.set('enabled', false, true);

    await this.hide();
  }

  start = async (initial = false) => {
    if (!this.isOnVideoPage || !this.settings.enabled || this.pendingStart)
      return;

    await this.updateHdr();
    this.showedCompareWarning = false;
    this.showedDetectBarSizeWarning = false;
    this.nextFrameTime = undefined;
    this.ambientlightVideoDroppedFrameCount = 0;
    this.buffersCleared = true; // Prevent old frame from preventing the new frame from being drawn
    this.barDetection.reset();

    this.checkGetImageDataAllowed();
    await this.resetSettingsIfNeeded();
    await this.updateView(true);

    this.pendingStart = true;
    if (initial) {
      if (document.visibilityState === 'hidden') {
        await new Promise((resolve) => raf(resolve));
      }
    }
    this.pendingStart = undefined;

    if (this.shouldShow()) await this.show();

    // Continue only if still enabled after await
    if (!this.settings.enabled || !this.isOnVideoPage) return;

    // Prevent incorrect stats from showing
    this.lastUpdateStatsTime = performance.now() + this.updateStatsInterval;
    await this.nextFrame();
  };

  updateHdr = wrapErrorHandler(
    async function updateHdr() {
      if (!this.settings.webGL || !(this.videoElem?.readyState > 1)) return;

      try {
        let isHdr;
        if (typeof VideoFrame !== 'undefined') {
          // Not yet supported in Firefox (Stable): https://bugzilla.mozilla.org/show_bug.cgi?id=1749539
          const videoFrame = new VideoFrame(this.videoElem, { timestamp: 0 });
          isHdr = videoFrame?.colorSpace?.primaries === 'bt2020'; // https://w3c.github.io/webcodecs/#videocolorspace
          videoFrame.close();
        } else {
          isHdr = await injectedScript.postAndReceiveMessage('is-hdr-video');
        }

        if (this.isHdr === isHdr) return;

        this.isHdr = isHdr;
        if (isHdr) {
          this.initWebGLHdrProjectorBuffer();
          this.projectorBuffer = this.hdrProjectorBuffer;
        } else if (this.hdrProjectorBuffer) {
          this.projectorBuffer = this.nonHdrProjectorBuffer;
        }
        this.sizesChanged = true;
      } catch (ex) {
        if (ex?.name === 'InvalidStateError') return;

        console.warn(
          `Failed to detect video color space:\n${
            ex.message
          }\n${''}(ReadyState: ${readyStateToString(
            this.videoElem?.readyState
          )})`
        );
      }
    }.bind(this),
    true
  );

  cancelScheduledRequestVideoFrame = () => {
    if (!this.requestVideoFrameCallbackId) return;

    if (this.videoElem?.cancelVideoFrameCallback) {
      try {
        this.videoElem.cancelVideoFrameCallback(
          this.requestVideoFrameCallbackId
        );
      } catch {
        console.warn(
          `Failed to cancel current requested videoFrameCallback: ${this.requestVideoFrameCallbackId}`
        );
      }
    }
    this.requestVideoFrameCallbackId = undefined;
  };

  scheduleRequestVideoFrame = () => {
    if (
      // this.videoFrameCallbackReceived || // Doesn't matter because this can be true now but not when the new video frame is received
      this.requestVideoFrameCallbackId ||
      this.settings.frameSync != FRAMESYNC_VIDEOFRAMES ||
      this.videoIsHidden || // Partial solution for https://bugs.chromium.org/p/chromium/issues/detail?id=1142112#c9
      !this.canScheduleNextFrame()
    )
      return;

    this.requestVideoFrameCallbackId = this.videoElem.requestVideoFrameCallback(
      this.onVideoFrame
    );
  };

  onVideoFrame = wrapErrorHandler(
    async function onVideoFrame(compose, info) {
      if (!this.requestVideoFrameCallbackId) {
        console.warn(
          `Old rvfc fired. Ignoring a possible duplicate. ${this.requestVideoFrameCallbackId} | ${compose} | ${info}`
        );
        return;
      }
      this.videoElem.requestVideoFrameCallback(function prescheduledVFC() {}); // Requesting as soon as possible to prevent skipped video frames on displays with a matching framerate

      this.stats.receiveVideoFrametimes(compose, info);
      this.requestVideoFrameCallbackId = undefined;
      this.videoFrameCallbackReceived = true;
      this.videoPresentedFrames = info?.presentedFrames || 0;
      this.videoFrameTime = compose;

      if (this.scheduledNextFrame) return;
      this.scheduledNextFrame = true;

      await this.onNextFrame();
    }.bind(this),
    true
  );

  async hide() {
    // Bilibili shows a mini player when the page is scrolled down to the comments.
    // Then only the ambient light is hidden, because resetting the theme and the
    // blended elements while scrolling would flash the whole page.
    const keepPageStyle =
      this.settings.enabled && this.isOnVideoPage && this.view === VIEW_POPUP;
    if (this.isHidden) {
      // For example: Enabled or disabled while the mini player is shown
      if (this.keepPageStyle !== keepPageStyle) {
        this.keepPageStyle = keepPageStyle;
        if (keepPageStyle) {
          await this.applyPageStyle();
        } else {
          await this.resetPageStyle();
        }
      }
      return;
    }
    this.isHidden = true;
    this.keepPageStyle = keepPageStyle;

    if (this.chromiumBugVideoJitterWorkaround?.update)
      this.chromiumBugVideoJitterWorkaround.update();

    if (!keepPageStyle) await this.resetPageStyle();

    if (this.videoOverlay?.elem?.isConnected) {
      this.videoOverlay.elem.remove();
    }
    if (this.videoDebandingElem?.isConnected) {
      this.videoDebandingElem.remove();
    }

    this.resetVideoParentElemStyle();
    this.clear();
    this.stats.hide();

    await this.updateSizes();
  }

  applyPageStyle = async () => {
    await injectedScript.postAndReceiveMessage('show', {
      toDark: this.theming.shouldBeDarkTheme(true),
      hideScrollbar: this.settings.hideScrollbar,
      immersiveMode: this.shouldEnableImmersiveMode(),
    });

    await this.theming.updateTheme();
  };

  resetPageStyle = async () => {
    const toDark = this.theming.shouldBeDarkTheme(false);
    await injectedScript.postAndReceiveMessage('hide', {
      toDark,
    });

    await this.theming.updateTheme();
  };

  async show() {
    if (!this.isHidden) return;
    this.isHidden = false;
    this.keepPageStyle = false;

    const toDark = this.theming.shouldBeDarkTheme(true);
    await injectedScript.postAndReceiveMessage('show', {
      toDark,
      hideScrollbar: this.settings.hideScrollbar,
      immersiveMode: this.shouldEnableImmersiveMode(),
    });

    wrapErrorHandler(
      async function afterShow() {
        const updateDocument = this.handleDocumentVisibilityChange(); // In case the visibility had changed while being disabled
        await this.theming.updateTheme();

        await updateDocument;

        if (this.chromiumBugVideoJitterWorkaround?.update)
          this.chromiumBugVideoJitterWorkaround.update();
      }.bind(this)
    )();
  }

  updateAtTop = async () => {
    if (this.mastheadElem)
      this.mastheadElem.classList.toggle('at-top', this.atTop);

    if (this.settings.webGL) await this.projector.handleAtTopChange(this.atTop);
  };

  shouldEnableImmersiveMode = () =>
    this.settings.immersiveTheaterView && this.view === VIEW_THEATER;

  async updateImmersiveMode() {
    const html = document.documentElement;
    const enabled = html.getAttribute('data-ambientlight-immersive') != null;
    const enable = this.shouldEnableImmersiveMode();

    if (enabled === enable) return;

    await injectedScript.postAndReceiveMessage('update-immersive-mode', enable);
  }
}
