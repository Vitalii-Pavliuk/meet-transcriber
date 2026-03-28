let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'offscreen') return false;

  if (msg.action === 'START_RECORDING') {
    startRecording(msg.streamId, sendResponse);
    return true;
  }
  if (msg.action === 'STOP_RECORDING') {
    stopRecording(sendResponse);
    return true;
  }
  if (msg.action === 'GET_STATUS') {
    sendResponse({
      recording: mediaRecorder?.state === 'recording',
      startTime: recordingStartTime,
      size: audioChunks.reduce((acc, c) => acc + c.size, 0),
    });
    return true;
  }
});

function startRecording(streamId, sendResponse) {
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

function stopRecording(sendResponse) {
  if (!mediaRecorder) {
    sendResponse({ ok: false, error: 'Запис не активний' });
    return;
  }

  mediaRecorder.onstop = async () => {
    if (audioChunks.length === 0) {
      mediaRecorder = null;
      recordingStartTime = null;
      sendResponse({ ok: false, error: 'Немає аудіо даних' });
      return;
    }

    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    audioChunks = [];
    recordingStartTime = null;
    mediaRecorder = null;

    try {
      const formData = new FormData();
      formData.append('audio', blob, `recording-${Date.now()}.webm`);

      const res = await fetch('http://localhost:3000/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (data.ok) {
        sendResponse({ ok: true, transcript: data.transcript, driveUrl: data.driveUrl });
      } else {
        sendResponse({ ok: false, error: data.error || 'Помилка сервера' });
      }
    } catch {
      sendResponse({ ok: false, error: 'Сервер недоступний — переконайтесь що запущено node server.js' });
    }
  };

  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach(t => t.stop());
}