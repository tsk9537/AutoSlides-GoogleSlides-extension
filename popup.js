// AutoSlides - Popup Controller Script
document.addEventListener('DOMContentLoaded', async () => {
  const intervalInput = document.getElementById('intervalInput');
  const unitSecBtn = document.getElementById('unitSecBtn');
  const unitMinBtn = document.getElementById('unitMinBtn');
  const minimizeOnStartToggle = document.getElementById('minimizeOnStartToggle');
  const autoStartToggle = document.getElementById('autoStartToggle');
  const autoFullscreenToggle = document.getElementById('autoFullscreenToggle');
  const loopToggle = document.getElementById('loopToggle');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const statusBadge = document.getElementById('statusBadge');
  const activeTimer = document.getElementById('activeTimer');
  const presetButtons = document.querySelectorAll('.preset-btn');
  const toggleOptionsBtn = document.getElementById('toggleOptionsBtn');
  const optionsBody = document.getElementById('optionsBody');
  const optionsChevron = document.getElementById('optionsChevron');
  const effectiveIntervalLabel = document.getElementById('effectiveIntervalLabel');

  let currentUnit = 'seconds';
  let isRunning = false;

  // Accordion toggle
  if (toggleOptionsBtn && optionsBody && optionsChevron) {
    toggleOptionsBtn.addEventListener('click', () => {
      optionsBody.classList.toggle('open');
      optionsChevron.classList.toggle('open');
    });
  }

  function isContextValid() {
    try {
      return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }

  function updateIntervalLabel() {
    if (effectiveIntervalLabel && intervalInput) {
      effectiveIntervalLabel.textContent = (intervalInput.value || 5) + ' ' + currentUnit;
    }
  }

  // Load stored settings safely
  if (isContextValid() && chrome.storage && chrome.storage.sync) {
    try {
      chrome.storage.sync.get({
        interval: 5,
        unit: 'seconds',
        minimizeOnStart: true,
        autoStartSlideshow: true,
        autoFullscreen: true,
        loop: true,
        isRunning: false
      }, (items) => {
        if (!items) return;
        if (intervalInput) intervalInput.value = items.interval || 5;
        currentUnit = items.unit || 'seconds';
        setUnit(currentUnit);
        if (minimizeOnStartToggle) minimizeOnStartToggle.checked = items.minimizeOnStart !== false;
        if (autoStartToggle) autoStartToggle.checked = items.autoStartSlideshow !== false;
        if (autoFullscreenToggle) autoFullscreenToggle.checked = items.autoFullscreen !== false;
        if (loopToggle) loopToggle.checked = items.loop !== false;
        updateRunningState(!!items.isRunning);
        updateIntervalLabel();
      });
    } catch (e) {
      console.warn('[AutoSlides] Could not load storage:', e);
    }
  }

  function setUnit(unit) {
    currentUnit = unit;
    if (unit === 'seconds') {
      if (unitSecBtn) unitSecBtn.classList.add('active');
      if (unitMinBtn) unitMinBtn.classList.remove('active');
    } else {
      if (unitMinBtn) unitMinBtn.classList.add('active');
      if (unitSecBtn) unitSecBtn.classList.remove('active');
    }
    updateIntervalLabel();
    saveSettings();
  }

  if (unitSecBtn) unitSecBtn.addEventListener('click', () => setUnit('seconds'));
  if (unitMinBtn) unitMinBtn.addEventListener('click', () => setUnit('minutes'));

  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const sec = parseInt(btn.getAttribute('data-sec'), 10);
      if (sec >= 60 && sec % 60 === 0) {
        currentUnit = 'minutes';
        if (intervalInput) intervalInput.value = sec / 60;
        setUnit('minutes');
      } else {
        currentUnit = 'seconds';
        if (intervalInput) intervalInput.value = sec;
        setUnit('seconds');
      }
      updateIntervalLabel();
      saveSettings();
    });
  });

  function getSettings() {
    return {
      interval: intervalInput ? (parseFloat(intervalInput.value) || 5) : 5,
      unit: currentUnit,
      minimizeOnStart: minimizeOnStartToggle ? minimizeOnStartToggle.checked : true,
      autoStartSlideshow: autoStartToggle ? autoStartToggle.checked : true,
      autoFullscreen: autoFullscreenToggle ? autoFullscreenToggle.checked : true,
      loop: loopToggle ? loopToggle.checked : true,
      isRunning: isRunning
    };
  }

  function saveSettings() {
    const settings = getSettings();
    if (isContextValid() && chrome.storage && chrome.storage.sync) {
      try {
        chrome.storage.sync.set(settings);
      } catch (e) {}
    }
    sendToActiveTab({ action: 'UPDATE_SETTINGS', settings });
  }

  if (intervalInput) {
    intervalInput.addEventListener('input', () => {
      updateIntervalLabel();
      saveSettings();
    });
  }
  if (minimizeOnStartToggle) minimizeOnStartToggle.addEventListener('change', saveSettings);
  if (autoStartToggle) autoStartToggle.addEventListener('change', saveSettings);
  if (autoFullscreenToggle) autoFullscreenToggle.addEventListener('change', saveSettings);
  if (loopToggle) loopToggle.addEventListener('change', saveSettings);

  function updateRunningState(running) {
    isRunning = running;
    if (running) {
      if (statusBadge) {
        statusBadge.textContent = 'Active';
        statusBadge.className = 'status-badge status-running';
      }
      if (startBtn) startBtn.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'flex';
      if (activeTimer) activeTimer.textContent = 'Advancing every ' + (intervalInput ? intervalInput.value : '5') + ' ' + currentUnit;
    } else {
      if (statusBadge) {
        statusBadge.textContent = 'Ready';
        statusBadge.className = 'status-badge status-idle';
      }
      if (startBtn) startBtn.style.display = 'flex';
      if (stopBtn) stopBtn.style.display = 'none';
      if (activeTimer) activeTimer.textContent = 'Stopped';
    }
  }

  async function sendToActiveTab(message) {
    if (!isContextValid() || !chrome.tabs) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        return await chrome.tabs.sendMessage(tab.id, message);
      }
    } catch (e) {}
  }

  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      updateRunningState(true);
      const settings = getSettings();
      settings.isRunning = true;

      if (isContextValid() && chrome.storage && chrome.storage.sync) {
        try {
          chrome.storage.sync.set(settings);
        } catch (e) {}
      }

      // Query active Google Slides tab
      if (isContextValid() && chrome.tabs) {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab && tab.id) {
            // 1. Enter OS-level Chrome fullscreen window to completely remove browser tabs, omnibar, and menus
            if (settings.autoFullscreen && tab.windowId && chrome.windows) {
              chrome.windows.update(tab.windowId, { state: 'fullscreen' }).catch(() => {});
            }

            // 2. If user is in /edit view and autoStartSlideshow is enabled, seamlessly transition tab to /present
            if (settings.autoStartSlideshow && tab.url && tab.url.includes('/presentation/d/') && tab.url.includes('/edit')) {
              const presentUrl = tab.url.replace(/\/edit.*$/, '/present');
              await chrome.tabs.update(tab.id, { url: presentUrl });
            } else {
              await chrome.tabs.sendMessage(tab.id, { action: 'START_AUTOSLIDES', settings }).catch(() => {});
            }
          }
        } catch (e) {
          console.warn('[AutoSlides] Error starting presentation:', e);
        }
      }

      // 3. Minimize / close extension options popup on start if requested
      if (settings.minimizeOnStart !== false) {
        setTimeout(() => {
          try {
            window.close();
          } catch (e) {}
        }, 150);
      }
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', async () => {
      updateRunningState(false);
      if (isContextValid() && chrome.storage && chrome.storage.sync) {
        try {
          chrome.storage.sync.set({ isRunning: false });
        } catch (e) {}
      }
      await sendToActiveTab({ action: 'STOP_AUTOSLIDES' });
    });
  }

  sendToActiveTab({ action: 'GET_STATUS' });
  if (isContextValid() && chrome.runtime && chrome.runtime.onMessage) {
    try {
      chrome.runtime.onMessage.addListener((request) => {
        if (request && request.action === 'STATUS_REPORT') {
          updateRunningState(!!request.isRunning);
        }
      });
    } catch (e) {}
  }
});
