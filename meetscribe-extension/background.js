const OFFSCREEN_URL = chrome.runtime.getURL('offscreen.html');

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
  } catch (err) {
    if (!err.message?.includes('Only a single')) throw err;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'START_RECORDING') {
    handleStart(msg.tabId, sendResponse);
    return true;
  }
  if (msg.action === 'STOP_RECORDING') {
    handleStop(sendResponse);
    return true;
  }
  if (msg.action === 'GET_STATUS') {
    forwardToOffscreen({ action: 'GET_STATUS' }, sendResponse);
    return true;
  }
});

async function handleStart(tabId, sendResponse) {
  try {
    await ensureOffscreen();
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError || !streamId) {
        sendResponse({
          ok: false,
          error: chrome.runtime.lastError?.message || 'Не вдалось отримати stream'
        });
        return;
      }
      forwardToOffscreen({ action: 'START_RECORDING', streamId }, sendResponse);
    });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

async function handleStop(sendResponse) {
  try {
    await ensureOffscreen();
    forwardToOffscreen({ action: 'STOP_RECORDING' }, sendResponse);
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}
function forwardToOffscreen(msg, sendResponse) {
  ensureOffscreen().then(() => {
    chrome.runtime.sendMessage({ ...msg, target: 'offscreen' }, (res) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse(res);
      }
    });
  }).catch(err => sendResponse({ ok: false, error: err.message }));
}
