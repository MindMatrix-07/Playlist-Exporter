/* ============================================
   Google AI Mode follow-up helper
   ============================================ */

function playlistExporterSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function playlistExporterIsVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.width > 0
    && rect.height > 0
    && style.display !== 'none'
    && style.visibility !== 'hidden'
    && style.opacity !== '0';
}

function playlistExporterFindFollowUpBox() {
  const selectors = [
    'textarea[placeholder*="ask" i]',
    'textarea[placeholder*="follow" i]',
    'textarea[placeholder*="message" i]',
    'textarea',
    '[contenteditable="true"]',
    '[role="textbox"]'
  ];

  for (const selector of selectors) {
    const matches = Array.from(document.querySelectorAll(selector))
      .filter(playlistExporterIsVisible)
      .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
    if (matches[0]) return matches[0];
  }

  return null;
}

function playlistExporterSetBoxText(box, text) {
  box.focus();

  if (box instanceof HTMLTextAreaElement || box instanceof HTMLInputElement) {
    const proto = box instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(box, text);
    } else {
      box.value = text;
    }
  } else {
    box.textContent = text;
  }

  box.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: text
  }));
  box.dispatchEvent(new Event('change', { bubbles: true }));
}

function playlistExporterFindSubmitButton(box) {
  const roots = [
    box.closest('form'),
    box.closest('[role="search"]'),
    box.parentElement,
    document
  ].filter(Boolean);

  const selectors = [
    'button[type="submit"]',
    'button[aria-label*="send" i]',
    'button[aria-label*="submit" i]',
    'button[aria-label*="search" i]',
    'button'
  ];

  for (const root of roots) {
    const buttons = selectors
      .flatMap(selector => Array.from(root.querySelectorAll(selector)))
      .filter(playlistExporterIsVisible)
      .filter(button => !button.disabled && button.getAttribute('aria-disabled') !== 'true')
      .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
    if (buttons[0]) return buttons[0];
  }

  return null;
}

async function playlistExporterSubmitFollowUp(query) {
  const box = playlistExporterFindFollowUpBox();
  if (!box) {
    return { ok: false, error: 'Google follow-up box not found' };
  }

  window.__playlistExporterLastPrompt = query;
  playlistExporterSetBoxText(box, query);
  await playlistExporterSleep(350);

  const button = playlistExporterFindSubmitButton(box);
  if (button) {
    button.click();
    await playlistExporterSleep(250);
  }

  box.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  }));
  box.dispatchEvent(new KeyboardEvent('keyup', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  }));

  return {
    ok: true,
    clickedButton: Boolean(button),
    inputTag: box.tagName,
    placeholder: box.getAttribute('placeholder') || ''
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'TYPE_GOOGLE_AI_FOLLOW_UP') return false;

  playlistExporterSubmitFollowUp(message.query)
    .then(sendResponse)
    .catch(error => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }));

  return true;
});
