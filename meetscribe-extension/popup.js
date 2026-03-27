const badge = document.getElementById('status-badge');
const timer = document.getElementById('timer');
const sizeEl = document.getElementById('size');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const transcriptBox = document.getElementById('transcript-box');
const driveLink = document.getElementById('drive-link');

let timerInterval = null;
let mediaRecorder = null;
let audioChunks = [];
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

function setUI(state) {
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
      break;
    case 'error':
      badge.textContent = 'Помилка';
      badge.className = 'idle';
      startBtn.style.display = 'block';
      break;
  }
}

function updateTimer() {
  if (!recordingStartTime) return;
  const sec = Math.floor((Date.now() - recordingStartTime) / 1000);
  timer.textContent = formatTime(sec);
  const totalSize = audioChunks.reduce((acc, c) => acc + c.size, 0);
  sizeEl.textContent = formatSize(totalSize);
}

startBtn.addEventListener('click', () => {
  chrome.tabCapture.capture({ audio: true, video: false }, (stream) => {
    if (chrome.runtime.lastError || !stream) {
      setUI('error');
      sizeEl.textContent = chrome.runtime.lastError?.message || 'Немає доступу до аудіо';
      return;
    }

    audioChunks = [];
    recordingStartTime = Date.now();

    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.start(5000);

    setUI('recording');
    timerInterval = setInterval(updateTimer, 1000);
  });
});

stopBtn.addEventListener('click', () => {
  if (!mediaRecorder) return;

  clearInterval(timerInterval);
  timerInterval = null;

  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach(t => t.stop());

  mediaRecorder.onstop = async () => {
    if (audioChunks.length === 0) {
      setUI('error');
      sizeEl.textContent = 'Немає аудіо даних';
      return;
    }

    setUI('processing');
    const blob = new Blob(audioChunks, { type: 'audio/webm' });

    audioChunks = [];
    recordingStartTime = null;
    mediaRecorder = null;

    try {
      const formData = new FormData();
      formData.append('audio', blob, `recording-${Date.now()}.webm`);

      const res = await fetch('http://localhost:3000/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (data.ok) {
        setUI('done');
        if (data.transcript) {
          transcriptBox.style.display = 'block';
          transcriptBox.textContent = data.transcript.length > 500
            ? data.transcript.slice(0, 500) + '...'
            : data.transcript;
        }
        if (data.driveUrl) {
          driveLink.style.display = 'block';
          driveLink.href = data.driveUrl;
        }
      } else {
        setUI('error');
        sizeEl.textContent = data.error || 'Помилка сервера';
      }
    } catch (err) {
      setUI('error');
      sizeEl.textContent = 'Сервер недоступний';
    }
  };
});

setUI('idle');
