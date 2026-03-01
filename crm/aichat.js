// aichat.js
// AI Chat Assistant for SafiTrack CRM
// Provides conversational interface to create tasks, reminders and opportunities.
// Relies on groq API via ai.js and existing task/reminder/opportunity logic in app.js

// conversation state
let chatState = null;
// track the last message the user sent so retry can replay it
let lastUserMessage = '';

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
      appendAIMessage('Hey! What can I help you with today?');
    }
  }
  closeBtn.addEventListener('click', () => windowEl.classList.remove('active'));
  const newBtn = document.getElementById('ai-chat-new');
  if (newBtn) newBtn.addEventListener('click', () => {
    // clear messages and reset state
    document.getElementById('ai-chat-messages').innerHTML = '';
    resetConversation();
    appendAIMessage('Fresh start! What are we working on?');
  });

  sendBtn.addEventListener('click', onUserSubmit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onUserSubmit();
    }
  });

  // Action button delegation (copy, helpful, not-helpful, retry)
  const messagesEl = document.getElementById('ai-chat-messages');
  if (messagesEl) {
    messagesEl.addEventListener('click', async (e) => {
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
  }
  updateSendBtn();
  input.addEventListener('input', updateSendBtn);

  // Quick action chips
  const quickActions = document.getElementById('ai-chat-quick-actions');
  if (quickActions) {
    quickActions.addEventListener('click', (e) => {
      const chip = e.target.closest('.ai-chat-chip');
      if (!chip) return;
      const prompt = chip.dataset.prompt;
      if (!prompt) return;
      input.value = prompt;
      input.dispatchEvent(new Event('input'));
      onUserSubmit();
    });
  }
}

async function onUserSubmit() {
  const input = document.getElementById('ai-chat-input');
  const text = input.value.trim();
  if (!text) return;
  lastUserMessage = text;
  appendUserMessage(text);
  input.value = '';
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

// ------------------------------------------------------------------
// Today's Agenda handler
// ------------------------------------------------------------------
async function handleTodayAgenda() {
  if (!currentUser || !currentUser.id) {
    appendAIMessage("I can't pull your agenda right now — you don't seem to be logged in.");
    return;
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
  const todayDate = now.toISOString().split('T')[0];

  try {
    const [tasksRes, remindersRes, oppsRes] = await Promise.all([
      supabaseClient
        .from('tasks')
        .select('id, title, due_date, priority, status')
        .or(`assigned_to.eq.${currentUser.id},created_by.eq.${currentUser.id}`)
        .neq('status', 'completed')
        .lte('due_date', todayEnd)
        .not('due_date', 'is', null)
        .order('due_date', { ascending: true }),
      supabaseClient
        .from('reminders')
        .select('id, title, reminder_date, is_completed')
        .or(`assigned_to.eq.${currentUser.id},created_by.eq.${currentUser.id}`)
        .eq('is_completed', false)
        .lte('reminder_date', todayEnd)
        .not('reminder_date', 'is', null)
        .order('reminder_date', { ascending: true }),
      supabaseClient
        .from('opportunities')
        .select('id, name, company_name, stage, next_step, next_step_date')
        .eq('user_id', currentUser.id)
        .not('next_step_date', 'is', null)
        .lte('next_step_date', todayDate)
        .neq('stage', 'closed-won')
        .neq('stage', 'closed-lost')
        .order('next_step_date', { ascending: true })
    ]);

    const tasks = tasksRes.data || [];
    const reminders = remindersRes.data || [];
    const opps = oppsRes.data || [];

    if (!tasks.length && !reminders.length && !opps.length) {
      appendAIMessage("You're all clear today — no tasks due, no reminders, and no deal actions pending. Enjoy the breathing room! \ud83d\ude0a");
      return;
    }

    // build a plain-text summary for Groq to narrate
    const lines = [];
    if (tasks.length) {
      lines.push(`Tasks due today (${tasks.length}):`);
      tasks.forEach(t => {
        const overdue = new Date(t.due_date) < now ? ' [OVERDUE]' : '';
        lines.push(`  - ${t.title} (${t.priority || 'medium'} priority)${overdue}`);
      });
    }
    if (reminders.length) {
      lines.push(`Reminders today (${reminders.length}):`);
      reminders.forEach(r => {
        const time = new Date(r.reminder_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        lines.push(`  - ${r.title} at ${time}`);
      });
    }
    if (opps.length) {
      lines.push(`Deal actions due today (${opps.length}):`);
      opps.forEach(o => {
        lines.push(`  - ${o.name} (${o.company_name}): ${o.next_step || 'follow-up needed'}`);
      });
    }

    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
    const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

    const messages = [
      { role: 'system', content: 'You are Safi AI, a warm CRM assistant. Summarise the user\'s day in a friendly, conversational way. Use **bold** for task/reminder names, bullet points for lists. Keep it punchy — lead with the overall vibe (busy, manageable, clear) then list what\'s on. Mention overdue items with a gentle nudge. Max 200 words.' },
      { role: 'user', content: `Today is ${dayOfWeek}, ${dateStr}. Here is the user's agenda data:\n\n${lines.join('\n')}\n\nGive them a natural, friendly rundown of their day.` }
    ];
    const reply = await groqChat(messages, 300, 0.7);
    appendAIMessage(reply);
  } catch (err) {
    console.error('handleTodayAgenda error', err);
    appendAIMessage("Hmm, I had trouble fetching your agenda. Try again in a sec.");
  }
}

// ------------------------------------------------------------------
// Find Contact handler
// ------------------------------------------------------------------
async function handleFindContact(text) {
  if (!currentUser || !currentUser.id) {
    appendAIMessage("I can't search contacts right now — you don't seem to be logged in.");
    return;
  }

  // extract name and optional company hint from the message using Groq
  const extractMsg = [
    { role: 'system', content: 'Extract the person\'s name and optionally a company name from the message. Return strict JSON: {"name": "...", "company": "..."} — omit company key if not mentioned. Return only JSON, no explanation.' },
    { role: 'user', content: text }
  ];
  let searchName = '', searchCompany = '';
  try {
    const raw = await groqChat(extractMsg, 60, 0);
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '{}');
    searchName = (parsed.name || '').trim();
    searchCompany = (parsed.company || '').trim();
  } catch (e) {
    // fallback: strip common words and use remainder as name
    searchName = text.replace(/\b(find|look up|search|who is|who's|contact|person)\b/gi, '').trim();
  }

  if (!searchName) {
    appendAIMessage("Who are you looking for? Just give me a name and I'll search the CRM.");
    chatState.intent = 'find_contact';
    chatState.awaitingField = 'contact_name';
    return;
  }

  try {
    // join with companies table to get the company name
    let query = supabaseClient
      .from('people')
      .select('id, name, email, job_title, phone_numbers, companies(name)')
      .ilike('name', `%${searchName}%`)
      .limit(10);

    // if a company was mentioned, resolve its id first then filter
    if (searchCompany) {
      const { data: companyMatches } = await supabaseClient
        .from('companies')
        .select('id')
        .ilike('name', `%${searchCompany}%`)
        .limit(5);
      if (companyMatches && companyMatches.length) {
        const ids = companyMatches.map(c => c.id);
        query = supabaseClient
          .from('people')
          .select('id, name, email, job_title, phone_numbers, companies(name)')
          .ilike('name', `%${searchName}%`)
          .in('company_id', ids)
          .limit(10);
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    if (!data || !data.length) {
      appendAIMessage(`I couldn't find anyone named **"${searchName}"** in the CRM${searchCompany ? ` at ${searchCompany}` : ''}. Want to double-check the spelling or try a partial name?`);
      return;
    }

    // build contact summary for Groq to narrate
    const contactLines = data.map(p => {
      const parts = [`Name: ${p.name}`];
      if (p.job_title) parts.push(`Title: ${p.job_title}`);
      const companyName = p.companies?.name;
      if (companyName) parts.push(`Company: ${companyName}`);
      if (p.email) parts.push(`Email: ${p.email}`);
      if (p.phone_numbers && p.phone_numbers.length) parts.push(`Phone: ${p.phone_numbers[0]}`);
      return parts.join(', ');
    }).join('\n');

    const messages = [
      { role: 'system', content: 'You are Safi AI, a friendly CRM assistant. Present the contact results in a clean, readable way. Use **bold** for names, show key details in a compact format. If multiple contacts found, list them clearly. If just one, give a slightly richer summary. Keep it conversational — no corporate-speak.' },
      { role: 'user', content: `The user searched for "${searchName}"${searchCompany ? ` at "${searchCompany}"` : ''}. Here are the results:\n\n${contactLines}\n\nPresent this naturally.` }
    ];
    const reply = await groqChat(messages, 250, 0.6);
    appendAIMessage(reply);
  } catch (err) {
    console.error('handleFindContact error', err);
    appendAIMessage("Something went wrong while searching. Give it another try.");
  }
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
    appendAIMessage("Hmm, I couldn't find a match for that one. Could you give me the company name or the exact opportunity name so I can pull it up?");
    chatState.intent = 'advise_opportunity';
    chatState.awaitingField = 'company_name';
    return;
  }
  // compose guidance prompt
  const messages = [
    { role: 'system', content: 'You are Safi AI, a sharp and encouraging sales coach inside a CRM. Talk like a trusted advisor who genuinely wants the rep to win the deal. Be direct and practical — no fluff. Use bullet points (- item) for action steps, **bold** for the most important phrases. Keep it punchy and motivating.' },
    { role: 'user', content: `Here's the deal:\nName: ${opp.name}\nCompany: ${opp.company_name}\nStage: ${opp.stage}\nValue: ${opp.value}\nProbability: ${opp.probability}\nNotes: ${opp.notes || 'none'}\n\nGive me 3 clear, specific actions I can take right now to move this deal forward and close it.` }
  ];
  const reply = await groqChat(messages, 200, 0.7);
  appendAIMessage(reply);
  resetConversation();
}


async function handleUserMessage(text) {
  if (!chatState) resetConversation();

  // handle continuation of one-shot intents that needed a follow-up
  if (chatState.intent === 'find_contact' && chatState.awaitingField === 'contact_name') {
    delete chatState.awaitingField;
    await handleFindContact(text);
    resetConversation();
    return;
  }

  if (!chatState.intent) {
    const intent = await detectIntent(text);
    if (intent === 'none') {
      // casual message only; conversation state remains reset
      const reply = await generateCasualReply(text);
      appendAIMessage(reply);
      return;
    }
    chatState.intent = intent;
    chatState.isFirstTurn = true;

    // if the intent is advice, handle immediately
    if (chatState.intent === 'advise_opportunity') {
      await handleAdvice(text);
      return;
    }

    // one-shot lookup intents — handle immediately, no further state needed
    if (chatState.intent === 'today_agenda') {
      await handleTodayAgenda();
      resetConversation();
      return;
    }
    if (chatState.intent === 'find_contact') {
      await handleFindContact(text);
      resetConversation();
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
        const openingQ = await generateFollowUpQuestion(['company_name'], chatState.collectedFields);
        appendAIMessage(openingQ);
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
    missingFields: [],
    isFirstTurn: false
  };
}

// ------------------------------------------------------------------
// Groq helpers for understanding
// ------------------------------------------------------------------

async function detectIntent(text) {
  const messages = [
    { role: 'system', content: `You classify user messages into exactly one of these intents. Return ONLY the intent label, nothing else.

Intents:
- create_task: user wants to add/create/make a new task (e.g. "create a task", "add a task", "make a task for me")
- create_reminder: user wants to set/add/create a new reminder (e.g. "remind me", "set a reminder", "add a reminder")
- create_opportunity: user wants to add/create/log/record a NEW deal or opportunity in the CRM (e.g. "add an opportunity", "create an opportunity", "log a new deal", "make an opportunity")
- advise_opportunity: user wants tips, advice, or strategy on how to WIN or progress an EXISTING deal (e.g. "how do I win the Safaricom deal", "help me with this opportunity", "how can I close [company]")
- today_agenda: user wants to know what they have on for today, their schedule, tasks due today, reminders today (e.g. "what's on my agenda", "what do I have today", "my day", "what's due today")
- find_contact: user wants to look up a person/contact in the CRM (e.g. "find John", "who is Jane at KCB", "look up David", "search for a contact")
- none: anything else (greetings, questions, general conversation)

Key rule: if the user says "create", "add", "make", "log", or "new" + opportunity/deal, it is ALWAYS create_opportunity, never advise_opportunity.` },
    { role: 'user', content: `User message: "${text}"` }
  ];
  const response = await groqChat(messages, 20, 0);
  const match = response.match(/create_task|create_reminder|create_opportunity|advise_opportunity|today_agenda|find_contact/);
  return match ? match[0] : 'none';
}

async function generateCasualReply(text) {
  const messages = [
    { role: 'system', content: 'You are Safi AI, a warm, smart assistant embedded in a CRM used by sales teams. Talk like a knowledgeable colleague — friendly, natural, and helpful. Use contractions, be conversational, and keep things concise. When listing items use markdown bullet points (- item) or numbered lists. Use **bold** for key terms. Use headings only when the response has clearly distinct sections. Never be stiff or robotic. Show genuine interest in helping.' },
    { role: 'user', content: text }
  ];
  const response = await groqChat(messages, 200, 0.7);
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
  const field = missingFields[0];
  if (!field) return "Is there anything else I can help you with?";

  if (field === 'stage' && collected._raw_stage) {
    return "Hmm, that stage didn’t quite register — is it a lead, in progress, won, or lost?";
  }

  const intent = chatState && chatState.intent;
  const intentLabels = {
    create_task: 'a task',
    create_reminder: 'a reminder',
    create_opportunity: 'an opportunity'
  };
  const intentLabel = intentLabels[intent] || 'this';

  const fieldDescriptions = {
    title: 'a short name or title for it',
    description: 'a brief description of what it involves',
    due_date: 'the due date (when it needs to be done)',
    reminder_date: 'when the reminder should go off',
    priority: 'the priority level — low, medium, or high',
    assigned_to: isManager ? 'who to assign it to' : null,
    name: 'a name for the opportunity',
    company_name: 'which company this deal is with',
    value: 'the estimated deal value in Ksh',
    stage: 'the current deal stage — lead, in progress, won, or lost',
    probability: 'the estimated win probability as a percentage'
  };

  const alreadyCollected = Object.entries(collected)
    .filter(([k, v]) => v !== undefined && v !== null && k !== '_raw_stage' && k !== 'isFirstTurn' && String(v).trim())
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
    .join(', ');

  const fieldDesc = fieldDescriptions[field] || field.replace(/_/g, ' ');

  const isFirst = chatState && chatState.isFirstTurn;
  if (chatState) chatState.isFirstTurn = false;

  const systemPrompt = `You are Safi AI, a warm, natural, and conversational assistant in a CRM app used by sales teams.
You’re helping a user create ${intentLabel}. Your job right now is to ask for one specific piece of information.
Rules:
- One sentence only
- Sound like a helpful colleague, not a form wizard
- Use contractions naturally (don’t, I’ll, let’s, you’re, etc.)
- Where relevant, reference context you already have (e.g. use the company name or title if known)
- Never say “I need” or “Please provide” — just ask naturally
- On follow-up questions (not the first one), skip filler affirmations — just get into it
- If this is the very first question for a new request, lead with a brief warm acknowledgment then ask (e.g. “Let’s get that sorted! Just need...” or “On it — which company is this deal with?”)`;

  const userPrompt = `${isFirst ? `The user just asked to create ${intentLabel}.` : `Continuing the conversation.`}
Context gathered so far: ${alreadyCollected || 'nothing yet'}.
Now ask naturally for: ${fieldDesc}.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
  const response = await groqChat(messages, 80, 0.85);
  return response.trim().replace(/^["']|["']$/g, '');
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
      appendAIMessage(`Done! **"${taskData.title}"** is on your task list. Go crush it!`);
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
      appendAIMessage(`You're all set! I'll remind you about **"${reminderData.title}"** — you won't miss it.`);
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
      appendAIMessage(`You're on it! **"${opportunityData.name}"** is live in your pipeline. Let's close that deal!`);
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
// UI rendering utilities + Markdown renderer – converts Groq markdown responses to safe HTML
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
