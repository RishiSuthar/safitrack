// aichat.js
// AI Chat Assistant for SafiTrack CRM
// Provides conversational interface to create tasks and reminders.
// Relies on groq API via ai.js and existing task/reminder logic in app.js

// conversation state
let chatState = null;

// fields we want to collect
const TASK_REQUIRED_FIELDS = ['title', 'description', 'due_date', 'priority', 'assigned_to'];
const REMINDER_REQUIRED_FIELDS = ['title', 'description', 'reminder_date', 'assigned_to'];

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
    if (windowEl.classList.contains('active')) {
      // already open, do nothing
      return;
    }
    windowEl.classList.add('active');
    if (!chatState || !chatState.intent) {
      resetConversation();
      appendAIMessage('Hi! I can help you create tasks and reminders conversationally. Just say something like "Create a task".');
    }
  }
  closeBtn.addEventListener('click', () => windowEl.classList.remove('active'));
  const newBtn = document.getElementById('ai-chat-new');
  if (newBtn) newBtn.addEventListener('click', () => {
    // clear messages and reset state
    document.getElementById('ai-chat-messages').innerHTML = '';
    resetConversation();
    appendAIMessage('Hi! I can help you create tasks and reminders conversationally. Just say something like "Create a task".');
  });

  sendBtn.addEventListener('click', onUserSubmit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onUserSubmit();
    }
  });
}

async function onUserSubmit() {
  const input = document.getElementById('ai-chat-input');
  const text = input.value.trim();
  if (!text) return;
  appendUserMessage(text);
  input.value = '';
  await processUserMessage(text);
}

async function processUserMessage(text) {
  appendLoadingIndicator();
  try {
    await handleUserMessage(text);
  } catch (err) {
    appendAIMessage('Sorry, something went wrong. ' + err.message);
  } finally {
    removeLoadingIndicator();
  }
}

// ------------------------------------------------------------------
// Conversation state & flow
// ------------------------------------------------------------------

async function handleUserMessage(text) {
  if (!chatState) resetConversation();

  if (!chatState.intent) {
    chatState.intent = await detectIntent(text);
    if (chatState.intent === 'none') {
      appendAIMessage("I didn't quite understand that. Are you trying to create a task or a reminder?");
      return;
    }
    // if user said "remind me" or similar in the kickoff message, prefill assigned_to
    if (chatState.intent === 'create_reminder' && /\bremind me\b/i.test(text)) {
      chatState.collectedFields.assigned_to = 'me';
    }
  }

  // compute what we're still waiting for before trying to parse
  const priorMissing = getMissingFields(chatState.intent, chatState.collectedFields);

  // if we previously asked about a specific field, remember it
  const expected = chatState.awaitingField;
  // clear for this turn
  delete chatState.awaitingField;

  let newFields = await extractFields(text, chatState.intent);

  // fallback: extractor failed to parse anything
  if (Object.keys(newFields).length === 0) {
    if (expected) {
      // use the field we just asked about
      newFields[expected] = text.trim();
    } else if (priorMissing.length === 1) {
      // when only one field remains, assume the reply is for it
      newFields[priorMissing[0]] = text.trim();
    }
  }

  // handle time adjustments, sensible defaults, and relative modifiers
  if (newFields.reminder_date) {
    // convert to date object for modifications
    let fixed = adjustTime(newFields.reminder_date, text);
    if (!fixed) {
      if (/\bmorning\b/i.test(text)) {
        fixed = setHour(newFields.reminder_date, 7);
      } else if (/\bafternoon\b/i.test(text)) {
        fixed = setHour(newFields.reminder_date, 15);
      } else if (/\bevening\b/i.test(text)) {
        fixed = setHour(newFields.reminder_date, 19);
      } else if (/\btonight\b/i.test(text)) {
        fixed = setHour(newFields.reminder_date, 20);
      } else {
        // default to midnight
        fixed = setHour(newFields.reminder_date, 0);
      }
    }
    // apply relative shifts (tomorrow, today, etc.)
    fixed = adjustRelativeDate(fixed, text);
    newFields.reminder_date = fixed;
  }
  if (newFields.due_date) {
    let fixed = adjustTime(newFields.due_date, text);
    if (!fixed) {
      if (/\bmorning\b/i.test(text)) {
        fixed = setHour(newFields.due_date, 7);
      } else if (/\bafternoon\b/i.test(text)) {
        fixed = setHour(newFields.due_date, 15);
      } else if (/\bevening\b/i.test(text)) {
        fixed = setHour(newFields.due_date, 19);
      } else if (/\btonight\b/i.test(text)) {
        fixed = setHour(newFields.due_date, 20);
      } else {
        fixed = setHour(newFields.due_date, 0);
      }
    }
    fixed = adjustRelativeDate(fixed, text);
    newFields.due_date = fixed;
  }

  Object.assign(chatState.collectedFields, newFields);

  // non-managers can only assign to themselves; fill automatically instead of asking
  if (!isManager && chatState.missingFields.includes('assigned_to')) {
    chatState.collectedFields.assigned_to = 'me';
  }

  chatState.missingFields = getMissingFields(chatState.intent, chatState.collectedFields);

  if (chatState.missingFields.length === 0) {
    await finalizeCreation(chatState.intent, chatState.collectedFields);
    resetConversation();
  } else {
    // anticipate which field we will inquire about (pick first missing)
    if (chatState.missingFields.length > 0) {
      chatState.awaitingField = chatState.missingFields[0];
    }
    const question = await generateFollowUpQuestion(chatState.missingFields, chatState.collectedFields);
    appendAIMessage(question);
  }
}

function resetConversation() {
  chatState = {
    intent: null,
    collectedFields: {},
    missingFields: []
  };
}

// ------------------------------------------------------------------
// Groq helpers for understanding
// ------------------------------------------------------------------

async function detectIntent(text) {
  const messages = [
    { role: 'system', content: 'You are an assistant that analyzes user messages and returns ONLY one of: create_task, create_reminder, or none.' },
    { role: 'user', content: `User message: "${text}"` }
  ];
  const response = await groqChat(messages, 50, 0);
  const match = response.match(/create_task|create_reminder/);
  return match ? match[0] : 'none';
}

async function extractFields(text, intent) {
  const fieldList = intent === 'create_task' ? TASK_REQUIRED_FIELDS : REMINDER_REQUIRED_FIELDS;
  const instructions = `Extract the following fields: ${fieldList.join(', ')}. Output a JSON object. \nOnly include keys for any fields you can glean from the text. For dates/times, convert to ISO 8601 if possible and if the year is omitted, assume the current year. \nIf you cannot determine a value, omit the key. Do not add any explanation.`;

  const messages = [
    { role: 'system', content: 'You are a smart extractor that outputs strict JSON.' },
    { role: 'user', content: `${instructions}\n\nUser message: "${text}"` }
  ];
  const response = await groqChat(messages, 200, 0);
  try {
    return JSON.parse(response.trim());
  } catch (e) {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (e2) {}
    }
  }
  return {};
}

function getMissingFields(intent, collected) {
  const req = intent === 'create_task' ? TASK_REQUIRED_FIELDS : REMINDER_REQUIRED_FIELDS;
  return req.filter(f => {
    const v = collected[f];
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  });
}

async function generateFollowUpQuestion(missingFields, collected) {
  // if we know which field is next, ask a direct short question;
  // fallback to groq only if we can't map.
  const field = missingFields[0];
  if (field) {
    switch (field) {
      case 'title':
        return 'What is the title?';
      case 'description':
        return 'Can you give me a brief description?';
      case 'due_date':
        return 'When is it due?';
      case 'reminder_date':
        return 'What date/time should I remind you?';
      case 'priority':
        return 'What priority should I set (low/medium/high)?';
      case 'assigned_to':
        if (!isManager) return 'It will be assigned to you.';
        return 'Who should it be assigned to?';
      default:
        break;
    }
  }
  // fallback to groq for any unexpected field
  const messages = [
    { role: 'system', content: 'You are a friendly assistant that asks the user for missing information. Only ask about one field at a time.' },
    { role: 'user', content: `The user is creating something and still needs these fields: ${missingFields.join(', ')}. \nThey have already provided: ${JSON.stringify(collected)}. \nWrite a conversational question requesting the next missing piece of information.` }
  ];
  const response = await groqChat(messages, 100, 0.7);
  return response.trim();
}

// ------------------------------------------------------------------
// Database integration and finalization
// ------------------------------------------------------------------

async function finalizeCreation(intent, fields) {
  if (!currentUser || !currentUser.id) {
    appendAIMessage('Unable to create item – user not authenticated.');
    return;
  }
  if (intent === 'create_task') {
    const taskData = {
      title: fields.title,
      description: fields.description || null,
      due_date: fields.due_date ? normalizeAndEnsureYear(fields.due_date) : null,
      priority: fields.priority || 'medium',
      assigned_to: await resolveUserId(fields.assigned_to),
      created_by: currentUser.id,
      status: 'pending'
    };
    try {
      const result = await supabaseClient.from('tasks').insert([taskData]);
      if (result.error) throw result.error;
      appendAIMessage(`Task "${taskData.title}" has been created successfully.`);
      if (typeof renderTasksView === 'function') renderTasksView();
      // close chat panel automatically
      const win = document.getElementById('ai-chat-window');
      if (win) win.classList.remove('active');
    } catch (err) {
      appendAIMessage('Error creating task: ' + err.message);
    }
  } else if (intent === 'create_reminder') {
    const reminderData = {
      title: fields.title,
      description: fields.description || null,
      reminder_date: fields.reminder_date ? normalizeAndEnsureYear(fields.reminder_date) : null,
      assigned_to: await resolveUserId(fields.assigned_to),
      created_by: currentUser.id,
      is_completed: false
    };
    try {
      const result = await supabaseClient.from('reminders').insert([reminderData]);
      if (result.error) throw result.error;
      appendAIMessage(`Reminder "${reminderData.title}" has been created successfully.`);
      if (typeof renderRemindersView === 'function') renderRemindersView();
      // close chat panel automatically
      const winRem = document.getElementById('ai-chat-window');
      if (winRem) winRem.classList.remove('active');
    } catch (err) {
      appendAIMessage('Error creating reminder: ' + err.message);
    }
  }
}

// ------------------------------------------------------------------
// Utility helpers
// ------------------------------------------------------------------

function normalizeAndEnsureYear(dateStr) {
  // try parsing directly
  let d = new Date(dateStr);
  const now = new Date();
  if (isNaN(d.getTime())) {
    // append current year and try again
    d = new Date(`${dateStr} ${now.getFullYear()}`);
  }
  if (isNaN(d.getTime())) {
    // fallback to current date to avoid null
    return now.toISOString();
  }
  // if parsed year is before current year, bump it (user probably meant upcoming date)
  if (d.getFullYear() < now.getFullYear()) {
    d.setFullYear(now.getFullYear());
  }
  return d.toISOString();
}

// helper to set a specific hour on an ISO date string
function setHour(iso, hour) {
  const d = new Date(iso);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

// adjust a date ISO string according to any time mention ("3pm", "14:30") in free text
// if no explicit time found, returns null (caller may handle defaults)
function adjustTime(iso, text) {
  if (!iso) return null;
  const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (m) {
    const d = new Date(iso);
    let hour = parseInt(m[1], 10);
    const minute = m[2] ? parseInt(m[2], 10) : 0;
    const ampm = m[3].toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    d.setHours(hour, minute);
    return d.toISOString();
  }
  const m24 = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m24) {
    const d = new Date(iso);
    d.setHours(parseInt(m24[1], 10), parseInt(m24[2], 10));
    return d.toISOString();
  }
  return null;
}


// relative date shifter: looks for keywords like tomorrow and adjusts the given ISO date accordingly
function adjustRelativeDate(iso, text) {
  if (!iso) return iso;
  const d = new Date(iso);
  const now = new Date();
  const lower = text.toLowerCase();
  const tomorrowWords = /\btomorrow\b|\btomorow\b|\btomororw\b|\btmrw\b/;
  if (tomorrowWords.test(lower)) {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    d.setFullYear(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
  } else if (/\btoday\b/i.test(lower)) {
    const today = new Date(now);
    d.setFullYear(today.getFullYear(), today.getMonth(), today.getDate());
  }
  // if the iso date ended up identical to today but text implies tomorrow, bump it
  if (tomorrowWords.test(lower)) {
    const check = new Date(iso);
    if (check.getDate() === now.getDate() && check.getMonth() === now.getMonth() && check.getFullYear() === now.getFullYear()) {
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      d.setFullYear(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
    }
  }
  return d.toISOString();
}

async function resolveUserId(name) {
  if (!name) return currentUser.id;
  const lower = name.trim().toLowerCase();
  if (['me', 'myself', 'self'].includes(lower)) return currentUser.id;

  try {
    const parts = name.trim().split(/\s+/);
    let query = supabaseClient.from('profiles').select('id, first_name, last_name').ilike('first_name', `%${parts[0]}%`);
    if (parts[1]) query = query.ilike('last_name', `%${parts[1]}%`);
    const res = await query.limit(1);
    if (res.error) throw res.error;
    if (res.data && res.data.length) return res.data[0].id;
  } catch (e) {
    console.error('resolveUserId error', e);
  }
  return currentUser.id;
}

// ------------------------------------------------------------------
// UI rendering utilities
// ------------------------------------------------------------------

function appendUserMessage(text) {
  const container = document.getElementById('ai-chat-messages');
  const msg = document.createElement('div');
  msg.className = 'ai-chat-message user';
  msg.innerHTML = `<div class="ai-chat-bubble">${escapeHtml(text)}</div>`;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function appendAIMessage(text) {
  const container = document.getElementById('ai-chat-messages');
  const msg = document.createElement('div');
  msg.className = 'ai-chat-message ai';
  msg.innerHTML = `<div class="ai-chat-bubble">${escapeHtml(text)}</div>`;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function appendLoadingIndicator() {
  const container = document.getElementById('ai-chat-messages');
  const msg = document.createElement('div');
  msg.className = 'ai-chat-message ai loading';
  msg.id = 'ai-chat-loading';
  msg.innerHTML = `<div class="ai-chat-bubble"><i class="fas fa-spinner fa-spin"></i> thinking...</div>`;
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
