// aichat.js
// AI Chat Assistant for SafiTrack CRM
// Provides conversational interface to create tasks, reminders and opportunities.
// Relies on groq API via ai.js and existing task/reminder/opportunity logic in app.js

// conversation state
let chatState = null;

// fields we want to collect
const TASK_REQUIRED_FIELDS = ['title', 'description', 'due_date', 'priority', 'assigned_to'];
const REMINDER_REQUIRED_FIELDS = ['title', 'description', 'reminder_date', 'assigned_to'];
// opportunity fields – the five below are considered required for conversation
const OPPORTUNITY_REQUIRED_FIELDS = ['name', 'company_name', 'value', 'stage', 'probability'];
// there are additional optional properties that may be supplied (next_step, next_step_date, notes, etc.) but
// we only force the core five when driving the chat.


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
      appendAIMessage('Hi! I can help you create tasks, reminders, or opportunities conversationally – and even give advice on winning deals. Just say something like "Create a task" or "How can I win my opportunity with Carrefour?".');
    }
  }
  closeBtn.addEventListener('click', () => windowEl.classList.remove('active'));
  const newBtn = document.getElementById('ai-chat-new');
  if (newBtn) newBtn.addEventListener('click', () => {
    // clear messages and reset state
    document.getElementById('ai-chat-messages').innerHTML = '';
    resetConversation();
    appendAIMessage('Hi! I can help you create tasks, reminders, or opportunities conversationally. Just say something like "Create a task" or "Add an opportunity".');
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

// helper to locate an existing opportunity by querying the database
async function findOpportunityForAdvice(text) {
  if (!text || !text.trim()) return null;
  try {
    // build a loose search pattern from tokens to pull candidates
    const tokens = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return null;
    // query using first token to limit results
    const { data, error } = await supabaseClient
      .from('opportunities')
      .select('*')
      .ilike('company_name', `%${tokens[0]}%`)
      .limit(50);
    if (error) {
      console.error('supabase advice lookup error', error);
      return null;
    }
    if (!data || !data.length) return null;
    // perform normalization-based matching on returned candidates
    const normQuery = normalizeForMatching(text);
    let best = null, bestScore = 0;
    for (const o of data) {
      const company = normalizeForMatching(o.company_name || '');
      const name = normalizeForMatching(o.name || '');
      if ((company && (company.includes(normQuery) || normQuery.includes(company))) ||
          (name && (name.includes(normQuery) || normQuery.includes(name)))) {
        return o;
      }
      const tokensSet = new Set(normQuery.split(/\s+/).filter(Boolean));
      const candidate = company || name;
      if (candidate) {
        const candTokens = candidate.split(/\s+/).filter(Boolean);
        let common = 0;
        candTokens.forEach(t => { if (tokensSet.has(t)) common++; });
        const score = candTokens.length > 0 ? common / candTokens.length : 0;
        if (score > bestScore) {
          bestScore = score;
          best = o;
        }
      }
    }
    if (bestScore >= 0.5) return best;
  } catch (e) {
    console.error('findOpportunityForAdvice exception', e);
  }
  return null;
}

// handle advice queries about an existing opportunity
async function handleAdvice(text) {
  // try to glean a company/opportunity name from the text
  const fields = await extractFields(text, 'create_opportunity');
  let opp = null;
  if (fields.company_name) {
    opp = await findOpportunityForAdvice(fields.company_name);
  }
  if (!opp) {
    opp = await findOpportunityForAdvice(text);
  }
  if (!opp) {
    appendAIMessage("I wasn't able to find a matching opportunity. Could you give me the company or exact opportunity name?");
    chatState.intent = 'advise_opportunity';
    chatState.awaitingField = 'company_name';
    return;
  }
  // compose guidance prompt
  const messages = [
    { role: 'system', content: 'You are Safi A.I, a concise, friendly sales coach. When asked to advise on an opportunity, respond with 3 short bullet points. Use **bold** for the main action phrase in each bullet and keep each bullet under one sentence. Keep the overall answer under 120 words and well spaced. Do NOT ramble.' },
    { role: 'user', content: `Opportunity details:\nName: ${opp.name}\nCompany: ${opp.company_name}\nStage: ${opp.stage}\nValue: ${opp.value}\nProbability: ${opp.probability}\nNotes: ${opp.notes || 'none'}\n\nOffer 3 brief, actionable steps to improve the chances of winning this deal.` }
  ];
  let reply = await groqChat(messages, 200, 0.7);
  // convert reply text into HTML list
  // split on bullet markers or line breaks
  const lines = reply.split(/\n|•/).map(l => l.trim()).filter(l => l);
  if (lines.length > 1) {
    const listItems = lines.map(l => {
      // convert **bold** markers to <strong>
      const safe = escapeHtml(l).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      return `<li>${safe}</li>`;
    }).join('');
    const html = `<p>Here are some suggestions:</p><ul>${listItems}</ul>`;
    appendAIMessageHtml(html);
  } else {
    appendAIMessage(reply);
  }
  resetConversation();
}


async function handleUserMessage(text) {
  if (!chatState) resetConversation();

  if (!chatState.intent) {
    const intent = await detectIntent(text);
    if (intent === 'none') {
      // casual message only; conversation state remains reset
      const reply = await generateCasualReply(text);
      appendAIMessage(reply);
      return;
    }
    chatState.intent = intent;

    // if the intent is advice, handle immediately
    if (chatState.intent === 'advise_opportunity') {
      await handleAdvice(text);
      return;
    }

    // special handling for first-opportunity message: ask company first
    if (chatState.intent === 'create_opportunity') {
      // try to pull company from the initial sentence in case user already mentioned it
      const initialFields = await extractFields(text, 'create_opportunity');
      if (initialFields.company_name) {
        chatState.collectedFields.company_name = String(initialFields.company_name).trim();
      }
      if (!chatState.collectedFields.company_name) {
        appendAIMessage('Alright, let’s start with the company – which company is this deal for?');
        chatState.awaitingField = 'company_name';
        return;
      }
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
  // if user is simply asking to create a task (not giving details), don't treat the question itself as title/description
  if (chatState.intent === 'create_task' && /\b(?:can we|could you|please)?\s*(?:make|create)\s+(?:a\s+)?task\b/i.test(text)) {
    delete newFields.title;
    delete newFields.description;
  }

  // if we were waiting on a specific field, treat the user's reply as the answer
  if (expected) {
    newFields = { [expected]: text.trim() };
  }

  // fallback: extractor failed to parse anything and no expected field
  if (!expected && Object.keys(newFields).length === 0) {
    if (priorMissing.length === 1) {
      // when only one field remains, assume the reply is for it
      newFields[priorMissing[0]] = text.trim();
    }
  }

  // handle time adjustments, sensible defaults, and relative modifiers
  if (newFields.reminder_date) {
    // we may receive non‑ISO strings like "tomorrow at 8pm"; try to build a real date
    let baseIso = newFields.reminder_date;
    let baseDate = new Date(baseIso);
    if (isNaN(baseDate.getTime())) {
      // derive from text keywords
      const now = new Date();
      baseIso = now.toISOString();
      baseIso = adjustRelativeDate(baseIso, text);
    }

    let fixed = adjustTime(baseIso, text);
    if (!fixed) {
      if (/\bmorning\b/i.test(text)) {
        fixed = setHour(baseIso, 7);
      } else if (/\bafternoon\b/i.test(text)) {
        fixed = setHour(baseIso, 15);
      } else if (/\bevening\b/i.test(text)) {
        fixed = setHour(baseIso, 19);
      } else if (/\btonight\b/i.test(text)) {
        fixed = setHour(baseIso, 20);
      } else {
        // default to midnight
        fixed = setHour(baseIso, 0);
      }
    }
    // apply relative shifts (tomorrow, today, etc.) again just in case
    fixed = adjustRelativeDate(fixed, text);
    newFields.reminder_date = fixed;
  }
  if (newFields.due_date) {
    let baseIso = newFields.due_date;
    let baseDate = new Date(baseIso);
    if (isNaN(baseDate.getTime())) {
      const now = new Date();
      baseIso = now.toISOString();
      baseIso = adjustRelativeDate(baseIso, text);
    }
    let fixed = adjustTime(baseIso, text);
    if (!fixed) {
      if (/\bmorning\b/i.test(text)) {
        fixed = setHour(baseIso, 7);
      } else if (/\bafternoon\b/i.test(text)) {
        fixed = setHour(baseIso, 15);
      } else if (/\bevening\b/i.test(text)) {
        fixed = setHour(baseIso, 19);
      } else if (/\btonight\b/i.test(text)) {
        fixed = setHour(baseIso, 20);
      } else {
        fixed = setHour(baseIso, 0);
      }
    }
    fixed = adjustRelativeDate(fixed, text);
    newFields.due_date = fixed;
  }

  // support next step dates for opportunities as well
  if (newFields.next_step_date) {
    let baseIso = newFields.next_step_date;
    let baseDate = new Date(baseIso);
    if (isNaN(baseDate.getTime())) {
      const now = new Date();
      baseIso = now.toISOString();
      baseIso = adjustRelativeDate(baseIso, text);
    }
    let fixed = adjustTime(baseIso, text);
    if (!fixed) {
      if (/\bmorning\b/i.test(text)) {
        fixed = setHour(baseIso, 7);
      } else if (/\bafternoon\b/i.test(text)) {
        fixed = setHour(baseIso, 15);
      } else if (/\bevening\b/i.test(text)) {
        fixed = setHour(baseIso, 19);
      } else if (/\btonight\b/i.test(text)) {
        fixed = setHour(baseIso, 20);
      } else {
        fixed = setHour(baseIso, 0);
      }
    }
    fixed = adjustRelativeDate(fixed, text);
    newFields.next_step_date = fixed;
  }

  // post-process certain extracted values
  if (newFields.value !== undefined) {
    // turn currency-like strings into numbers
    const num = parseFloat(String(newFields.value).replace(/[^0-9.]/g, ''));
    if (!isNaN(num)) newFields.value = num;
  }
  if (newFields.probability !== undefined) {
    const num = parseFloat(String(newFields.probability).replace(/[^0-9.]/g, ''));
    if (!isNaN(num)) newFields.probability = num;
  }
  // support user writing "company" instead of company_name
  if (newFields.company && !newFields.company_name) {
    newFields.company_name = newFields.company;
    delete newFields.company;
  }
  if (newFields.company_name !== undefined) {
    // trim whitespace
    newFields.company_name = String(newFields.company_name).trim();
  }
  // normalize stage synonyms for opportunities (new labels: lead, in progress, won, lost)
  if (newFields.stage !== undefined) {
    const s = String(newFields.stage).toLowerCase().trim();
    if (s.startsWith('won') || s === 'win') {
      newFields.stage = 'won';
    } else if (s.startsWith('lost') || s === 'lose') {
      newFields.stage = 'lost';
    } else if (s.startsWith('prospect') || s === 'lead') {
      newFields.stage = 'lead';
    } else if (s.startsWith('qualif') || s === 'qual' || s === 'quali' || s.includes('progress')) {
      newFields.stage = 'in progress';
    } else {
      newFields.stage = s; // let the backend validate
    }
    // verify against allowed values; if invalid, keep original token as hint + ask again
    const allowed = ['lead','in progress','won','lost'];
    if (!allowed.includes(newFields.stage)) {
      newFields._raw_stage = s;
      delete newFields.stage;
    }
  }

  Object.assign(chatState.collectedFields, newFields);
  // if we're asking for advice and just got the company, run advice handler
  if (chatState.intent === 'advise_opportunity' && newFields.company_name) {
    await handleAdvice(chatState.collectedFields.company_name);
    return;
  }
  // if we got a stage now that is valid, remove any leftover raw hint
  if (chatState.collectedFields.stage && chatState.collectedFields._raw_stage) {
    delete chatState.collectedFields._raw_stage;
  }

  // non-managers can only assign to themselves; fill automatically instead of asking
  if (!isManager && chatState.missingFields.includes('assigned_to')) {
    chatState.collectedFields.assigned_to = 'me';
  }

  chatState.missingFields = getMissingFields(chatState.intent, chatState.collectedFields);

  // extra guard for opportunities: make sure company_name is never silently ignored
  if (chatState.intent === 'create_opportunity') {
    const comp = chatState.collectedFields.company_name;
    if (!comp || (typeof comp === 'string' && comp.trim() === '')) {
      if (!chatState.missingFields.includes('company_name')) {
        chatState.missingFields.push('company_name');
      }
    }
    // always ask about company first if it's missing
    if (chatState.missingFields.includes('company_name')) {
      chatState.missingFields = ['company_name', ...chatState.missingFields.filter(f => f !== 'company_name')];
    }
  }

  if (chatState.missingFields.length === 0) {
    const created = await finalizeCreation(chatState.intent, chatState.collectedFields);
    if (created) {
      resetConversation();
    } else {
      // if creation was aborted (e.g. missing company), recompute missingFields and continue
      chatState.missingFields = getMissingFields(chatState.intent, chatState.collectedFields);
      if (chatState.missingFields.length > 0) {
        chatState.awaitingField = chatState.missingFields[0];
        const question = await generateFollowUpQuestion(chatState.missingFields, chatState.collectedFields);
        appendAIMessage(question);
      }
    }
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
    { role: 'system', content: 'You are an assistant that analyzes user messages and returns ONLY one of: create_task, create_reminder, create_opportunity, advise_opportunity, or none.' },
    { role: 'user', content: `User message: "${text}"` }
  ];
  const response = await groqChat(messages, 50, 0);
  const match = response.match(/create_task|create_reminder|create_opportunity|advise_opportunity/);
  return match ? match[0] : 'none';
}

async function generateCasualReply(text) {
  const messages = [
    { role: 'system', content: 'You are a friendly, conversational AI assistant integrated into a CRM. You can chat casually, answer simple questions, and respond in a warm, human-like tone. If the user later wants to create a task, reminder, or opportunity you will steer them that way.' },
    { role: 'user', content: text }
  ];
  const response = await groqChat(messages, 150, 0.7);
  return response.trim();
}

async function extractFields(text, intent) {
  let fieldList;
  if (intent === 'create_task') {
    fieldList = TASK_REQUIRED_FIELDS;
  } else if (intent === 'create_reminder') {
    fieldList = REMINDER_REQUIRED_FIELDS;
  } else if (intent === 'create_opportunity') {
    // include optional ones too so we can capture next_step/notes if user provides them
    fieldList = OPPORTUNITY_REQUIRED_FIELDS.concat(['next_step', 'next_step_date', 'notes']);
  } else {
    fieldList = [];
  }
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
  let req;
  if (intent === 'create_task') {
    req = TASK_REQUIRED_FIELDS;
  } else if (intent === 'create_reminder') {
    req = REMINDER_REQUIRED_FIELDS;
  } else if (intent === 'create_opportunity') {
    req = OPPORTUNITY_REQUIRED_FIELDS;
  } else {
    req = [];
  }
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
    // special case: user gave something for stage but it was invalid
    if (field === 'stage' && collected._raw_stage) {
      return 'Hmm, I didn’t quite get the stage. Please tell me if it’s lead, in progress, won, or lost.';
    }
    switch (field) {
      // task/reminder fields
      case 'title':
        return 'Great! What should I call it?';
      case 'description':
        return 'And some quick details, please?';
      case 'due_date':
        return 'When would you like that completed by?';
      case 'reminder_date':
        return 'Alright, when should I remind you?';
      case 'priority':
        return 'Do you want to mark it low, medium, or high priority?';
      case 'assigned_to':
        if (!isManager) return 'It’ll default to you unless you say otherwise.';
        return 'Who should I assign this to?';
      // opportunity fields
      case 'name':
        return 'Great – what’s the opportunity called?';
      case 'company_name':
        return 'Which company are we talking about for this deal?';
      case 'value':
        return 'And roughly how much is it worth (in Ksh)?';
      case 'stage':
        return 'What stage is it at right now – lead, in progress, won, or lost?';
      case 'probability':
        return 'What would you say the chance of winning is, in percent?';
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
    return false;
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
      appendAIMessage(`Great! I’ve created the task "${taskData.title}" for you.`);
      if (typeof renderTasksView === 'function') renderTasksView();
      // close chat panel automatically
      const win = document.getElementById('ai-chat-window');
      if (win) win.classList.remove('active');
      return true;
    } catch (err) {
      appendAIMessage('Error creating task: ' + err.message);
      return false;
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
      appendAIMessage(`All set! Reminder "${reminderData.title}" is in the system.`);
      if (typeof renderRemindersView === 'function') renderRemindersView();
      // close chat panel automatically
      const winRem = document.getElementById('ai-chat-window');
      if (winRem) winRem.classList.remove('active');
      return true;
    } catch (err) {
      appendAIMessage('Error creating reminder: ' + err.message);
      return false;
    }
  } else if (intent === 'create_opportunity') {
    // ensure company_name present before attempting insert
    if (!fields.company_name || (typeof fields.company_name === 'string' && fields.company_name.trim() === '')) {
      appendAIMessage('I need a company name for the opportunity. Which company is it for?');
      // ask again and defer finalization
      chatState.intent = 'create_opportunity';
      chatState.awaitingField = 'company_name';
      return false;
    }

    // try to match company against existing data to normalize its name
    if (fields.company_name) {
      try {
        if (typeof window.findCompanyForOpportunity === 'function') {
          const match = window.findCompanyForOpportunity({ company_name: fields.company_name });
          if (match && match.name) {
            fields.company_name = match.name; // use canonical casing/spelling
          }
        }
      } catch (e) {
        console.error('company match failed', e);
      }
    }

    // ensure stage has some valid string; fallback to prospecting
    // map user-friendly stages back to DB enum values
    let stageVal = fields.stage || 'lead';
    if (stageVal === 'lead') stageVal = 'prospecting';
    if (stageVal === 'in progress') stageVal = 'qualification';
    if (stageVal === 'won') stageVal = 'closed-won';
    if (stageVal === 'lost') stageVal = 'closed-lost';
    const opportunityData = {
      user_id: currentUser.id,
      name: fields.name,
      company_name: fields.company_name || null,
      // company_id column not present in schema; we only store name
      value: fields.value != null ? parseFloat(fields.value) : null,
      probability: fields.probability != null ? parseFloat(fields.probability) : null,
      stage: stageVal,
      next_step: fields.next_step || null,
      next_step_date: fields.next_step_date ? normalizeAndEnsureYear(fields.next_step_date) : null,
      notes: fields.notes || null
      // competitors/mentioned_people not collected via chat presently
    };
    try {
      const result = await supabaseClient.from('opportunities').insert([opportunityData]);
      if (result.error) throw result.error;
      appendAIMessage(`Nice one! Opportunity "${opportunityData.name}" is now on the board.`);
      if (typeof renderOpportunityPipelineView === 'function') renderOpportunityPipelineView();
      const winOpp = document.getElementById('ai-chat-window');
      if (winOpp) winOpp.classList.remove('active');
      return true;
    } catch (err) {
      appendAIMessage('Error creating opportunity: ' + err.message);
      return false;
    }
  }
  return false;
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

function formatCasualText(text) {
  let out = text;
  // break before bold sections to make spec listings vertical
  out = out.replace(/\*\*(.*?)\*\*/g, '\n\n**$1**');
  // if the model returned a markdown-style table, convert to simple list
  if (out.includes('|')) {
    const lines = out.split('\n').map(l => l.trim()).filter(l => l && !/^\|[- ]+\|/.test(l));
    const cleaned = lines.map(l => l.replace(/\|/g, '').trim()).join('\n');
    out = cleaned;
  }
  // collapse multiple blank lines
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

function appendAIMessage(text) {
  const container = document.getElementById('ai-chat-messages');
  const msg = document.createElement('div');
  msg.className = 'ai-chat-message ai';
  msg.innerHTML = `<div class="ai-chat-bubble">${escapeHtml(formatCasualText(text))}</div>`;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

// similar to appendAIMessage but assumes html is safe and not escaped
function appendAIMessageHtml(html) {
  const container = document.getElementById('ai-chat-messages');
  const msg = document.createElement('div');
  msg.className = 'ai-chat-message ai';
  msg.innerHTML = `<div class="ai-chat-bubble">${html}</div>`;
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
