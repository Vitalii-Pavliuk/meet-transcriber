const badge = document.getElementById('status-badge');
const timer = document.getElementById('timer');
const sizeEl = document.getElementById('size');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const transcriptBox = document.getElementById('transcript-box');
const driveLink = document.getElementById('drive-link');

let timerInterval = null;
let recordingStartTime = null;

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
  driveLink.style.display = 'none';
  startBtn.style.display = 'none';
  stopBtn.style.display = 'none';

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
      break;
    case 'processing':
      badge.textContent = 'Обробляємо...';
      badge.className = 'processing';
      sizeEl.textContent = 'Whisper транскрибує, зачекайте...';
      break;
    case 'done':
      badge.textContent = 'Готово!';
      badge.className = 'done';
      startBtn.style.display = 'block';
      sizeEl.textContent = '';
      if (extra.transcript) {
        transcriptBox.style.display = 'block';
        transcriptBox.textContent = extra.transcript.length > 500
          ? extra.transcript.slice(0, 500) + '...'
          : extra.transcript;
      }
      if (extra.driveUrl) {
        driveLink.style.display = 'block';
        driveLink.href = extra.driveUrl;
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

chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (res) => {
  if (res?.recording) {
    setUI('recording');
    startTimer(res.startTime);
  } else {
    setUI('idle');
  }
});

startBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url?.includes('meet.google.com')) {
      setUI('error', { error: 'Відкрийте Google Meet' });
      return;
    }

    chrome.runtime.sendMessage({ action: 'START_RECORDING', tabId: tab.id }, (res) => {
      if (res?.ok) {
        setUI('recording');
        startTimer(Date.now());
      } else {
        setUI('error', { error: res?.error || 'Не вдалось почати запис' });
      }
    });
  });
});

stopBtn.addEventListener('click', () => {
  clearInterval(timerInterval);
  timerInterval = null;
  setUI('processing');

  chrome.runtime.sendMessage({ action: 'STOP_RECORDING' }, (res) => {
    if (res?.ok) {
      setUI('done', { transcript: res.transcript, driveUrl: res.driveUrl });
    } else {
      setUI('error', { error: res?.error || 'Помилка при зупинці' });
    }
  });
});