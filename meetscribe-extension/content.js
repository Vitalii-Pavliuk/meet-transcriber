const speakingTimeline = [];
const activeSpeakers = new Map(); // Map<Element, startTimeMs>
const SILENT_CLASS = 'gjg47c';

const UI_STRINGS = new Set([
  'mute', 'unmute', 'pin', 'unpin', 'more options', 'remove',
  'spotlight', 'open', 'close', 'you', 'tile', 'video', 'audio',
  'present', 'presenting', 'hand raised',
]);

function getSpeakerName(speakingEl) {
  let el = speakingEl;
  for (let i = 0; i < 10; i++) {
    el = el.parentElement;
    if (!el) break;

    // Most reliable: Google Meet marks participant names with .notranslate
    const notranslate = el.querySelector('span.notranslate');
    if (notranslate) {
      const text = notranslate.textContent?.trim();
      if (text && text.length > 1 && text.length < 60) return text;
    }

    const nameEl = el.querySelector('[data-self-name], [data-participant-id]');
    if (nameEl) {
      return nameEl.getAttribute('data-self-name') ||
             nameEl.getAttribute('data-participant-id') ||
             nameEl.textContent?.trim();
    }

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.length > 0 && ariaLabel.length < 60 &&
        !UI_STRINGS.has(ariaLabel.toLowerCase())) {
      return ariaLabel;
    }

    const allEls = el.querySelectorAll('span, div');
    for (const child of allEls) {
      const text = child.textContent?.trim();
      if (text && text.length > 1 && text.length < 40 &&
          !text.includes('\n') && child.children.length === 0 &&
          !UI_STRINGS.has(text.toLowerCase())) {
        return text;
      }
    }
  }
  return null;
}

function onSpeakingStart(el) {
  if (activeSpeakers.has(el)) return;
  activeSpeakers.set(el, Date.now());
}

function onSpeakingEnd(el) {
  if (!activeSpeakers.has(el)) return;

  const start = activeSpeakers.get(el);
  const end = Date.now();
  activeSpeakers.delete(el);

  if (end - start < 500) return; // ignore bursts shorter than 0.5s

  // Resolve name at end — by now the participant tile is definitely rendered
  const name = getSpeakerName(el);
  speakingTimeline.push({ name, start, end });
  console.log(`[MeetScribe] ⏹ ${name ?? '?'}: ${((end - start) / 1000).toFixed(1)}s`);
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type !== 'attributes' || mutation.attributeName !== 'class') continue;

    const el = mutation.target;
    if (!el.classList.contains('IisKdb')) continue;

    const wasSilent = mutation.oldValue?.includes(SILENT_CLASS);
    const isSilent  = el.classList.contains(SILENT_CLASS);

    if (wasSilent && !isSilent) onSpeakingStart(el);
    else if (!wasSilent && isSilent) onSpeakingEnd(el);
  }
});

function startObserving() {
  speakingTimeline.length = 0;
  activeSpeakers.clear();
  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
    attributeOldValue: true,
  });
  console.log('[MeetScribe] Speaker tracking started');
}

function stopObserving() {
  observer.disconnect();
  const now = Date.now();
  for (const [el, start] of activeSpeakers.entries()) {
    const name = getSpeakerName(el);
    speakingTimeline.push({ name, start, end: now });
  }
  activeSpeakers.clear();
  return [...speakingTimeline];
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'START_TRACKING') {
    startObserving();
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'STOP_TRACKING') {
    const timeline = stopObserving();
    sendResponse({ ok: true, timeline });
    return true;
  }
  if (msg.action === 'GET_TIMELINE') {
    sendResponse({ ok: true, timeline: [...speakingTimeline] });
    return true;
  }
});
