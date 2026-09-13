// aichat.js
// SafAI Chat Assistant for SafiTrack CRM
// Provides a secure, read-only conversational interface for CRM-wide analytics,
// pipeline intelligence, task/reminder briefings, customer lookups, and team metrics.
// Dispatches queries directly to the serverless safai-assistant Supabase Edge Function.

// conversation state
let chatState = null;
// track the last message the user sent so retry can replay it
let lastUserMessage = '';

// Persistent conversation memory — survives intent resets, cleared on "New chat"
let conversationHistory = [];
const MAX_HISTORY = 14; // 7 user turns + 7 AI responses

// Raw CRM data from the last query — lets follow-up questions reference real data
let lastCRMContext = '';

function addToHistory(role, content) {
  conversationHistory.push({ role, content });
  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY);
  }
}

function resetConversation() {
  lastCRMContext = '';
  chatState = null;
}


// ------------------------------------------------------------------
// Initialization and UI helpers
// ------------------------------------------------------------------
function initializeAIChat() {
  const windowEl = document.getElementById('ai-chat-window');
  const closeBtn = document.getElementById('ai-chat-close');
  const sendBtn = document.getElementById('ai-chat-send');
  const input = document.getElementById('ai-chat-input');

  // essential elements must exist
  if (!windowEl || !closeBtn || !sendBtn || !input) return;

  // header button opens chat
  const navBtn = document.getElementById('ask-safi-btn');
  if (navBtn) navBtn.addEventListener('click', openChat);

  function openChat() {
    if (windowEl.classList.contains('active')) return;
    windowEl.classList.add('active');
    if (!chatState || !chatState.intent) {
      resetConversation();
      document.getElementById('ai-chat-empty')?.classList.remove('hidden');
    }
  }
  closeBtn.addEventListener('click', () => windowEl.classList.remove('active'));
  const newBtn = document.getElementById('ai-chat-new');
  if (newBtn) newBtn.addEventListener('click', () => {
    const msgs = document.getElementById('ai-chat-messages');
    if (msgs) {
      Array.from(msgs.children).forEach(el => { if (el.id !== 'ai-chat-empty') el.remove(); });
    }
    resetConversation();
    conversationHistory = [];
    lastCRMContext = '';
    document.getElementById('ai-chat-empty')?.classList.remove('hidden');
  });

  sendBtn.addEventListener('click', onUserSubmit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // If slash prompts menu is open, pick first visible prompt instead of sending
      const menu = document.getElementById('ai-prompts-menu');
      if (menu && !menu.hidden) {
        const first = menu.querySelector('.ai-prompt-item:not([hidden])');
        if (first) { first.click(); }
        else {
          menu.hidden = true;
          document.getElementById('ai-prompts-btn')?.classList.remove('active');
        }
        return;
      }
      onUserSubmit();
    }
  });

  // Delegated click handler: suggestion chips + action buttons
  const messagesEl = document.getElementById('ai-chat-messages');
  if (messagesEl) {
    messagesEl.addEventListener('click', async (e) => {
      // Suggestion chips (empty state)
      const chip = e.target.closest('.ai-chip');
      if (chip && chip.dataset.prompt) {
        const inp = document.getElementById('ai-chat-input');
        if (inp) { inp.value = chip.dataset.prompt; inp.dispatchEvent(new Event('input')); }
        onUserSubmit();
        return;
      }

      // Action buttons (copy, helpful, not-helpful, retry)
      const btn = e.target.closest('.ai-chat-action-btn');
      if (!btn) return;
      const action = btn.dataset.action;
      const msgEl = btn.closest('.ai-chat-message');

      if (action === 'copy') {
        const bubble = msgEl && msgEl.querySelector('.ai-chat-bubble');
        const textContent = bubble ? bubble.innerText : '';
        try {
          await navigator.clipboard.writeText(textContent);
          btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
          btn.classList.add('ai-action-copied');
          setTimeout(() => {
            btn.innerHTML = ICON_COPY;
            btn.classList.remove('ai-action-copied');
          }, 1800);
        } catch (err) {
          console.error('Copy failed', err);
        }
      } else if (action === 'retry') {
        if (!lastUserMessage) return;
        if (msgEl) msgEl.remove();
        await processUserMessage(lastUserMessage);
      } else if (action === 'helpful') {
        const wasActive = btn.classList.contains('ai-action-active');
        btn.classList.toggle('ai-action-active', !wasActive);
        if (msgEl) msgEl.querySelector('[data-action="not-helpful"]')?.classList.remove('ai-action-active');
      } else if (action === 'not-helpful') {
        const wasActive = btn.classList.contains('ai-action-active');
        btn.classList.toggle('ai-action-active', !wasActive);
        if (msgEl) msgEl.querySelector('[data-action="helpful"]')?.classList.remove('ai-action-active');
      }
    });
  }

  // Enable send button only when input has content
  function updateSendBtn() {
    sendBtn.disabled = !input.value.trim();
    // Auto-resize textarea
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }
  updateSendBtn();
  input.addEventListener('input', updateSendBtn);

  // Prompts dropdown
  const promptsBtn = document.getElementById('ai-prompts-btn');
  const promptsMenu = document.getElementById('ai-prompts-menu');
  let menuOpenedBySlash = false;

  function filterPrompts(query) {
    if (!promptsMenu) return;
    const items = promptsMenu.querySelectorAll('.ai-prompt-item');
    const q = query.toLowerCase().trim();
    let anyVisible = false;
    items.forEach(item => {
      const label = (item.dataset.label || '').toLowerCase();
      const matches = !q || label.includes(q);
      item.hidden = !matches;
      if (matches) anyVisible = true;
    });
    const noResults = promptsMenu.querySelector('.ai-prompts-empty');
    if (noResults) noResults.hidden = anyVisible;
  }

  function openPromptsMenu() {
    if (!promptsMenu) return;
    promptsMenu.hidden = false;
    promptsBtn?.classList.add('active');
  }

  function closePromptsMenu() {
    if (!promptsMenu) return;
    promptsMenu.hidden = true;
    promptsBtn?.classList.remove('active');
    menuOpenedBySlash = false;
    promptsMenu.querySelectorAll('.ai-prompt-item').forEach(i => i.hidden = false);
    const noResults = promptsMenu.querySelector('.ai-prompts-empty');
    if (noResults) noResults.hidden = true;
  }

  function selectPrompt(prompt) {
    closePromptsMenu();
    input.value = prompt;
    input.style.height = 'auto';
    input.dispatchEvent(new Event('input'));
    input.focus();
    onUserSubmit();
  }

  if (promptsBtn && promptsMenu) {
    promptsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!promptsMenu.hidden) { closePromptsMenu(); return; }
      menuOpenedBySlash = false;
      filterPrompts('');
      openPromptsMenu();
    });

    promptsMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.ai-prompt-item');
      if (!item || item.hidden) return;
      selectPrompt(item.dataset.prompt);
    });

    document.addEventListener('click', (e) => {
      if (!promptsMenu.hidden && !promptsBtn.contains(e.target) && !promptsMenu.contains(e.target)) {
        closePromptsMenu();
      }
    });
  }

  // Slash command: typing /... in the textarea opens and filters prompts live
  input.addEventListener('input', () => {
    if (!promptsMenu) return;
    const val = input.value;
    if (val.startsWith('/')) {
      filterPrompts(val.slice(1));
      openPromptsMenu();
      menuOpenedBySlash = true;
    } else if (menuOpenedBySlash) {
      closePromptsMenu();
    }
  });
}

async function onUserSubmit() {
  const input = document.getElementById('ai-chat-input');
  const text = input.value.trim();
  if (!text) return;
  lastUserMessage = text;
  appendUserMessage(text);
  input.value = '';
  input.style.height = 'auto';
  input.dispatchEvent(new Event('input'));
  await processUserMessage(text);
}

async function processUserMessage(text) {
  appendLoadingIndicator();
  try {
    await handleUserMessage(text);
  } catch (err) {
    if (err.status === 429) {
      appendAIMessage('The AI service is temporarily rate-limited. Please wait a moment and try again.');
    } else {
      appendAIMessage('Something went wrong. Please try again.');
      console.error('Chat error:', err);
    }
  } finally {
    removeLoadingIndicator();
  }
}

// ------------------------------------------------------------------
// SafAI Assistant Backend Dispatcher
// ------------------------------------------------------------------

async function handleUserMessage(text) {
  if (!window.supabaseClient) {
    appendAIMessage("SafiTrack client is not initialized. Please refresh the page.");
    return;
  }

  // Intercept explicit write requests on the client side immediately
  const lower = text.toLowerCase();
  const isExplicitWrite =
    /\b(create|add|insert|make a new|log a new|set a new)\s+(task|reminder|opportunity|deal|company|customer|contact|visit|call|note|workflow)\b/i.test(lower) ||
    /\b(delete|remove|erase|drop|cancel)\s+(task|reminder|opportunity|deal|company|customer|contact|visit|call|note|workflow)\b/i.test(lower) ||
    /\b(update|edit|modify|change stage|mark as|complete)\s+(task|reminder|opportunity|deal|company|customer|contact|visit|call|note|workflow)\b/i.test(lower);
  const isQuestionAboutCreation = /\b(how many|who created|when was|what was|list of|show me|which)\b/i.test(lower);

  if (isExplicitWrite && !isQuestionAboutCreation) {
    appendAIMessage("SafAI is currently in **read-only** mode to protect your CRM data. I can answer questions, analyze pipelines, calculate metrics, and summarize records across your CRM, but I cannot create, edit, or delete records. You can manage this directly in the corresponding CRM section.");
    return;
  }

  try {
    // Send request to the dedicated safai-assistant Edge Function
    const { data, error } = await window.supabaseClient.functions.invoke('safai-assistant', {
      body: {
        message: text,
        history: conversationHistory.slice(-8)
      }
    });

    if (error) {
      let serverErrorMsg = '';
      let status = error.status || 500;

      if (error.context) {
        status = error.context.status || status;
        try {
          const cloned = error.context.clone();
          const errJson = await cloned.json();
          serverErrorMsg = errJson.error || errJson.message || '';
        } catch (_) {
          try {
            serverErrorMsg = await error.context.clone().text();
          } catch (_) {}
        }
      }

      console.error("SafAI assistant invoke error details:", { status, message: error.message, serverErrorMsg, error });

      if (status === 429) {
        appendAIMessage("SafAI is receiving high demand and is temporarily rate-limited. Please wait a moment and try again.");
      } else if (status === 401 || status === 403) {
        appendAIMessage("Unable to authenticate your session with SafiTrack. Please refresh the page and ensure you are logged in.");
      } else if (serverErrorMsg) {
        appendAIMessage(`SafAI encountered an issue: ${serverErrorMsg}`);
      } else {
        appendAIMessage("I encountered an issue connecting to SafAI. Please wait a moment and try again.");
      }
      return;
    }

    if (!data) {
      appendAIMessage("I didn't receive a response from the CRM assistant. Please try again.");
      return;
    }

    if (data.error) {
      console.error("SafAI assistant error:", data.error);
      if (data.code === 429 || data.status === 429) {
        appendAIMessage("SafAI is receiving high demand and is temporarily rate-limited. Please wait a moment and try again.");
      } else {
        appendAIMessage(data.error || "Unable to process request.");
      }
      return;
    }

    const reply = data.reply || "I didn't receive an answer. Please try rephrasing your question.";
    appendAIMessage(reply);
  } catch (err) {
    console.error("handleUserMessage exception:", err);
    appendAIMessage("A network error occurred while communicating with SafAI. Please try again.");
  }
}


// ------------------------------------------------------------------
// UI rendering utilities + Markdown renderer – converts Gemini markdown responses to safe HTML
// ------------------------------------------------------------------

function inlineMarkdown(text) {
  // Escape HTML special chars
  let s = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Inline code (protect first so bold/italic don't touch it)
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // Bold + italic
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Bold
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic *
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  // Italic _
  s = s.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  return s;
}

function renderMarkdown(rawText) {
  if (!rawText) return '';
  const lines = rawText.split('\n');
  const result = [];
  let listBuffer = [];
  let listType = null;

  function flushList() {
    if (!listBuffer.length) return;
    const tag = listType;
    result.push(`<${tag}>${listBuffer.map(i => `<li>${i}</li>`).join('')}</${tag}>`);
    listBuffer = [];
    listType = null;
  }

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) {
      flushList();
      result.push('');
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line)) {
      flushList();
      result.push('<hr>');
      continue;
    }

    // Headings
    const hm = line.match(/^(#{1,4})\s+(.+)/);
    if (hm) {
      flushList();
      const lvl = Math.min(hm[1].length, 4);
      result.push(`<h${lvl}>${inlineMarkdown(hm[2])}</h${lvl}>`);
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      flushList();
      result.push(`<blockquote>${inlineMarkdown(line.slice(2))}</blockquote>`);
      continue;
    }

    // Unordered list  (-, *, •, +)
    const ulm = line.match(/^[-*\u2022+]\s+(.+)/);
    if (ulm) {
      if (listType && listType !== 'ul') flushList();
      listType = 'ul';
      listBuffer.push(inlineMarkdown(ulm[1]));
      continue;
    }

    // Ordered list
    const olm = line.match(/^\d+[.)]\s+(.+)/);
    if (olm) {
      if (listType && listType !== 'ol') flushList();
      listType = 'ol';
      listBuffer.push(inlineMarkdown(olm[1]));
      continue;
    }

    // Normal paragraph line
    flushList();
    result.push(`<p>${inlineMarkdown(line)}</p>`);
  }

  flushList();
  return result.filter(r => r !== '').join('\n');
}

function appendUserMessage(text) {
  addToHistory('user', text);
  document.getElementById('ai-chat-empty')?.classList.add('hidden');
  const container = document.getElementById('ai-chat-messages');
  const msg = document.createElement('div');
  msg.className = 'ai-chat-message user';
  msg.innerHTML = `<div class="ai-chat-bubble">${escapeHtml(text)}</div>`;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

const ICON_COPY = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const ICON_THUMBS_UP = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>`;
const ICON_THUMBS_DOWN = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L13 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>`;
const ICON_RETRY = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;

function buildAIMessageActions() {
  return `<div class="ai-chat-actions">
    <button class="ai-chat-action-btn" data-action="copy" title="Copy">${ICON_COPY}</button>
    <button class="ai-chat-action-btn" data-action="helpful" title="Helpful">${ICON_THUMBS_UP}</button>
    <button class="ai-chat-action-btn" data-action="not-helpful" title="Not helpful">${ICON_THUMBS_DOWN}</button>
    <button class="ai-chat-action-btn" data-action="retry" title="Try again">${ICON_RETRY}</button>
  </div>`;
}

function appendAIMessage(text) {
  addToHistory('assistant', text);
  document.getElementById('ai-chat-empty')?.classList.add('hidden');
  const container = document.getElementById('ai-chat-messages');
  const msg = document.createElement('div');
  msg.className = 'ai-chat-message ai';
  msg.innerHTML = `<div class="ai-chat-bubble">${renderMarkdown(text)}</div>${buildAIMessageActions()}`;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

// similar to appendAIMessage but assumes html is already safe
function appendAIMessageHtml(html) {
  const container = document.getElementById('ai-chat-messages');
  const msg = document.createElement('div');
  msg.className = 'ai-chat-message ai';
  msg.innerHTML = `<div class="ai-chat-bubble">${html}</div>${buildAIMessageActions()}`;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function appendLoadingIndicator() {
  const container = document.getElementById('ai-chat-messages');
  const msg = document.createElement('div');
  msg.className = 'ai-chat-message ai loading';
  msg.id = 'ai-chat-loading';
  msg.innerHTML = `<div class="ai-chat-bubble"><div class="ai-chat-typing-dots"><span></span><span></span><span></span></div></div>`;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function removeLoadingIndicator() {
  const el = document.getElementById('ai-chat-loading');
  if (el) el.remove();
}

function escapeHtml(unsafe) {
  return unsafe.replace(/[&<"']/g, function (m) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m];
  });
}

// Expose initializer to global scope
window.initializeAIChat = initializeAIChat;

// start after DOM ready
document.addEventListener('DOMContentLoaded', initializeAIChat);
