const badge       = document.getElementById('status-badge');
const timer       = document.getElementById('timer');
const sizeEl      = document.getElementById('size');
const startBtn    = document.getElementById('start-btn');
const stopBtn     = document.getElementById('stop-btn');
const cancelBtn   = document.getElementById('cancel-btn');
const transcriptBox = document.getElementById('transcript-box');
const driveBtn    = document.getElementById('drive-btn');
const langSelect  = document.getElementById('lang-select');

let timerInterval = null;
let recordingStartTime = null;
let pendingDriveUrl = null; 

function formatTime(sec) {
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatSize(bytes) {
  if (!bytes) return '0 КБ';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
  return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
}

function setUI(state, extra = {}) {
  transcriptBox.style.display = 'none';
  driveBtn.style.display = 'none';
  startBtn.style.display = 'none';
  stopBtn.style.display   = 'none';
  cancelBtn.style.display = 'none';
  langSelect.disabled = false;
  pendingDriveUrl = null;

  switch (state) {
    case 'idle':
      badge.textContent = 'Готовий до запису';
      badge.className = 'idle';
      startBtn.style.display = 'block';
      timer.textContent = '00:00:00';
      sizeEl.textContent = '';
      break;

    case 'recording':
      badge.textContent = 'Записуємо...';
      badge.className = 'recording';
      stopBtn.style.display = 'block';
      cancelBtn.style.display = 'block';
      langSelect.disabled = true;
      break;

    case 'processing':
      badge.textContent = 'Обробляємо...';
      badge.className = 'processing';
      sizeEl.textContent = 'Whisper транскрибує — можна закрити вікно';
      langSelect.disabled = true;
      break;

    case 'done':
      badge.textContent = 'Готово!';
      badge.className = 'done';
      startBtn.style.display = 'block';
      sizeEl.textContent = 'Транскрипт нижче — натисніть Drive щоб зберегти';
      if (extra.transcript) {
        transcriptBox.style.display = 'block';
        transcriptBox.textContent = extra.transcript.length > 800
          ? extra.transcript.slice(0, 800) + '\n...(повний текст на Drive)'
          : extra.transcript;
      }
      if (extra.driveUrl) {
        pendingDriveUrl = extra.driveUrl;
        driveBtn.style.display = 'block';
        driveBtn.disabled = false;
        driveBtn.textContent = 'Зберегти на Google Drive';
      }
      break;

    case 'error':
      badge.textContent = 'Помилка';
      badge.className = 'idle';
      startBtn.style.display = 'block';
      if (extra.error) sizeEl.textContent = extra.error;
      break;
  }
}

function startTimer(startTime) {
  recordingStartTime = startTime;
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const sec = Math.floor((Date.now() - recordingStartTime) / 1000);
    timer.textContent = formatTime(sec);
    chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (res) => {
      if (res) sizeEl.textContent = formatSize(res.size);
    });
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

langSelect.addEventListener('change', () => {
  chrome.storage.local.set({ language: langSelect.value });
});

startBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.url?.includes('meet.google.com')) {
      setUI('error', { error: 'Відкрийте Google Meet' });
      return;
    }

    const rawTitle = tab.title || '';
    const meetTitle = rawTitle.replace(/\s*[-–]\s*Google Meet\s*$/i, '').trim() || null;
    const language = langSelect.value; 

    chrome.storage.session.remove('lastResult');
    chrome.runtime.sendMessage(
      { action: 'START_RECORDING', tabId: tab.id, meetTitle, language },
      (res) => {
        if (res?.ok) {
          setUI('recording');
          startTimer(Date.now());
        } else {
          setUI('error', { error: res?.error || 'Не вдалось почати запис' });
        }
      }
    );
  });
});

stopBtn.addEventListener('click', () => {
  stopTimer();
  setUI('processing');
  chrome.runtime.sendMessage({ action: 'STOP_RECORDING' }, (res) => {
    if (res?.ok) {
      setUI('done', { transcript: res.transcript, driveUrl: res.driveUrl });
    } else {
      setUI('error', { error: res?.error || 'Помилка при зупинці' });
    }
  });
});

cancelBtn.addEventListener('click', () => {
  if (!confirm('Скасувати запис? Аудіо буде втрачено.')) return;
  stopTimer();
  chrome.runtime.sendMessage({ action: 'CANCEL_RECORDING' }, () => {
    setUI('idle');
    timer.textContent = '00:00:00';
    sizeEl.textContent = '';
  });
});

driveBtn.addEventListener('click', () => {
  if (!pendingDriveUrl) return;
  driveBtn.disabled = true;
  driveBtn.textContent = 'Збережено ✓';
  chrome.tabs.create({ url: pendingDriveUrl });
  chrome.storage.session.remove('lastResult');
  chrome.runtime.sendMessage({ action: 'CONFIRM_DRIVE_UPLOAD' });
});

async function init() {
  const stored = await chrome.storage.local.get('language');
  if (stored.language) langSelect.value = stored.language;

  const session = await chrome.storage.session.get('lastResult');
  if (session.lastResult) {
    const r = session.lastResult;
    setUI('done', { transcript: r.transcript, driveUrl: r.driveUrl });
    return;
  }

  chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (res) => {
    if (res?.recording) {
      setUI('recording');
      langSelect.disabled = true;
      startTimer(res.startTime);
    } else {
      setUI('idle');
    }
  });
}

init();