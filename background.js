// AutoSlides Background Service Worker (Manifest V3)
chrome.runtime.onInstalled.addListener(() => {
  console.log('[AutoSlides] Background service worker initialized.');
  chrome.storage.sync.set({
    interval: 30,
    unit: 'seconds',
    minimizeOnStart: true,
    autoStartSlideshow: true,
    autoFullscreen: true,
    loop: true,
    isRunning: false
  });
});

// Fullscreen window updater using chrome.windows API
// This hides browser tabs, omnibar/address bar, and browser menus completely
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.action === 'REQUEST_FULLSCREEN') {
    const winId = (sender && sender.tab && sender.tab.windowId) 
      ? sender.tab.windowId 
      : chrome.windows.WINDOW_ID_CURRENT;
    if (winId && chrome.windows) {
      chrome.windows.update(winId, { state: 'fullscreen' }).catch(() => {});
    }
    sendResponse({ success: true });
    return true;
  }
});

// Handle Keyboard Shortcuts (Alt+P)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-autoslides') {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id && tab.url && tab.url.includes('docs.google.com/presentation')) {
        chrome.storage.sync.get(['isRunning', 'autoFullscreen', 'autoStartSlideshow'], async (res) => {
          const nextState = !res.isRunning;
          chrome.storage.sync.set({ isRunning: nextState });
          
          if (nextState) {
            if (res.autoFullscreen !== false && tab.windowId && chrome.windows) {
              chrome.windows.update(tab.windowId, { state: 'fullscreen' }).catch(() => {});
            }
            if (res.autoStartSlideshow !== false && tab.url.includes('/edit')) {
              const presentUrl = tab.url.replace(/\/edit.*$/, '/present');
              await chrome.tabs.update(tab.id, { url: presentUrl });
              return;
            }
          }
          
          chrome.tabs.sendMessage(tab.id, {
            action: nextState ? 'START_AUTOSLIDES' : 'STOP_AUTOSLIDES'
          }).catch(() => {});
        });
      }
    } catch (e) {}
  }
});
