// AutoSlides Content Script for Google Slides (docs.google.com/presentation/*)
(() => {
  if (window.__autoslides_injected) return;
  window.__autoslides_injected = true;

  let isRunning = false;
  let heartbeatInterval = null;
  let nextAdvanceTimestamp = 0;

  let settings = {
    interval: 30,
    unit: 'seconds',
    autoStartSlideshow: true,
    autoFullscreen: true,
    loop: true,
    isRunning: false
  };

  function isExtensionValid() {
    try {
      return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }

  function getIntervalInSeconds() {
    if (settings.unit === 'minutes') {
      return Math.max(0.5, (parseFloat(settings.interval) || 1) * 60);
    }
    return Math.max(0.5, parseFloat(settings.interval) || 30);
  }

  // Check persistent session storage & chrome sync storage on initial injection
  function initAutoSlides() {
    const sessionRunning = sessionStorage.getItem('__autoslides_active') === 'true';

    if (isExtensionValid() && chrome.storage && chrome.storage.sync) {
      try {
        chrome.storage.sync.get(settings, (loaded) => {
          if (!isExtensionValid()) return;
          if (loaded) {
            settings = Object.assign(settings, loaded);
            if (settings.isRunning || sessionRunning) {
              startAutoSlides();
            }
          }
        });
      } catch (e) {
        if (sessionRunning) startAutoSlides();
      }
    } else if (sessionRunning) {
      startAutoSlides();
    }
  }

  // Full Screen Presenter View Launcher
  function triggerFullscreenAndPresenterMode() {
    const currentUrl = window.location.href;

    // Transition /edit to /present if in editor
    if (currentUrl.includes('/edit') && settings.autoStartSlideshow) {
      const presentBtn = document.querySelector(
        '#present-button, div[role="button"][data-tooltip*="Slideshow"], div[role="button"][aria-label*="Slideshow"], div[role="button"][aria-label*="Present"], .punch-start-presentation-container button'
      );
      if (presentBtn) {
        try { presentBtn.click(); } catch(e){}
      } else {
        const presentUrl = currentUrl.replace(/\/edit.*$/, '/present');
        if (presentUrl !== currentUrl) {
          sessionStorage.setItem('__autoslides_active', 'true');
          window.location.href = presentUrl;
          return;
        }
      }
    }

    if (settings.autoFullscreen) {
      enterImmersiveFullscreen();
    }
  }

  function enterImmersiveFullscreen() {
    if (isExtensionValid()) {
      try {
        chrome.runtime.sendMessage({ action: 'REQUEST_FULLSCREEN' }).catch(() => {});
      } catch (e) {}
    }

    setTimeout(() => {
      const fsBtn = document.querySelector(
        '.punch-viewer-icon-fullscreen, .punch-viewer-fullscreen-button, div[aria-label*="Full screen"], div[data-tooltip*="Full screen"], div[aria-label="Full screen (f)"]'
      );
      if (fsBtn) {
        try { fsBtn.click(); } catch(e){}
      }

      // Dispatch 'f' keydown event (Google Slides fullscreen hotkey)
      const fEvent = new KeyboardEvent('keydown', {
        key: 'f',
        code: 'KeyF',
        keyCode: 70,
        which: 70,
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(fEvent);
      window.dispatchEvent(fEvent);

      if (!document.fullscreenElement) {
        const docEl = document.documentElement;
        if (docEl.requestFullscreen) {
          docEl.requestFullscreen().catch(() => {});
        } else if (docEl.webkitRequestFullscreen) {
          docEl.webkitRequestFullscreen();
        }
      }
    }, 300);
  }

  // Continuous Single-Step Advance Engine (Advances exactly 1 slide per interval)
  function performSlideAdvance() {
    if (!isRunning) return;

    // Immediately schedule the next timestamp before doing any DOM dispatch
    // This prevents any timer stalls or single-advance lockups
    const intervalSec = getIntervalInSeconds();
    nextAdvanceTimestamp = Date.now() + (intervalSec * 1000);

    try {
      // 1. Loop Check: Check if currently on the last slide of the presentation
      let isLastSlide = false;

      // Method A: Check if Google Slides Next button is disabled (100% reliable in presentation mode)
      const nextBtnDisabled = document.querySelector(
        '.punch-viewer-navbar-next[aria-disabled="true"], .punch-viewer-navbar-next.goog-flat-button-disabled, div[aria-label*="Next"][aria-disabled="true"], div[data-tooltip*="Next"][aria-disabled="true"], div[aria-label="Next slide"][aria-disabled="true"], div[role="button"][data-tooltip*="Next"][aria-disabled="true"]'
      );
      if (nextBtnDisabled) {
        isLastSlide = true;
      }

      // Method B: Check slide indicator text/input (e.g. "5 / 5" or "5 of 5")
      if (!isLastSlide) {
        const indicators = document.querySelectorAll(
          '.punch-viewer-nav-slide-number, .punch-viewer-slide-indicator, div[aria-label*="Slide"], .punch-viewer-navbar-slide-indicator, input.punch-viewer-nav-slide-number'
        );
        for (const el of indicators) {
          const raw = (el.value || el.textContent || '').trim();
          const numbers = raw.match(/\d+/g);
          if (numbers && numbers.length >= 2) {
            const cur = parseInt(numbers[0], 10);
            const tot = parseInt(numbers[1], 10);
            if (cur >= tot && tot > 1) {
              isLastSlide = true;
              break;
            }
          }
        }
      }

      // Method C: Check edit mode filmstrip if in /edit
      if (!isLastSlide && window.location.href.includes('/edit')) {
        const selectedThumb = document.querySelector('.punch-filmstrip-thumbnail-selected, div[role="option"][aria-selected="true"]');
        if (selectedThumb && !selectedThumb.nextElementSibling) {
          isLastSlide = true;
        }
      }

      // If at the end of the presentation
      if (isLastSlide) {
        if (settings.loop !== false) {
          console.log('[AutoSlides] Reached last slide. Looping back to Slide 1...');
          rewindToFirstSlide();
          return;
        } else {
          console.log('[AutoSlides] Reached last slide. Stopping (loop disabled).');
          stopAutoSlides();
          return;
        }
      }

      // 2. Perform Single-Step Advance (Dispatches EXACTLY ONE clean event to prevent slide skipping)
      const keyInit = {
        key: 'ArrowRight',
        code: 'ArrowRight',
        keyCode: 39,
        which: 39,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      };

      const downEv = new KeyboardEvent('keydown', keyInit);
      const upEv = new KeyboardEvent('keyup', keyInit);

      const target = document.querySelector('.punch-viewer-container') ||
        document.querySelector('.punch-viewer-content') ||
        document.activeElement ||
        document;

      if (target && target !== document) {
        try {
          target.dispatchEvent(downEv);
          target.dispatchEvent(upEv);
        } catch (e) {
          document.dispatchEvent(downEv);
          document.dispatchEvent(upEv);
        }
      } else {
        document.dispatchEvent(downEv);
        document.dispatchEvent(upEv);
      }

      // In /edit mode fallback: advance filmstrip selection by 1
      if (window.location.href.includes('/edit')) {
        const selectedThumb = document.querySelector('.punch-filmstrip-thumbnail-selected, div[role="option"][aria-selected="true"]');
        if (selectedThumb && selectedThumb.nextElementSibling) {
          const next = selectedThumb.nextElementSibling;
          if (next && typeof next.click === 'function') {
            next.click();
          }
        }
      }
    } catch (err) {
      console.warn('[AutoSlides] Slide advance step warning:', err);
    }
  }

  // Rewind back to Slide 1
  function rewindToFirstSlide() {
    try {
      // 1. Google Slides standard Home key navigation
      const homeInit = {
        key: 'Home',
        code: 'Home',
        keyCode: 36,
        which: 36,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      };
      const homeDown = new KeyboardEvent('keydown', homeInit);
      const homeUp = new KeyboardEvent('keyup', homeInit);

      const target = document.querySelector('.punch-viewer-container') ||
        document.querySelector('.punch-viewer-content') ||
        document.activeElement ||
        document;

      if (target && target !== document) {
        try {
          target.dispatchEvent(homeDown);
          target.dispatchEvent(homeUp);
        } catch (e) {
          document.dispatchEvent(homeDown);
          document.dispatchEvent(homeUp);
        }
      } else {
        document.dispatchEvent(homeDown);
        document.dispatchEvent(homeUp);
      }

      // 2. Google Slides jump shortcut: typing '1' then 'Enter' navigates to Slide 1
      setTimeout(() => {
        const digit1Down = new KeyboardEvent('keydown', { key: '1', code: 'Digit1', keyCode: 49, which: 49, bubbles: true, cancelable: true, composed: true, view: window });
        const digit1Up = new KeyboardEvent('keyup', { key: '1', code: 'Digit1', keyCode: 49, which: 49, bubbles: true, cancelable: true, composed: true, view: window });
        const enterDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true, view: window });
        const enterUp = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true, view: window });

        document.dispatchEvent(digit1Down);
        document.dispatchEvent(digit1Up);
        document.dispatchEvent(enterDown);
        document.dispatchEvent(enterUp);
      }, 50);

      // 3. In /edit mode, click first slide thumbnail
      if (window.location.href.includes('/edit')) {
        const firstThumb = document.querySelector('.punch-filmstrip-thumbnail, div[role="option"]');
        if (firstThumb && typeof firstThumb.click === 'function') {
          firstThumb.click();
        }
      }
    } catch (e) {
      console.warn('[AutoSlides] Rewind to slide 1 error:', e);
    }
  }

  // Continuous Heartbeat Loop - NEVER gets destroyed or lost between slides
  function ensureHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      if (!isRunning) return;
      const now = Date.now();
      if (now >= nextAdvanceTimestamp) {
        performSlideAdvance();
      }
    }, 150);
  }

  // Start Slideshow
  function startAutoSlides() {
    isRunning = true;
    sessionStorage.setItem('__autoslides_active', 'true');
    const intervalSec = getIntervalInSeconds();
    nextAdvanceTimestamp = Date.now() + (intervalSec * 1000);

    triggerFullscreenAndPresenterMode();
    ensureHeartbeat();
    reportStatus();
    console.log('[AutoSlides] Auto-advancer started (every ' + intervalSec + 's).');
  }

  // Stop Slideshow
  function stopAutoSlides() {
    isRunning = false;
    sessionStorage.removeItem('__autoslides_active');
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    reportStatus();
    console.log('[AutoSlides] Auto-advancer stopped.');
  }

  function reportStatus() {
    if (!isExtensionValid()) return;
    try {
      chrome.runtime.sendMessage({ action: 'STATUS_REPORT', isRunning }).catch(() => {});
    } catch (e) {}
  }

  // Listen for popup & background messages
  if (isExtensionValid() && chrome.runtime && chrome.runtime.onMessage) {
    try {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (!request) return;
        if (request.action === 'START_AUTOSLIDES') {
          if (request.settings) {
            settings = Object.assign(settings, request.settings);
          }
          startAutoSlides();
          sendResponse({ success: true, isRunning: true });
        } else if (request.action === 'STOP_AUTOSLIDES') {
          stopAutoSlides();
          sendResponse({ success: true, isRunning: false });
        } else if (request.action === 'UPDATE_SETTINGS') {
          if (request.settings) {
            settings = Object.assign(settings, request.settings);
          }
          const intervalSec = getIntervalInSeconds();
          nextAdvanceTimestamp = Date.now() + (intervalSec * 1000);
          sendResponse({ success: true });
        } else if (request.action === 'GET_STATUS') {
          sendResponse({ isRunning, settings });
        }
      });
    } catch (e) {}
  }

  // Keyboard shortcut listener within Google Slides tab (Alt+P)
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      if (isRunning) {
        stopAutoSlides();
      } else {
        startAutoSlides();
      }
    }
  });

  initAutoSlides();
  console.log('[AutoSlides] Extension Content Script active.');
})();
