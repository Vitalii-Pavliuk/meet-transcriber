  const OFFSCREEN_URL = chrome.runtime.getURL('offscreen.html');

  let currentTabId = null;

  async function ensureOffscreen() {
    try {
      if (typeof chrome.offscreen.hasDocument === 'function') {
        const exists = await chrome.offscreen.hasDocument();
        if (exists) return;
      }
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ['USER_MEDIA'],
        justification: 'Recording tab audio via tabCapture',
      });
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      if (!err.message?.includes('Only a single')) throw err;
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'START_RECORDING') {
      handleStart(msg.tabId, msg.meetTitle, msg.language, sendResponse);
      return true;
    }
    if (msg.action === 'STOP_RECORDING') {
      handleStop(sendResponse);
      return true;
    }
    if (msg.action === 'CANCEL_RECORDING') {
      forwardToOffscreen({ action: 'CANCEL_RECORDING' }, sendResponse);
      return true;
    }
    if (msg.action === 'GET_STATUS') {
      tryForwardToOffscreen({ action: 'GET_STATUS' }, sendResponse, {
        recording: false, startTime: null, size: 0, meetTitle: null
      });
      return true;
    }
      if (msg.action === 'CONFIRM_DRIVE_UPLOAD') {
      chrome.storage.session.get('lastDriveUrl', ({ lastDriveUrl }) => {
        if (lastDriveUrl) chrome.tabs.create({ url: lastDriveUrl });
      });
      return false;
    }
  });

  async function handleStart(tabId, meetTitle, language, sendResponse) {
    try {
      await ensureOffscreen();

      currentTabId = tabId;
      chrome.tabs.sendMessage(tabId, { action: 'START_TRACKING' }, (res) => {
        if (chrome.runtime.lastError) {
          console.log('[MeetScribe] content.js did not respond — DOM tracking disabled');
        } else {
          console.log('[MeetScribe] DOM tracking started');
        }
      });

      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
        if (chrome.runtime.lastError || !streamId) {
          sendResponse({
            ok: false,
            error: chrome.runtime.lastError?.message || 'Не вдалось отримати stream'
          });
          return;
        }
        forwardToOffscreen(
          { action: 'START_RECORDING', streamId, meetTitle, language },
          sendResponse
        );
      });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  }

  async function handleStop(sendResponse) {
    try {
      let domTimeline = [];
      if (currentTabId) {
        domTimeline = await new Promise((resolve) => {
          chrome.tabs.sendMessage(currentTabId, { action: 'STOP_TRACKING' }, (res) => {
            if (chrome.runtime.lastError || !res?.ok) resolve([]);
            else resolve(res.timeline || []);
          });
        });
        console.log('[MeetScribe] DOM timeline:', domTimeline.length, 'events');
      }
      currentTabId = null;

      await ensureOffscreen();
      forwardToOffscreen({ action: 'STOP_RECORDING', domTimeline }, async (res) => {
        if (res?.ok) {
          await chrome.storage.session.set({ lastResult: res });
          if (res.driveUrl) {
            await chrome.storage.session.set({ lastDriveUrl: res.driveUrl });
          }
          showSuccessNotification(res.meetTitle);
        } else {
          showErrorNotification(res?.error || 'Невідома помилка');
        }
        sendResponse(res);
      });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  }

  function showSuccessNotification(meetTitle) {
    chrome.notifications.create('meetscribe-done', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'MeetScribe — транскрипт готовий',
      message: meetTitle
        ? `"${meetTitle}" оброблено. Відкрийте розширення щоб зберегти.`
        : 'Оброблено. Відкрийте розширення щоб зберегти на Drive.',
      priority: 2,
    });
  }

  function showErrorNotification(error) {
    chrome.notifications.create('meetscribe-error', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'MeetScribe — помилка',
      message: error.slice(0, 100),
      priority: 1,
    });
  }

  chrome.notifications.onClicked.addListener((notifId) => {
    chrome.notifications.clear(notifId);
    chrome.action.openPopup?.();
  });

  function forwardToOffscreen(msg, sendResponse) {
    ensureOffscreen().then(() => {
      sendWithRetry({ ...msg, target: 'offscreen' }, 5, 200, (res) => {
        sendResponse(res);
      });
    }).catch(err => sendResponse({ ok: false, error: err.message }));
  }

  function tryForwardToOffscreen(msg, sendResponse, fallback) {
    ensureOffscreen().then(() => {
      sendWithRetry({ ...msg, target: 'offscreen' }, 3, 150, (res) => {
        sendResponse(res);
      });
    }).catch(() => sendResponse(fallback));
  }

  function sendWithRetry(msg, maxAttempts, delay, callback) {
    let attempts = 0;
    function trySend() {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) {
          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(trySend, delay);
          } else {
            callback({ ok: false, error: chrome.runtime.lastError.message });
          }
        } else {
          callback(res);
        }
      });
    }
    trySend();
  }