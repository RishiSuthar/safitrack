// aichat.js
// AI Chat Assistant for SafiTrack CRM
// Provides conversational interface to create tasks, reminders and opportunities.
// Relies on groq API via ai.js and existing task/reminder/opportunity logic in app.js

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
// Conversation state & flow
// ------------------------------------------------------------------

// helper to locate an existing opportunity by querying the database
async function findOpportunityForAdvice(text) {
  if (!text || !text.trim()) return null;
  try {
    // Use all meaningful tokens, not just the first word
    const tokens = extractMeaningfulTokens(text);
    const searchTokens = tokens.length
      ? tokens.slice(0, 4)
      : text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(t => t.length >= 2).slice(0, 3);
    if (!searchTokens.length) return null;

    // Search both company_name and name with every token in parallel
    const searches = searchTokens.map(token =>
      supabaseClient
        .from('opportunities')
        .select('*')
        .or(`company_name.ilike.%${token}%,name.ilike.%${token}%`)
        .limit(20)
    );
    const results = await Promise.all(searches);

    const seen = new Set();
    const candidates = [];
    for (const res of results) {
      for (const o of (res.data || [])) {
        if (!seen.has(o.id)) { seen.add(o.id); candidates.push(o); }
      }
    }
    if (!candidates.length) return null;

    // Pick best candidate by token overlap score
    let best = null, bestScore = 0;
    for (const o of candidates) {
      const combined = `${o.company_name || ''} ${o.name || ''}`.toLowerCase();
      const s = searchTokens.reduce((acc, t) => acc + (combined.includes(t) ? 1 : 0), 0);
      if (s > bestScore) { bestScore = s; best = o; }
    }
    return best;
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

// ------------------------------------------------------------------
// CRM Data Fetching Functions
// ------------------------------------------------------------------

// Extract search terms from the user's natural language query
async function extractSearchTerms(text) {
  try {
    const messages = [
      { role: 'system', content: 'Extract search keywords from the user message. Return strict JSON: {"search": "...", "company": "...", "person": "...", "filter": "..."}. Only include keys you can extract. "search" is the main search term, "company" is a company name if mentioned, "person" is a person name if mentioned, "filter" is any filter like type/stage/status. Return only JSON, no explanation.' },
      { role: 'user', content: text }
    ];
    const raw = await groqChat(messages, 80, 0);
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '{}');
    return parsed;
  } catch (e) {
    return { search: text };
  }
}

// ------------------------------------------------------------------
// Smart entity resolution helpers — no API call needed
// ------------------------------------------------------------------

// Strip stopwords and CRM jargon, return meaningful search tokens
function extractMeaningfulTokens(text) {
  const stopwords = new Set([
    'the','a','an','is','are','was','were','be','been','being','have','has','had',
    'do','does','did','will','would','could','should','may','might','shall','can',
    'i','me','my','we','our','you','your','he','him','his','she','her','it','its',
    'they','them','their','what','which','who','this','that','these','those',
    'and','but','or','nor','for','yet','so','at','by','in','of','on','to','up',
    'as','if','not','too','very','just','now','then','here','there','also',
    // CRM query filler words
    'tell','give','find','search','show','list','display','get','pull','fetch',
    'company','companies','deal','deals','opportunity','opportunities','opp','opps',
    'contact','contacts','client','clients','customer','customers','account','accounts',
    'information','info','details','overview','summary','status','update','data',
    'situation','latest','recent','current','know','please','check','look',
    'rundown','regarding','related','about','everything','anything','something',
    'how','what','give','see','with','from','into','upon','within','without','through'
  ]);
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, '') // smart quotes
    .replace(/[^a-z0-9\s\-]/g, ' ')
    .split(/\s+/)
    .map(t => t.replace(/^-+|-+$/g, ''))
    .filter(t => t.length >= 2 && !stopwords.has(t));
}

// CRM-wide parallel search across companies, opportunities and people.
// Returns ranked { companies, opportunities, people } arrays.
async function smartCRMSearch(text) {
  const tokens = extractMeaningfulTokens(text);
  if (!tokens.length) return { companies: [], opportunities: [], people: [] };

  const searchTokens = tokens.slice(0, 4);

  try {
    // For each token, fire three parallel queries (company, opp, person)
    const queries = searchTokens.flatMap(token => [
      supabaseClient.from('companies').select('id, name, company_type, address').or(`name.ilike.%${token}%`).limit(8),
      supabaseClient.from('opportunities').select('id, name, company_name, stage, value').or(`name.ilike.%${token}%,company_name.ilike.%${token}%`).limit(8),
      supabaseClient.from('people').select('id, name, email, job_title').or(`name.ilike.%${token}%`).limit(8)
    ]);
    const results = await Promise.all(queries);

    const seenC = new Set(), seenO = new Set(), seenP = new Set();
    const companies = [], opportunities = [], people = [];
    for (let i = 0; i < results.length; i++) {
      const type = i % 3; // 0=company, 1=opp, 2=person
      for (const r of (results[i].data || [])) {
        if (type === 0 && !seenC.has(r.id)) { seenC.add(r.id); companies.push(r); }
        if (type === 1 && !seenO.has(r.id)) { seenO.add(r.id); opportunities.push(r); }
        if (type === 2 && !seenP.has(r.id)) { seenP.add(r.id); people.push(r); }
      }
    }

    // Score by token overlap and sort best-first
    const score = (rec, fields) => fields.reduce((s, f) =>
      s + searchTokens.reduce((ss, t) => ss + ((rec[f] || '').toLowerCase().includes(t) ? 1 : 0), 0), 0);
    companies.sort((a, b) => score(b, ['name']) - score(a, ['name']));
    opportunities.sort((a, b) => score(b, ['name', 'company_name']) - score(a, ['name', 'company_name']));
    people.sort((a, b) => score(b, ['name', 'job_title']) - score(a, ['name', 'job_title']));

    return { companies, opportunities, people };
  } catch (err) {
    console.error('smartCRMSearch error', err);
    return { companies: [], opportunities: [], people: [] };
  }
}

// Fetch company data for AI context
async function fetchCompanyContext(text) {
  const terms = await extractSearchTerms(text);
  const searchTerm = terms.company || terms.search || '';

  try {
    // Get company count
    const { count: totalCount } = await supabaseClient
      .from('companies')
      .select('*', { count: 'exact', head: true });

    // Fetch companies matching search (or all if no search term)
    let query = supabaseClient
      .from('companies')
      .select('id, name, company_type, address, description, domain, company_categories(categories(name))')
      .order('name', { ascending: true })
      .limit(30);

    if (searchTerm && searchTerm.length > 1) {
      query = query.or(`name.ilike.%${searchTerm}%,address.ilike.%${searchTerm}%,company_type.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
    }

    if (terms.filter) {
      // Try to filter by company_type
      query = supabaseClient
        .from('companies')
        .select('id, name, company_type, address, description, domain, company_categories(categories(name))')
        .ilike('company_type', `%${terms.filter}%`)
        .order('name', { ascending: true })
        .limit(30);
    }

    const { data: companies, error } = await query;
    if (error) throw error;

    // For each company, get counts of people and opportunities
    const companyDetails = [];
    for (const c of (companies || []).slice(0, 20)) {
      const [peopleRes, oppsRes] = await Promise.all([
        supabaseClient.from('people').select('id', { count: 'exact', head: true }).eq('company_id', c.id),
        supabaseClient.from('opportunities').select('id, value', { count: 'exact', head: true }).ilike('company_name', `%${c.name}%`)
      ]);

      const categories = (c.company_categories || []).map(cc => cc.categories?.name).filter(Boolean).join(', ');
      companyDetails.push(
        `• ${c.name} | Type: ${c.company_type || 'N/A'} | Location: ${c.address || 'N/A'} | Industry: ${categories || 'N/A'} | Contacts: ${peopleRes.count || 0} | Deals: ${oppsRes.count || 0}`
      );
    }

    // Get type breakdown
    const typeBreakdown = {};
    (companies || []).forEach(c => {
      const t = c.company_type || 'Unspecified';
      typeBreakdown[t] = (typeBreakdown[t] || 0) + 1;
    });
    const typeLines = Object.entries(typeBreakdown).map(([t, n]) => `${t}: ${n}`).join(', ');

    const lines = [
      `Total companies in CRM: ${totalCount || 0}`,
      searchTerm ? `Companies matching "${searchTerm}": ${companies?.length || 0}` : `Showing first ${Math.min(20, companies?.length || 0)} companies`,
      `Type breakdown: ${typeLines}`,
      '',
      ...companyDetails
    ];

    return lines.join('\n');
  } catch (err) {
    console.error('fetchCompanyContext error', err);
    return 'Error fetching company data.';
  }
}

// Fetch people/contacts data for AI context
async function fetchPeopleContext(text) {
  const terms = await extractSearchTerms(text);
  const searchPerson = terms.person || terms.search || '';
  const searchCompany = terms.company || '';

  try {
    const { count: totalCount } = await supabaseClient
      .from('people')
      .select('*', { count: 'exact', head: true });

    let query = supabaseClient
      .from('people')
      .select('id, name, email, job_title, phone_numbers, company_id, companies(name)')
      .order('name', { ascending: true })
      .limit(30);

    if (searchPerson && searchPerson.length > 1) {
      query = query.or(`name.ilike.%${searchPerson}%,email.ilike.%${searchPerson}%,job_title.ilike.%${searchPerson}%`);
    }

    // If company mentioned, resolve and filter
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
          .select('id, name, email, job_title, phone_numbers, company_id, companies(name)')
          .in('company_id', ids)
          .order('name', { ascending: true })
          .limit(30);

        if (searchPerson && searchPerson.length > 1 && searchPerson !== searchCompany) {
          query = query.ilike('name', `%${searchPerson}%`);
        }
      }
    }

    const { data: people, error } = await query;
    if (error) throw error;

    const peopleLines = (people || []).map(p => {
      const companyName = p.companies?.name || 'No company';
      const phones = (p.phone_numbers && p.phone_numbers.length) ? p.phone_numbers.join(', ') : 'N/A';
      return `• ${p.name} | ${p.job_title || 'No title'} | ${companyName} | Email: ${p.email || 'N/A'} | Phone: ${phones}`;
    });

    const lines = [
      `Total contacts in CRM: ${totalCount || 0}`,
      searchPerson || searchCompany
        ? `Contacts matching query: ${people?.length || 0}`
        : `Showing first ${Math.min(30, people?.length || 0)} contacts`,
      '',
      ...peopleLines
    ];

    return lines.join('\n');
  } catch (err) {
    console.error('fetchPeopleContext error', err);
    return 'Error fetching people data.';
  }
}

// Fetch opportunities/pipeline data for AI context
async function fetchOpportunityContext(text) {
  const terms = await extractSearchTerms(text);
  const searchTerm = terms.company || terms.search || '';

  try {
    // Get all opportunities for summary stats
    let allQuery = supabaseClient
      .from('opportunities')
      .select('id, name, company_name, stage, value, probability, next_step, next_step_date, notes, created_at, updated_at')
      .order('value', { ascending: false })
      .limit(50);

    if (searchTerm && searchTerm.length > 1) {
      allQuery = allQuery.or(`name.ilike.%${searchTerm}%,company_name.ilike.%${searchTerm}%,stage.ilike.%${searchTerm}%,notes.ilike.%${searchTerm}%`);
    }

    const { data: opportunities, error } = await allQuery;
    if (error) throw error;

    const opps = opportunities || [];

    // Calculate pipeline metrics
    const totalValue = opps.reduce((sum, o) => sum + (parseFloat(o.value) || 0), 0);
    const openOpps = opps.filter(o => !['closed-won', 'closed-lost', 'won', 'lost'].includes((o.stage || '').toLowerCase()));
    const openValue = openOpps.reduce((sum, o) => sum + (parseFloat(o.value) || 0), 0);
    const weightedValue = opps.reduce((sum, o) => sum + ((parseFloat(o.value) || 0) * (parseFloat(o.probability) || 0) / 100), 0);

    // Stage breakdown
    const stageBreakdown = {};
    opps.forEach(o => {
      const s = o.stage || 'unknown';
      if (!stageBreakdown[s]) stageBreakdown[s] = { count: 0, value: 0 };
      stageBreakdown[s].count++;
      stageBreakdown[s].value += parseFloat(o.value) || 0;
    });
    const stageLines = Object.entries(stageBreakdown).map(
      ([s, d]) => `  ${s}: ${d.count} deals worth ${d.value.toLocaleString()}`
    );

    // Deals needing attention (overdue next steps)
    const now = new Date();
    const overdueDeals = opps.filter(o => {
      if (!o.next_step_date) return false;
      return new Date(o.next_step_date) < now && !['closed-won', 'closed-lost', 'won', 'lost'].includes((o.stage || '').toLowerCase());
    });

    // Top deals list
    const dealLines = opps.slice(0, 15).map(o => {
      const overdue = o.next_step_date && new Date(o.next_step_date) < now ? ' [OVERDUE]' : '';
      return `• ${o.name} | ${o.company_name || 'N/A'} | Stage: ${o.stage} | Value: ${(parseFloat(o.value) || 0).toLocaleString()} | Prob: ${o.probability || 0}% | Next: ${o.next_step || 'N/A'}${overdue}`;
    });

    const currency = (typeof orgCurrency !== 'undefined' && orgCurrency) || 'USD';
    const lines = [
      `Pipeline Overview (${currency}):`,
      `  Total deals: ${opps.length}`,
      `  Open deals: ${openOpps.length} worth ${openValue.toLocaleString()}`,
      `  Total pipeline: ${totalValue.toLocaleString()}`,
      `  Weighted pipeline: ${weightedValue.toLocaleString()}`,
      `  Deals with overdue actions: ${overdueDeals.length}`,
      '',
      'Stage breakdown:',
      ...stageLines,
      '',
      searchTerm ? `Deals matching "${searchTerm}":` : 'Top deals by value:',
      ...dealLines
    ];

    return lines.join('\n');
  } catch (err) {
    console.error('fetchOpportunityContext error', err);
    return 'Error fetching opportunity data.';
  }
}

// Fetch recent activity (visits, calls, notes) for AI context
async function fetchActivityContext(text) {
  const terms = await extractSearchTerms(text);
  const searchTerm = terms.company || terms.person || terms.search || '';

  try {
    // Fetch recent visits
    let visitsQuery = supabaseClient
      .from('visits')
      .select('id, company_name, contact_name, visit_type, notes, created_at, user:profiles(first_name, last_name)')
      .order('created_at', { ascending: false })
      .limit(15);

    if (searchTerm && searchTerm.length > 1) {
      visitsQuery = visitsQuery.or(`company_name.ilike.%${searchTerm}%,contact_name.ilike.%${searchTerm}%,notes.ilike.%${searchTerm}%`);
    }

    // Fetch recent call logs
    let callsQuery = supabaseClient
      .from('call_logs')
      .select('id, company_name, direction, outcome, notes, call_at, duration_minutes, people(name), profiles(first_name, last_name)')
      .order('call_at', { ascending: false })
      .limit(15);

    if (searchTerm && searchTerm.length > 1) {
      callsQuery = callsQuery.or(`company_name.ilike.%${searchTerm}%,notes.ilike.%${searchTerm}%`);
    }

    // Fetch recent notes
    let notesQuery = supabaseClient
      .from('notes')
      .select('id, title, body, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(10);

    if (searchTerm && searchTerm.length > 1) {
      notesQuery = notesQuery.or(`title.ilike.%${searchTerm}%,body.ilike.%${searchTerm}%`);
    }

    const [visitsRes, callsRes, notesRes] = await Promise.all([visitsQuery, callsQuery, notesQuery]);

    const visits = visitsRes.data || [];
    const calls = callsRes.data || [];
    const notes = notesRes.data || [];

    const visitLines = visits.map(v => {
      const rep = v.user ? `${v.user.first_name || ''} ${v.user.last_name || ''}`.trim() : '';
      const dateStr = new Date(v.created_at).toLocaleDateString();
      return `  • ${dateStr} — ${v.company_name || 'Unknown'} (${v.visit_type || 'visit'}) — Contact: ${v.contact_name || 'N/A'}${rep ? ` — Rep: ${rep}` : ''}${v.notes ? ` — Notes: ${v.notes.substring(0, 80)}` : ''}`;
    });

    const callLines = calls.map(c => {
      const contact = c.people?.name || 'Unknown';
      const rep = c.profiles ? `${c.profiles.first_name || ''} ${c.profiles.last_name || ''}`.trim() : '';
      const dateStr = new Date(c.call_at).toLocaleDateString();
      return `  • ${dateStr} — ${c.company_name || 'Unknown'} — ${c.direction || ''} call — Outcome: ${c.outcome || 'N/A'} — Contact: ${contact}${rep ? ` — Rep: ${rep}` : ''}${c.duration_minutes ? ` — ${c.duration_minutes}min` : ''}`;
    });

    const noteLines = notes.map(n => {
      const dateStr = new Date(n.updated_at || n.created_at).toLocaleDateString();
      const preview = (n.body || '').substring(0, 60).replace(/\n/g, ' ');
      return `  • ${dateStr} — ${n.title || 'Untitled'} — ${preview}`;
    });

    const lines = [
      `Recent Visits (${visits.length}):`,
      ...(visitLines.length ? visitLines : ['  No visits found']),
      '',
      `Recent Calls (${calls.length}):`,
      ...(callLines.length ? callLines : ['  No call logs found']),
      '',
      `Recent Notes (${notes.length}):`,
      ...(noteLines.length ? noteLines : ['  No notes found'])
    ];

    return lines.join('\n');
  } catch (err) {
    console.error('fetchActivityContext error', err);
    return 'Error fetching activity data.';
  }
}

// Fetch all CRM data for a specific company (deep dive)
async function fetchCompanyDeepContext(companyName) {
  if (!companyName || !companyName.trim()) return 'No company name provided.';

  try {
    // Find the company (fuzzy match, best hit)
    const { data: companies, error: compError } = await supabaseClient
      .from('companies')
      .select('id, name, company_type, address, description, domain, company_categories(categories(name))')
      .ilike('name', `%${companyName.trim()}%`)
      .limit(3);

    if (compError) throw compError;
    if (!companies || !companies.length) return `No company found matching "${companyName}".`;

    // Pick best match by scoring token overlap (not just alphabetical first)
    const qLow = companyName.trim().toLowerCase();
    const qTokens = extractMeaningfulTokens(companyName).concat([qLow]);
    let best = companies[0], bestScore = -1;
    for (const c of companies) {
      const cLow = c.name.toLowerCase();
      let s = qTokens.reduce((acc, t) => acc + (cLow.includes(t) ? 1 : 0), 0);
      if (cLow === qLow) s += 10;
      else if (cLow.startsWith(qLow)) s += 5;
      if (s > bestScore) { bestScore = s; best = c; }
    }
    const company = best;
    const companyId = company.id;
    const canonicalName = company.name;
    const categories = (company.company_categories || []).map(cc => cc.categories?.name).filter(Boolean).join(', ');

    // Fetch all related data in parallel
    const [peopleRes, oppsRes, visitsRes, callsRes, tasksRes, remindersRes] = await Promise.all([
      supabaseClient
        .from('people')
        .select('id, name, email, job_title, phone_numbers')
        .eq('company_id', companyId)
        .order('name', { ascending: true }),
      supabaseClient
        .from('opportunities')
        .select('id, name, stage, value, probability, next_step, next_step_date, notes, created_at')
        .ilike('company_name', `%${canonicalName}%`)
        .order('value', { ascending: false })
        .limit(20),
      supabaseClient
        .from('visits')
        .select('id, contact_name, visit_type, notes, created_at, user:profiles(first_name, last_name)')
        .ilike('company_name', `%${canonicalName}%`)
        .order('created_at', { ascending: false })
        .limit(12),
      supabaseClient
        .from('call_logs')
        .select('id, direction, outcome, notes, call_at, duration_minutes, people(name), profiles(first_name, last_name)')
        .ilike('company_name', `%${canonicalName}%`)
        .order('call_at', { ascending: false })
        .limit(12),
      supabaseClient
        .from('tasks')
        .select('id, title, status, due_date, priority')
        .ilike('title', `%${canonicalName}%`)
        .neq('status', 'completed')
        .limit(10),
      supabaseClient
        .from('reminders')
        .select('id, title, reminder_date, is_completed')
        .ilike('title', `%${canonicalName}%`)
        .eq('is_completed', false)
        .limit(5)
    ]);

    const people = peopleRes.data || [];
    const opps = oppsRes.data || [];
    const visits = visitsRes.data || [];
    const calls = callsRes.data || [];
    const tasks = tasksRes.data || [];
    const reminders = remindersRes.data || [];
    const now = new Date();
    const currency = (typeof orgCurrency !== 'undefined' && orgCurrency) || 'USD';

    const lines = [
      `Company: ${canonicalName}`,
      `Type: ${company.company_type || 'N/A'}`,
      `Location: ${company.address || 'N/A'}`,
      `Industry: ${categories || 'N/A'}`,
      company.description ? `Description: ${company.description}` : null,
    ].filter(Boolean);

    // Contacts
    lines.push(`\nContacts (${people.length}):`);
    if (people.length) {
      people.forEach(p => {
        const phone = (p.phone_numbers && p.phone_numbers.length) ? p.phone_numbers[0] : 'N/A';
        lines.push(`  • ${p.name} — ${p.job_title || 'No title'} — ${p.email || 'No email'} — ${phone}`);
      });
    } else {
      lines.push('  No contacts on record');
    }

    // Deals / Pipeline
    const openOpps = opps.filter(o => !['closed-won', 'closed-lost', 'won', 'lost'].includes((o.stage || '').toLowerCase()));
    const wonOpps = opps.filter(o => ['closed-won', 'won'].includes((o.stage || '').toLowerCase()));
    const totalPipeline = openOpps.reduce((s, o) => s + (parseFloat(o.value) || 0), 0);
    lines.push(`\nDeals/Opportunities (${opps.length} total — ${openOpps.length} open, ${wonOpps.length} won):`);
    lines.push(`  Open pipeline value: ${currency} ${totalPipeline.toLocaleString()}`);
    if (opps.length) {
      opps.slice(0, 10).forEach(o => {
        const overdueFlag = o.next_step_date && new Date(o.next_step_date) < now ? ' [OVERDUE NEXT STEP]' : '';
        lines.push(`  • ${o.name} — ${o.stage} — ${currency} ${(parseFloat(o.value) || 0).toLocaleString()} — Prob: ${o.probability || 0}% — Next: ${o.next_step || 'N/A'}${overdueFlag}`);
      });
    } else {
      lines.push('  No deals on record');
    }

    // Recent visits
    lines.push(`\nRecent Visits (${visits.length}):`);
    if (visits.length) {
      visits.forEach(v => {
        const rep = v.user ? `${v.user.first_name || ''} ${v.user.last_name || ''}`.trim() : '';
        const dateStr = new Date(v.created_at).toLocaleDateString();
        const notesSnip = v.notes ? ` — "${v.notes.substring(0, 100)}"` : '';
        lines.push(`  • ${dateStr} — ${v.visit_type || 'visit'} — Contact: ${v.contact_name || 'N/A'}${rep ? ` — Rep: ${rep}` : ''}${notesSnip}`);
      });
    } else {
      lines.push('  No visits on record');
    }

    // Recent calls
    lines.push(`\nRecent Calls (${calls.length}):`);
    if (calls.length) {
      calls.forEach(c => {
        const contact = c.people?.name || 'Unknown';
        const rep = c.profiles ? `${c.profiles.first_name || ''} ${c.profiles.last_name || ''}`.trim() : '';
        const dateStr = new Date(c.call_at).toLocaleDateString();
        const notesSnip = c.notes ? ` — "${c.notes.substring(0, 80)}"` : '';
        lines.push(`  • ${dateStr} — ${c.direction || ''} ${c.outcome || ''} — Contact: ${contact}${rep ? ` — Rep: ${rep}` : ''}${c.duration_minutes ? ` — ${c.duration_minutes}min` : ''}${notesSnip}`);
      });
    } else {
      lines.push('  No calls on record');
    }

    // Active tasks
    if (tasks.length) {
      lines.push(`\nActive Tasks (${tasks.length}):`);
      tasks.forEach(t => {
        const overdueFlag = t.due_date && new Date(t.due_date) < now ? ' [OVERDUE]' : '';
        lines.push(`  • ${t.title} — Priority: ${t.priority || 'medium'} — Due: ${t.due_date ? new Date(t.due_date).toLocaleDateString() : 'N/A'}${overdueFlag}`);
      });
    }

    // Active reminders
    if (reminders.length) {
      lines.push(`\nActive Reminders (${reminders.length}):`);
      reminders.forEach(r => {
        lines.push(`  • ${r.title} — Due: ${r.reminder_date ? new Date(r.reminder_date).toLocaleDateString() : 'N/A'}`);
      });
    }

    return lines.join('\n');
  } catch (err) {
    console.error('fetchCompanyDeepContext error', err);
    return 'Error fetching company data.';
  }
}

// Fetch tasks data for AI context
async function fetchTasksContext(text) {
  const terms = await extractSearchTerms(text);
  const searchTerm = terms.search || terms.company || terms.person || '';

  try {
    const now = new Date();
    const isOverdue = /overdue|past due|late|missed/i.test(text);
    const isHighPriority = /high.?priority|urgent|important/i.test(text);
    const isMine = /my tasks?|assigned to me|mine/i.test(text);

    let query = supabaseClient
      .from('tasks')
      .select('id, title, description, status, due_date, priority, assigned_to, profiles!tasks_assigned_to_fkey(first_name, last_name)')
      .neq('status', 'completed')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(40);

    if (isHighPriority) query = query.eq('priority', 'high');
    if (isMine && currentUser) query = query.or(`assigned_to.eq.${currentUser.id}`);
    if (searchTerm && searchTerm.length > 1) query = query.ilike('title', `%${searchTerm}%`);

    const { data: tasks, error } = await query;
    if (error) throw error;

    const allTasks = tasks || [];
    const overdueTasks = allTasks.filter(t => t.due_date && new Date(t.due_date) < now);
    const dueTodayTasks = allTasks.filter(t => {
      if (!t.due_date) return false;
      const d = new Date(t.due_date);
      return d.toDateString() === now.toDateString();
    });
    const highPriorityTasks = allTasks.filter(t => t.priority === 'high');

    const display = isOverdue ? overdueTasks : allTasks;
    const taskLines = display.slice(0, 25).map(t => {
      const assignee = t.profiles ? `${t.profiles.first_name || ''} ${t.profiles.last_name || ''}`.trim() : 'Unassigned';
      const overdueFlag = t.due_date && new Date(t.due_date) < now ? ' [OVERDUE]' : '';
      const dueDate = t.due_date ? new Date(t.due_date).toLocaleDateString() : 'No due date';
      return `  • ${t.title} — Priority: ${t.priority || 'medium'} — Due: ${dueDate} — Assigned: ${assignee}${overdueFlag}`;
    });

    const lines = [
      `Tasks Overview:`,
      `  Total open: ${allTasks.length}`,
      `  Overdue: ${overdueTasks.length}`,
      `  Due today: ${dueTodayTasks.length}`,
      `  High priority: ${highPriorityTasks.length}`,
      '',
      searchTerm ? `Tasks matching "${searchTerm}":` : (isOverdue ? 'Overdue tasks:' : 'All open tasks:'),
      ...taskLines
    ];

    return lines.join('\n');
  } catch (err) {
    console.error('fetchTasksContext error', err);
    return 'Error fetching tasks data.';
  }
}

// Fetch full CRM summary for AI context
async function fetchCRMSummary() {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      companiesCount,
      peopleCount,
      oppsRes,
      tasksRes,
      remindersRes,
      visitsWeek,
      callsWeek
    ] = await Promise.all([
      supabaseClient.from('companies').select('*', { count: 'exact', head: true }),
      supabaseClient.from('people').select('*', { count: 'exact', head: true }),
      supabaseClient.from('opportunities').select('id, name, company_name, stage, value, probability, next_step_date').limit(200),
      supabaseClient.from('tasks').select('id, title, status, due_date, priority').neq('status', 'completed').limit(50),
      supabaseClient.from('reminders').select('id, title, is_completed, reminder_date').eq('is_completed', false).limit(50),
      supabaseClient.from('visits').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
      supabaseClient.from('call_logs').select('id', { count: 'exact', head: true }).gte('call_at', weekAgo)
    ]);

    const opps = oppsRes.data || [];
    const tasks = tasksRes.data || [];
    const reminders = remindersRes.data || [];

    // Pipeline metrics
    const openOpps = opps.filter(o => !['closed-won', 'closed-lost', 'won', 'lost'].includes((o.stage || '').toLowerCase()));
    const wonOpps = opps.filter(o => ['closed-won', 'won'].includes((o.stage || '').toLowerCase()));
    const totalPipeline = openOpps.reduce((s, o) => s + (parseFloat(o.value) || 0), 0);
    const wonValue = wonOpps.reduce((s, o) => s + (parseFloat(o.value) || 0), 0);
    const weightedPipeline = openOpps.reduce((s, o) => s + ((parseFloat(o.value) || 0) * (parseFloat(o.probability) || 0) / 100), 0);

    // Stage breakdown
    const stages = {};
    opps.forEach(o => { const s = o.stage || 'unknown'; stages[s] = (stages[s] || 0) + 1; });
    const stageLines = Object.entries(stages).map(([s, n]) => `  ${s}: ${n}`);

    // Overdue items
    const overdueTasks = tasks.filter(t => t.due_date && new Date(t.due_date) < now);
    const overdueReminders = reminders.filter(r => r.reminder_date && new Date(r.reminder_date) < now);
    const overdueDeals = openOpps.filter(o => o.next_step_date && new Date(o.next_step_date) < now);

    // Tasks by priority
    const highPriority = tasks.filter(t => t.priority === 'high');

    const currency = (typeof orgCurrency !== 'undefined' && orgCurrency) || 'USD';
    const lines = [
      `CRM Overview:`,
      `  Companies: ${companiesCount.count || 0}`,
      `  Contacts: ${peopleCount.count || 0}`,
      `  Total opportunities: ${opps.length}`,
      `  Open deals: ${openOpps.length} worth ${currency} ${totalPipeline.toLocaleString()}`,
      `  Won deals: ${wonOpps.length} worth ${currency} ${wonValue.toLocaleString()}`,
      `  Weighted pipeline: ${currency} ${weightedPipeline.toLocaleString()}`,
      '',
      `Pipeline by stage:`,
      ...stageLines,
      '',
      `This week's activity:`,
      `  Visits: ${visitsWeek.count || 0}`,
      `  Calls: ${callsWeek.count || 0}`,
      '',
      `Pending items:`,
      `  Open tasks: ${tasks.length} (${highPriority.length} high priority)`,
      `  Active reminders: ${reminders.length}`,
      '',
      `Attention needed:`,
      `  Overdue tasks: ${overdueTasks.length}`,
      `  Overdue reminders: ${overdueReminders.length}`,
      `  Deals with overdue actions: ${overdueDeals.length}`
    ];

    return lines.join('\n');
  } catch (err) {
    console.error('fetchCRMSummary error', err);
    return 'Error fetching CRM summary.';
  }
}

// ------------------------------------------------------------------
// CRM Query Handlers
// ------------------------------------------------------------------

async function handleQueryCompanies(text) {
  const context = await fetchCompanyContext(text);
  lastCRMContext = context;

  const messages = [
    { role: 'system', content: `You are Safi AI, a smart CRM assistant. The user is asking about companies in their CRM. Below is the real data from their database. Present it in a clear, friendly, and insightful way. Use **bold** for company names. Use bullet points for lists. If showing numbers, highlight key stats. If they asked about a specific company, focus on that one with a richer summary. Keep it conversational and actionable — point out things they might care about (e.g. companies with no contacts, patterns in types). Max 300 words.` },
    { role: 'user', content: `User question: "${text}"\n\nCRM Company Data:\n${context}\n\nAnswer the user's question based on this data.` }
  ];
  const reply = await groqChat(messages, 400, 0.6);
  appendAIMessage(reply);
}

async function handleQueryPeople(text) {
  const context = await fetchPeopleContext(text);
  lastCRMContext = context;

  const messages = [
    { role: 'system', content: `You are Safi AI, a smart CRM assistant. The user is asking about contacts/people in their CRM. Below is the real data from their database. Present it clearly and helpfully. Use **bold** for names. Use bullet points. Highlight useful patterns (e.g. contacts without emails, key decision-makers by title). Keep it conversational and concise. Max 300 words.` },
    { role: 'user', content: `User question: "${text}"\n\nCRM People Data:\n${context}\n\nAnswer the user's question based on this data.` }
  ];
  const reply = await groqChat(messages, 400, 0.6);
  appendAIMessage(reply);
}

async function handleQueryOpportunities(text) {
  const context = await fetchOpportunityContext(text);
  lastCRMContext = context;

  const messages = [
    { role: 'system', content: `You are Safi AI, a sharp CRM and sales assistant. The user is asking about their deals/pipeline. Below is the real data. Present pipeline stats clearly, highlight key metrics with **bold**, use bullet points for deal lists. Be insightful — call out stuck deals, overdue actions, biggest opportunities. If they asked about specific deals or stages, focus there. Use the actual numbers. Keep it actionable. Max 350 words.` },
    { role: 'user', content: `User question: "${text}"\n\nPipeline Data:\n${context}\n\nAnswer the user's question based on this real data.` }
  ];
  const reply = await groqChat(messages, 450, 0.6);
  appendAIMessage(reply);
}

async function handleQueryActivity(text) {
  const context = await fetchActivityContext(text);
  lastCRMContext = context;

  const messages = [
    { role: 'system', content: `You are Safi AI, a helpful CRM assistant. The user is asking about recent activity — visits, calls, and notes. Below is the real data. Summarize the activity in a clear, timeline-friendly way. Use **bold** for company and contact names. Group by type if helpful. Highlight patterns (e.g. most visited company, call outcomes). Keep it conversational. Max 300 words.` },
    { role: 'user', content: `User question: "${text}"\n\nActivity Data:\n${context}\n\nAnswer the user's question based on this data.` }
  ];
  const reply = await groqChat(messages, 400, 0.6);
  appendAIMessage(reply);
}

async function handleQueryCompanyDeep(text) {
  // Step 1: Run smart CRM-wide search immediately — no Groq round-trip needed
  const searchResults = await smartCRMSearch(text);

  // Step 2: If we found companies, use the best match
  if (searchResults.companies.length) {
    const bestCompany = searchResults.companies[0].name;
    const context = await fetchCompanyDeepContext(bestCompany);
    if (!context.startsWith('No company found') && !context.startsWith('Error')) {
      lastCRMContext = context;
      const messages = [
        { role: 'system', content: `You are Safi AI, a sharp CRM assistant. The user wants a full overview of a specific company. Below is all the CRM data for that company — contacts, deals, visits, calls, tasks. Present it in a well-organized, insightful way. Use **bold** for the company name and key numbers. Use **bold section headers** like **Contacts**, **Pipeline**, **Recent Activity**, **Tasks**. Highlight actionable insights: overdue next steps, open pipeline value, visit frequency, key contacts. Be concise but thorough. Max 500 words.` },
        { role: 'user', content: `User question: "${text}"\n\nFull company data from CRM:\n${context}\n\nGive a comprehensive, insightful company overview.` }
      ];
      const reply = await groqChat(messages, 650, 0.6);
      appendAIMessage(reply);
      return;
    }
  }

  // Step 3: No company matched — try opportunities if found
  if (searchResults.opportunities.length && !searchResults.companies.length) {
    await handleQueryOpportunities(text);
    return;
  }

  // Step 4: Nothing found at all — ask the user
  appendAIMessage("Which company are you asking about? Just give me the name and I'll pull up everything we have on them.");
  chatState.intent = 'query_company_deep';
  chatState.awaitingField = 'company_name';
}

async function handleQueryTasks(text) {
  const context = await fetchTasksContext(text);
  lastCRMContext = context;

  const messages = [
    { role: 'system', content: `You are Safi AI, a helpful CRM assistant. The user is asking about tasks. Below is the real task data. Present it in a clear, actionable way. Use **bold** for task names. Flag overdue items with urgency. Group by priority if there are many tasks. Be practical and motivating — not just a dry list. Max 300 words.` },
    { role: 'user', content: `User question: "${text}"\n\nTask Data:\n${context}\n\nAnswer based on this real data.` }
  ];
  const reply = await groqChat(messages, 400, 0.6);
  appendAIMessage(reply);
}

async function handleCRMSummary(text) {
  const context = await fetchCRMSummary();
  lastCRMContext = context;

  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

  const messages = [
    { role: 'system', content: `You are Safi AI, a sharp and encouraging CRM assistant who acts like a trusted business advisor. The user wants a status update on their CRM/business. Below is the real data. Give a comprehensive but punchy overview. Structure it with clear sections (use **bold** headers). Lead with the overall health/vibe. Highlight wins, flag risks (overdue items, stuck deals). End with 2-3 specific recommended actions. Use bullet points. Be motivating but honest. Max 400 words.` },
    { role: 'user', content: `Today is ${dayOfWeek}, ${dateStr}. Here is the full CRM status:\n\n${context}\n\nGive a comprehensive, actionable CRM status update.` }
  ];
  const reply = await groqChat(messages, 500, 0.7);
  appendAIMessage(reply);
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

  if (chatState.intent === 'query_company_deep' && chatState.awaitingField === 'company_name') {
    delete chatState.awaitingField;
    await handleQueryCompanyDeep(text);
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

    // CRM data query intents — one-shot lookups
    if (chatState.intent === 'query_companies') {
      await handleQueryCompanies(text);
      resetConversation();
      return;
    }
    if (chatState.intent === 'query_people') {
      await handleQueryPeople(text);
      resetConversation();
      return;
    }
    if (chatState.intent === 'query_opportunities') {
      await handleQueryOpportunities(text);
      resetConversation();
      return;
    }
    if (chatState.intent === 'query_activity') {
      await handleQueryActivity(text);
      resetConversation();
      return;
    }
    if (chatState.intent === 'crm_summary') {
      await handleCRMSummary(text);
      resetConversation();
      return;
    }
    if (chatState.intent === 'query_company_deep') {
      await handleQueryCompanyDeep(text);
      resetConversation();
      return;
    }
    if (chatState.intent === 'query_tasks') {
      await handleQueryTasks(text);
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
- query_company_deep: user wants a detailed/comprehensive overview of ONE specific named company — contacts, deals, visits, call history, tasks (e.g. "tell me about Safaricom", "what's the situation with KCB Bank?", "give me a rundown on ABC Ltd", "how is our relationship with Equity?", "what do we know about Twiga Foods?", "show me everything on [company name]")
- query_companies: user is asking BROADLY about companies in the CRM — listing multiple, counting, filtering by type/location, or comparing (e.g. "how many companies do we have", "list our customers", "show me companies in Nairobi", "what types of companies do we work with")
- query_people: user is asking about people/contacts in the CRM — listing, counting, or querying contacts (e.g. "who works at Safaricom", "how many contacts do we have", "show me people without emails", "list contacts at KCB")
- query_opportunities: user is asking about the deals/pipeline — pipeline summary, deal counts, deal stages, values, stuck deals (e.g. "what's my pipeline looking like", "show me deals over 500K", "which deals are in prospecting", "deals closing this month", "pipeline summary")
- query_activity: user is asking about recent activity — visits, call logs, notes (e.g. "show me recent visits", "what calls were made this week", "my recent activity", "last visit to Safaricom")
- query_tasks: user is asking about tasks or to-dos — listing, filtering, overdue tasks (e.g. "what tasks do I have?", "show me overdue tasks", "what's on my to-do list", "high priority tasks", "pending tasks")
- crm_summary: user wants an overall CRM health check or status update across all data (e.g. "give me a status update", "how's business", "CRM overview", "give me the big picture")
- none: anything else (greetings, questions, general conversation)

Key rules:
- If the user says "create", "add", "make", "log", or "new" + opportunity/deal, it is ALWAYS create_opportunity, never advise_opportunity.
- If the user names ONE specific company and wants detailed info about it (contacts, history, deals), use query_company_deep.
- If the user asks broadly about companies (listing, counting, filtering), use query_companies.
- If the user asks about tasks/to-dos/reminders as a list, use query_tasks.
- If the user asks a QUESTION about companies/people/deals (not creating), use the query_* intents.
- If the user asks broadly about "the business" or "everything" or "status", use crm_summary.` },
    { role: 'user', content: `User message: "${text}"` }
  ];
  const response = await groqChat(messages, 20, 0);
  const match = response.match(/create_task|create_reminder|create_opportunity|advise_opportunity|today_agenda|find_contact|query_company_deep|query_companies|query_people|query_opportunities|query_activity|query_tasks|crm_summary/);
  return match ? match[0] : 'none';
}

async function generateCasualReply(text) {
  const businessKeywords = /\b(company|companies|deal|deals|pipeline|contact|contacts|client|clients|customer|customers|sales|revenue|target|quota|visit|visits|call|calls|opportunity|opportunities|lead|leads|prospect|report|business|performance|team|rep|reps|task|tasks|reminder)\b/i;
  let freshContext = '';

  if (businessKeywords.test(text)) {
    try {
      const searchResults = await smartCRMSearch(text);
      if (searchResults.companies.length) {
        const deepCtx = await fetchCompanyDeepContext(searchResults.companies[0].name);
        if (!deepCtx.startsWith('No company found') && !deepCtx.startsWith('Error')) {
          freshContext = `\n\n[CRM Data for ${searchResults.companies[0].name}:\n${deepCtx}]`;
          lastCRMContext = deepCtx; // keep for follow-ups
        }
      } else if (searchResults.opportunities.length) {
        const opp = searchResults.opportunities[0];
        freshContext = `\n\n[CRM Match: Opportunity "${opp.name}" — Company: ${opp.company_name || 'N/A'} — Stage: ${opp.stage} — Value: ${opp.value || 'N/A'}]`;
      } else if (searchResults.people.length) {
        const p = searchResults.people[0];
        freshContext = `\n\n[CRM Match: Contact "${p.name}" — ${p.job_title || 'No title'} — ${p.email || 'No email'}]`;
      }
      // Lightweight snapshot fallback only when no entity found AND no prior context exists
      if (!freshContext && !lastCRMContext) {
        const [companiesCount, peopleCount, oppsRes] = await Promise.all([
          supabaseClient.from('companies').select('*', { count: 'exact', head: true }),
          supabaseClient.from('people').select('*', { count: 'exact', head: true }),
          supabaseClient.from('opportunities').select('id, stage, value').limit(100)
        ]);
        const opps = oppsRes.data || [];
        const openOpps = opps.filter(o => !['closed-won', 'closed-lost', 'won', 'lost'].includes((o.stage || '').toLowerCase()));
        const pipelineValue = openOpps.reduce((s, o) => s + (parseFloat(o.value) || 0), 0);
        const currency = (typeof orgCurrency !== 'undefined' && orgCurrency) || 'USD';
        freshContext = `\n\n[CRM Context: ${companiesCount.count || 0} companies, ${peopleCount.count || 0} contacts, ${openOpps.length} open deals worth ${currency} ${pipelineValue.toLocaleString()} total pipeline]`;
      }
    } catch (e) { /* non-critical */ }
  }

  // Attach previous CRM data for follow-ups (e.g. "tell me more", "what about their contacts?")
  const prevContext = (!freshContext && lastCRMContext)
    ? `\n\n[CRM data from earlier in this conversation:\n${lastCRMContext.substring(0, 3000)}]`
    : '';

  // Build history-aware message array — exclude the current user turn (last entry) since
  // it's about to be added below with the enriched context attached
  const historyMessages = conversationHistory.slice(0, -1).slice(-10)
    .map(h => ({ role: h.role, content: h.content }));

  const hasContext = !!(freshContext || prevContext);
  const messages = [
    { role: 'system', content: `You are Safi AI, a warm, smart assistant embedded in a CRM used by sales teams. Talk like a knowledgeable colleague — friendly, natural, and helpful. Use contractions, be conversational, keep things concise. When listing items use markdown bullet points. Use **bold** for key terms. Never be stiff or robotic.${hasContext ? ' You have real CRM data available — answer precisely from it, citing specific names and numbers.' : ''} When answering follow-up questions, use the context of the full conversation above.` },
    ...historyMessages,
    { role: 'user', content: text + freshContext + prevContext }
  ];
  const response = await groqChat(messages, 350, 0.7);
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
    value: `the estimated deal value in ${(typeof orgCurrency !== 'undefined' && orgCurrency) || 'USD'}`,
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
