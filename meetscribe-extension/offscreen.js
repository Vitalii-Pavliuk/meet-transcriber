let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let currentMeetTitle = null;
let currentLanguage = 'auto';
let audioCtx = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'offscreen') return false;

  if (msg.action === 'START_RECORDING') {
    startRecording(msg.streamId, msg.meetTitle, msg.language, sendResponse);
    return true;
  }
  if (msg.action === 'STOP_RECORDING') {
    stopRecording(sendResponse);
    return true;
  }
  if (msg.action === 'CANCEL_RECORDING') {
    cancelRecording(sendResponse);
    return true;
  }
  if (msg.action === 'GET_STATUS') {
    sendResponse({
      recording: mediaRecorder?.state === 'recording',
      startTime: recordingStartTime,
      size: audioChunks.reduce((acc, c) => acc + c.size, 0),
      meetTitle: currentMeetTitle,
    });
    return true;
  }
});

function startRecording(streamId, meetTitle, language, sendResponse) {
  if (mediaRecorder) {
    sendResponse({ ok: false, error: 'Запис вже йде' });
    return;
  }

  navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      }
    },
    video: false,
  }).then((stream) => {
    audioChunks = [];
    recordingStartTime = Date.now();
    currentMeetTitle = meetTitle || null;
    currentLanguage = language || 'auto';

    audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(audioCtx.destination);

    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.start(5000);
    sendResponse({ ok: true, startTime: recordingStartTime });
  }).catch((err) => {
    sendResponse({ ok: false, error: 'getUserMedia: ' + err.message });
  });
}

function cancelRecording(sendResponse) {
  if (!mediaRecorder) {
    sendResponse({ ok: true });
    return;
  }
  mediaRecorder.onstop = () => {
    audioChunks = [];
    recordingStartTime = null;
    currentMeetTitle = null;
    mediaRecorder = null;
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
    sendResponse({ ok: true });
  };
  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach(t => t.stop());
}

function stopRecording(sendResponse) {
  if (!mediaRecorder) {
    sendResponse({ ok: false, error: 'Запис не активний' });
    return;
  }

  if (audioChunks.length === 0 && mediaRecorder.state === 'recording') {
    mediaRecorder.requestData();
  }

  mediaRecorder.onstop = async () => {
    const totalSize = audioChunks.reduce((acc, c) => acc + c.size, 0);

    if (totalSize < 5 * 1024) {
      mediaRecorder = null;
      recordingStartTime = null;
      audioChunks = [];
      sendResponse({ ok: false, error: 'Запис порожній або занадто короткий' });
      return;
    }

    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    const savedTitle = currentMeetTitle;
    const savedLanguage = currentLanguage;
    audioChunks = [];
    recordingStartTime = null;
    mediaRecorder = null;
    currentMeetTitle = null;

    try {
      const formData = new FormData();
      formData.append('audio', blob, `recording-${Date.now()}.webm`);
      if (savedTitle) formData.append('meetTitle', savedTitle);
      if (savedLanguage && savedLanguage !== 'auto') {
        formData.append('language', savedLanguage);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25 * 60 * 1000);

      const res = await fetch('http://localhost:3000/upload', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await res.json();
      if (data.ok) {
        sendResponse({
          ok: true,
          transcript: data.transcript,
          driveUrl: data.driveUrl,
          meetTitle: savedTitle,
        });
      } else {
        sendResponse({ ok: false, error: data.error || 'Помилка сервера' });
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        sendResponse({ ok: false, error: 'Сервер не відповів за 25 хвилин' });
      } else {
        sendResponse({ ok: false, error: 'Сервер недоступний — запустіть node server.js' });
      }
    }
  };

  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach(t => t.stop());
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
}