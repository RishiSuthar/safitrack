import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!GEMINI_API_KEY || !supabaseUrl || !anonKey || !serviceKey) {
      console.error('Missing required environment configuration');
      return json({ error: 'Missing required environment configuration on server' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Authentication required. Please log in to SafiTrack.' }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const userMessage: string = (body.message || '').trim();
    const history: ChatMessage[] = Array.isArray(body.history) ? body.history : [];

    if (!userMessage) {
      return json({ error: 'Message cannot be empty' }, 400);
    }

    // ── 1. Authenticate user & load profile ────────────────────────────────────
    const token = authHeader.replace('Bearer ', '').trim();
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !user) {
      console.error('User auth failed:', authErr);
      return json({ error: 'Invalid or expired session. Please refresh and log in again.' }, 401);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // Query profiles without join to avoid PostgREST foreign key cache issues
    const { data: profile, error: profErr } = await supabaseAdmin
      .from('profiles')
      .select('id, email, first_name, last_name, role, organization_id')
      .eq('id', user.id)
      .maybeSingle();

    if (profErr) {
      console.error('Profile lookup error:', profErr);
      return json({ error: `User profile lookup error: ${profErr.message}` }, 500);
    }

    if (!profile || !profile.organization_id) {
      console.warn('User missing organization_id:', profile);
      return json({ error: 'User does not belong to an active SafiTrack organization.' }, 403);
    }

    const orgId = profile.organization_id;
    const userRole = profile.role || 'sales_rep'; // 'manager', 'sales_rep', 'technician'
    const isManager = userRole === 'manager';
    const userName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || profile.email;
    const currency = 'KSh';

    let orgName = 'SafiTrack CRM';
    try {
      const { data: orgData } = await supabaseAdmin
        .from('organizations')
        .select('name')
        .eq('id', orgId)
        .maybeSingle();
      if (orgData?.name) orgName = orgData.name;
    } catch (e) {
      console.warn('Organization name lookup ignored:', e);
    }

    // ── 2. Read-Only Interceptor ──────────────────────────────────────────────
    const lowerMsg = userMessage.toLowerCase();
    const isExplicitWriteIntent =
      /\b(create|add|insert|make a new|log a new|set a new)\s+(task|reminder|opportunity|deal|company|customer|contact|visit|call|note|workflow)\b/i.test(lowerMsg) ||
      /\b(delete|remove|erase|drop|cancel)\s+(task|reminder|opportunity|deal|company|customer|contact|visit|call|note|workflow)\b/i.test(lowerMsg) ||
      /\b(update|edit|modify|change stage|mark as|complete)\s+(task|reminder|opportunity|deal|company|customer|contact|visit|call|note|workflow)\b/i.test(lowerMsg);

    const isQuestionAboutCreation = /\b(how many|who created|when was|what was|list of|show me|which)\b/i.test(lowerMsg);

    if (isExplicitWriteIntent && !isQuestionAboutCreation) {
      return json({
        reply: `SafAI is currently in **read-only** mode to keep your CRM data safe. I can analyze your pipeline, calculate totals, summarize customer records, and review your tasks, but I cannot create, edit, or delete records. You can perform this action directly in the corresponding CRM section.`,
        readOnly: true,
      });
    }

    // ── 3. Team Profiles (for mapping IDs -> names reliably) ──────────────────
    const { data: teamProfiles } = await supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name, email, role, status')
      .eq('organization_id', orgId);

    const profileMap = new Map<string, string>();
    (teamProfiles || []).forEach((p: any) => {
      profileMap.set(p.id, `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email || 'Team Member');
    });

    // ── 4. Determine Relevant CRM Domains ─────────────────────────────────────
    const hasWord = (regex: RegExp) => regex.test(lowerMsg);

    const wantsTasks = hasWord(/\b(task|tasks|todo|to-do|todos|pending|overdue|priority|prioritize|assigned)\b/);
    const wantsReminders = hasWord(/\b(reminder|reminders|remind|alert|alerts|remember)\b/);
    const wantsOpps = hasWord(/\b(opportunity|opportunities|deal|deals|pipeline|funnel|stage|revenue|value|closing|close|probability|forecast|biggest|win rate|won|lost)\b/);
    const wantsVisits = hasWord(/\b(visit|visits|visited|field|meeting|meetings|travel|fare)\b/);
    const wantsCalls = hasWord(/\b(call|calls|called|phone|outbound|inbound|outcome)\b/);
    const wantsNotes = hasWord(/\b(note|notes|discussed|summary of notes|discussion)\b/);
    const wantsWorkflows = hasWord(/\b(workflow|workflows|automation|automations|trigger|triggers)\b/);
    const wantsReports = hasWord(/\b(report|reports|performance|trend|trends|perform|metric|metrics|kpi|conversion|ranking|rep|reps|this month|this week|quarter)\b/);
    const wantsCompanies = hasWord(/\b(company|companies|customer|customers|client|clients|account|accounts)\b/);
    const wantsPeople = hasWord(/\b(contact|contacts|people|person|email|emails|phone numbers|job title)\b/);

    const isOverview = hasWord(/\b(focus on today|what should i do|what to do|agenda|status|overview|health|summary|big picture|how are we doing|how am i doing|need attention|needs attention|daily briefing)\b/);

    // Specific entity lookup: Extract proper noun candidates or words that might be company/person names
    const stopWords = new Set([
      'what', 'how', 'when', 'where', 'which', 'who', 'show', 'tell', 'give', 'list',
      'find', 'about', 'with', 'from', 'have', 'been', 'this', 'that', 'these', 'those',
      'today', 'week', 'month', 'year', 'overdue', 'pending', 'active', 'biggest',
      'opportunities', 'opportunity', 'deals', 'deal', 'tasks', 'task', 'pipeline',
      'calls', 'call', 'visits', 'visit', 'reminders', 'reminder', 'notes', 'note',
      'customer', 'customers', 'company', 'companies', 'contacts', 'contact', 'performance'
    ]);

    const words = lowerMsg.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
    let matchedCompany: any = null;

    if (words.length > 0) {
      // Check if any word matches a company name in the org
      for (const w of words.slice(0, 4)) {
        const { data: compHits } = await supabaseAdmin
          .from('companies')
          .select('id, name, company_type, address, description, domain')
          .eq('organization_id', orgId)
          .ilike('name', `%${w}%`)
          .limit(3);

        if (compHits && compHits.length > 0) {
          matchedCompany = compHits[0];
          break;
        }
      }
    }

    // ── 5. Query Data in Parallel (Strictly scoped to user's organization & role) ──
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const fetchTasks = isOverview || wantsTasks || Boolean(matchedCompany);
    const fetchReminders = isOverview || wantsReminders || Boolean(matchedCompany);
    const fetchOpps = isOverview || wantsOpps || wantsReports || Boolean(matchedCompany);
    const fetchVisits = isOverview || wantsVisits || wantsReports || Boolean(matchedCompany);
    const fetchCalls = isOverview || wantsCalls || wantsReports || Boolean(matchedCompany);
    const fetchNotes = isOverview || wantsNotes || Boolean(matchedCompany);
    const fetchWorkflows = wantsWorkflows;
    const fetchCompanies = wantsCompanies || isOverview;
    const fetchPeople = wantsPeople || Boolean(matchedCompany);

    // Build task query with role-based restriction if non-manager requests their tasks
    let tasksQuery = supabaseAdmin
      .from('tasks')
      .select('id, title, description, status, due_date, priority, assigned_to, created_by')
      .eq('organization_id', orgId)
      .neq('status', 'completed')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(60);

    if (!isManager && hasWord(/\b(my|mine|assigned to me)\b/)) {
      tasksQuery = tasksQuery.or(`assigned_to.eq.${user.id},created_by.eq.${user.id}`);
    }

    // Build reminders query
    let remindersQuery = supabaseAdmin
      .from('reminders')
      .select('id, title, description, reminder_date, is_completed, assigned_to')
      .eq('organization_id', orgId)
      .eq('is_completed', false)
      .order('reminder_date', { ascending: true, nullsFirst: false })
      .limit(40);

    if (!isManager && hasWord(/\b(my|mine|assigned to me)\b/)) {
      remindersQuery = remindersQuery.or(`assigned_to.eq.${user.id},created_by.eq.${user.id}`);
    }

    // Parallel queries without risky foreign key joins
    const [
      tasksRes,
      remindersRes,
      oppsRes,
      visitsRes,
      callsRes,
      notesRes,
      workflowsRes,
      companiesRes,
      peopleRes
    ] = await Promise.all([
      fetchTasks ? tasksQuery : Promise.resolve({ data: null, error: null }),
      fetchReminders ? remindersQuery : Promise.resolve({ data: null, error: null }),

      fetchOpps
        ? supabaseAdmin
            .from('opportunities')
            .select('id, name, company_name, stage, value, probability, next_step, next_step_date, notes, user_id, created_at, updated_at')
            .eq('organization_id', orgId)
            .order('value', { ascending: false, nullsFirst: false })
            .limit(100)
        : Promise.resolve({ data: null, error: null }),

      fetchVisits
        ? supabaseAdmin
            .from('visits')
            .select('id, company_name, contact_name, visit_type, notes, created_at, user_id')
            .eq('organization_id', orgId)
            .order('created_at', { ascending: false })
            .limit(50)
        : Promise.resolve({ data: null, error: null }),

      fetchCalls
        ? supabaseAdmin
            .from('call_logs')
            .select('id, company_name, direction, outcome, notes, call_at, duration_minutes, person_id, user_id')
            .eq('organization_id', orgId)
            .order('call_at', { ascending: false })
            .limit(50)
        : Promise.resolve({ data: null, error: null }),

      fetchNotes
        ? supabaseAdmin
            .from('notes')
            .select('id, title, body, created_at, updated_at')
            .eq('organization_id', orgId)
            .order('updated_at', { ascending: false })
            .limit(25)
        : Promise.resolve({ data: null, error: null }),

      fetchWorkflows
        ? supabaseAdmin
            .from('workflows')
            .select('id, name, description, is_active, trigger_type, actions, runs_count')
            .eq('organization_id', orgId)
            .order('created_at', { ascending: false })
            .limit(20)
        : Promise.resolve({ data: null, error: null }),

      fetchCompanies
        ? supabaseAdmin
            .from('companies')
            .select('id, name, company_type, address, domain', { count: 'exact' })
            .eq('organization_id', orgId)
            .limit(30)
        : Promise.resolve({ data: null, count: null, error: null }),

      fetchPeople
        ? supabaseAdmin
            .from('people')
            .select('id, name, email, job_title, phone_numbers, company_id', { count: 'exact' })
            .eq('organization_id', orgId)
            .limit(40)
        : Promise.resolve({ data: null, count: null, error: null })
    ]);

    // ── 6. Deterministic Backend Calculations ─────────────────────────────────
    const contextSections: string[] = [];

    // Context Header
    contextSections.push(`User: ${userName} (${userRole === 'manager' ? 'Sales Manager / Admin' : 'Sales Representative'})`);
    contextSections.push(`Organization: ${orgName} | Current Date: ${now.toISOString().split('T')[0]}`);

    // If specific company matched, build dedicated deep-dive profile
    if (matchedCompany) {
      const cName = matchedCompany.name;
      const cOpps = (oppsRes.data || []).filter((o: any) =>
        (o.company_name || '').toLowerCase().includes(cName.toLowerCase())
      );
      const cVisits = (visitsRes.data || []).filter((v: any) =>
        (v.company_name || '').toLowerCase().includes(cName.toLowerCase())
      );
      const cCalls = (callsRes.data || []).filter((c: any) =>
        (c.company_name || '').toLowerCase().includes(cName.toLowerCase())
      );
      const cPeople = (peopleRes.data || []).filter((p: any) =>
        p.company_id === matchedCompany.id || (cName && (p.name || '').toLowerCase().includes(cName.toLowerCase()))
      );

      const cOpenOpps = cOpps.filter((o: any) => !['closed-won', 'closed-lost', 'won', 'lost'].includes((o.stage || '').toLowerCase()));
      const cPipelineVal = cOpenOpps.reduce((s: number, o: any) => s + (parseFloat(o.value) || 0), 0);

      contextSections.push(`\n=== COMPANY OVERVIEW: ${cName} ===`);
      contextSections.push(`Type: ${matchedCompany.company_type || 'N/A'} | Location: ${matchedCompany.address || 'N/A'}`);
      if (matchedCompany.description) contextSections.push(`Description: ${matchedCompany.description}`);
      contextSections.push(`Contacts (${cPeople.length}): ${cPeople.map((p: any) => `${p.name} (${p.job_title || 'N/A'}, ${p.email || 'no email'})`).join('; ') || 'None on record'}`);
      contextSections.push(`Pipeline with ${cName}: ${cOpenOpps.length} open deals worth ${currency} ${cPipelineVal.toLocaleString()}`);
      if (cOpps.length > 0) {
        contextSections.push(`Deals:`);
        cOpps.forEach((o: any) => {
          contextSections.push(`  - ${o.name}: Stage ${o.stage}, ${currency} ${(parseFloat(o.value) || 0).toLocaleString()}, Prob ${o.probability || 0}%, Next: ${o.next_step || 'None'} (${o.next_step_date || 'No date'})`);
        });
      }
      if (cVisits.length > 0) {
        contextSections.push(`Recent Visits (${cVisits.length}):`);
        cVisits.slice(0, 5).forEach((v: any) => {
          const rep = profileMap.get(v.user_id) || 'Rep';
          contextSections.push(`  - ${new Date(v.created_at).toISOString().split('T')[0]} by ${rep}: ${v.visit_type} — "${(v.notes || '').substring(0, 100)}"`);
        });
      }
      if (cCalls.length > 0) {
        contextSections.push(`Recent Calls (${cCalls.length}):`);
        cCalls.slice(0, 5).forEach((c: any) => {
          contextSections.push(`  - ${new Date(c.call_at).toISOString().split('T')[0]}: ${c.direction} call, Outcome: ${c.outcome}, Notes: ${(c.notes || '').substring(0, 80)}`);
        });
      }
    }

    // Pipeline / Opportunities calculations
    if (oppsRes.data && oppsRes.data.length > 0) {
      const allOpps = oppsRes.data;
      const openOpps = allOpps.filter((o: any) => !['closed-won', 'closed-lost', 'won', 'lost'].includes((o.stage || '').toLowerCase()));
      const wonOpps = allOpps.filter((o: any) => ['closed-won', 'won'].includes((o.stage || '').toLowerCase()));
      const lostOpps = allOpps.filter((o: any) => ['closed-lost', 'lost'].includes((o.stage || '').toLowerCase()));

      const totalPipelineValue = openOpps.reduce((sum: number, o: any) => sum + (parseFloat(o.value) || 0), 0);
      const wonPipelineValue = wonOpps.reduce((sum: number, o: any) => sum + (parseFloat(o.value) || 0), 0);
      const weightedPipelineValue = openOpps.reduce((sum: number, o: any) => sum + ((parseFloat(o.value) || 0) * (parseFloat(o.probability) || 0) / 100), 0);

      const stageCounts: Record<string, { count: number; value: number }> = {};
      openOpps.forEach((o: any) => {
        const s = o.stage || 'unknown';
        if (!stageCounts[s]) stageCounts[s] = { count: 0, value: 0 };
        stageCounts[s].count++;
        stageCounts[s].value += parseFloat(o.value) || 0;
      });

      const overdueActionOpps = openOpps.filter((o: any) => o.next_step_date && new Date(o.next_step_date) < now);
      const highValueOpps = [...openOpps].sort((a: any, b: any) => (parseFloat(b.value) || 0) - (parseFloat(a.value) || 0)).slice(0, 8);

      contextSections.push(`\n=== PIPELINE & DEALS SUMMARY (Exact Figures) ===`);
      contextSections.push(`Total Active/Open Opportunities: ${openOpps.length}`);
      contextSections.push(`Total Open Pipeline Value: ${currency} ${totalPipelineValue.toLocaleString()}`);
      contextSections.push(`Weighted Pipeline Value: ${currency} ${Math.round(weightedPipelineValue).toLocaleString()}`);
      contextSections.push(`Closed-Won Deals: ${wonOpps.length} worth ${currency} ${wonPipelineValue.toLocaleString()}`);
      contextSections.push(`Closed-Lost Deals: ${lostOpps.length}`);
      if (wonOpps.length + lostOpps.length > 0) {
        const winRate = Math.round((wonOpps.length / (wonOpps.length + lostOpps.length)) * 100);
        contextSections.push(`Historical Win Rate: ${winRate}%`);
      }

      contextSections.push(`Pipeline Breakdown by Stage:`);
      Object.entries(stageCounts).forEach(([stage, data]) => {
        contextSections.push(`  - ${stage}: ${data.count} deals | ${currency} ${data.value.toLocaleString()}`);
      });

      if (overdueActionOpps.length > 0) {
        contextSections.push(`Deals Needing Attention (Overdue Next Steps: ${overdueActionOpps.length}):`);
        overdueActionOpps.slice(0, 6).forEach((o: any) => {
          contextSections.push(`  - ${o.name} (${o.company_name}): Next step "${o.next_step || 'Action'}" was due ${o.next_step_date} [OVERDUE]`);
        });
      }

      contextSections.push(`Top Highest-Value Open Deals:`);
      highValueOpps.forEach((o: any, idx: number) => {
        const repName = profileMap.get(o.user_id) || 'Unassigned';
        contextSections.push(`  ${idx + 1}. ${o.name} (${o.company_name || 'N/A'}) — Value: ${currency} ${(parseFloat(o.value) || 0).toLocaleString()} | Stage: ${o.stage} | Prob: ${o.probability || 0}% | Next: ${o.next_step || 'None'} (${o.next_step_date || 'N/A'}) | Rep: ${repName}`);
      });
    }

    // Tasks calculations
    if (tasksRes.data) {
      const allTasks = tasksRes.data;
      const overdueTasks = allTasks.filter((t: any) => t.due_date && new Date(t.due_date) < now);
      const dueTodayTasks = allTasks.filter((t: any) => {
        if (!t.due_date) return false;
        const d = new Date(t.due_date);
        return d >= new Date(todayStart) && d <= new Date(todayEnd);
      });
      const highPriorityTasks = allTasks.filter((t: any) => (t.priority || '').toLowerCase() === 'high');

      contextSections.push(`\n=== TASKS SUMMARY (Exact Figures) ===`);
      contextSections.push(`Total Open Tasks: ${allTasks.length}`);
      contextSections.push(`Overdue Tasks: ${overdueTasks.length}`);
      contextSections.push(`Due Today: ${dueTodayTasks.length}`);
      contextSections.push(`High Priority: ${highPriorityTasks.length}`);

      if (dueTodayTasks.length > 0) {
        contextSections.push(`Tasks Due Today:`);
        dueTodayTasks.forEach((t: any) => {
          const assignee = profileMap.get(t.assigned_to) || 'Me';
          contextSections.push(`  - ${t.title} [Priority: ${t.priority || 'medium'}] (Assigned: ${assignee})`);
        });
      }

      if (overdueTasks.length > 0) {
        contextSections.push(`Overdue Tasks:`);
        overdueTasks.slice(0, 8).forEach((t: any) => {
          const assignee = profileMap.get(t.assigned_to) || 'Me';
          contextSections.push(`  - ${t.title} — Due: ${t.due_date?.split('T')[0]} [OVERDUE] (Assigned: ${assignee})`);
        });
      }

      const pendingList = (dueTodayTasks.length === 0 && overdueTasks.length === 0) ? allTasks.slice(0, 10) : [];
      if (pendingList.length > 0) {
        contextSections.push(`Upcoming Tasks:`);
        pendingList.forEach((t: any) => {
          contextSections.push(`  - ${t.title} [Priority: ${t.priority || 'medium'}] — Due: ${t.due_date?.split('T')[0] || 'No date'}`);
        });
      }
    }

    // Reminders calculations
    if (remindersRes.data && remindersRes.data.length > 0) {
      const allReminders = remindersRes.data;
      const upcomingReminders = allReminders.filter((r: any) => r.reminder_date && new Date(r.reminder_date) >= now);
      const overdueReminders = allReminders.filter((r: any) => r.reminder_date && new Date(r.reminder_date) < now);

      contextSections.push(`\n=== REMINDERS (Active: ${allReminders.length}) ===`);
      if (overdueReminders.length > 0) {
        contextSections.push(`Overdue Reminders:`);
        overdueReminders.slice(0, 5).forEach((r: any) => {
          contextSections.push(`  - ${r.title} (Date: ${r.reminder_date}) [OVERDUE]`);
        });
      }
      if (upcomingReminders.length > 0) {
        contextSections.push(`Upcoming Reminders:`);
        upcomingReminders.slice(0, 6).forEach((r: any) => {
          contextSections.push(`  - ${r.title} (Scheduled: ${r.reminder_date})`);
        });
      }
    }

    // Visits & Field Activity
    if (visitsRes.data && visitsRes.data.length > 0) {
      const allVisits = visitsRes.data;
      const thisWeekVisits = allVisits.filter((v: any) => new Date(v.created_at) >= new Date(sevenDaysAgo));
      const thisMonthVisits = allVisits.filter((v: any) => new Date(v.created_at) >= new Date(startOfMonth));

      contextSections.push(`\n=== VISITS & FIELD ACTIVITY ===`);
      contextSections.push(`Visits Completed (Last 7 Days): ${thisWeekVisits.length}`);
      contextSections.push(`Visits Completed (This Month): ${thisMonthVisits.length}`);
      contextSections.push(`Recent Visits:`);
      allVisits.slice(0, 8).forEach((v: any) => {
        const rep = profileMap.get(v.user_id) || 'Rep';
        const dateStr = v.created_at ? new Date(v.created_at).toISOString().split('T')[0] : 'N/A';
        contextSections.push(`  - ${dateStr} — ${v.company_name || 'Customer'} (Contact: ${v.contact_name || 'N/A'}) by ${rep}: ${v.visit_type || 'Visit'}${v.notes ? ` — "${v.notes.substring(0, 70)}"` : ''}`);
      });
    }

    // Call Logs
    if (callsRes.data && callsRes.data.length > 0) {
      const allCalls = callsRes.data;
      const thisWeekCalls = allCalls.filter((c: any) => new Date(c.call_at) >= new Date(sevenDaysAgo));
      const thisMonthCalls = allCalls.filter((c: any) => new Date(c.call_at) >= new Date(startOfMonth));

      contextSections.push(`\n=== CALL LOGS ===`);
      contextSections.push(`Calls Made (Last 7 Days): ${thisWeekCalls.length}`);
      contextSections.push(`Calls Made (This Month): ${thisMonthCalls.length}`);
      contextSections.push(`Recent Call Logs:`);
      allCalls.slice(0, 8).forEach((c: any) => {
        const rep = profileMap.get(c.user_id) || 'Rep';
        const dateStr = c.call_at ? new Date(c.call_at).toISOString().split('T')[0] : 'N/A';
        contextSections.push(`  - ${dateStr} — ${c.company_name || 'Customer'}: ${c.direction || 'outbound'}, Outcome: ${c.outcome || 'N/A'}${c.duration_minutes ? ` (${c.duration_minutes} min)` : ''} by ${rep}`);
      });
    }

    // Notes
    if (notesRes.data && notesRes.data.length > 0) {
      contextSections.push(`\n=== RECENT NOTES ===`);
      notesRes.data.slice(0, 6).forEach((n: any) => {
        const dateStr = n.updated_at ? new Date(n.updated_at).toISOString().split('T')[0] : '';
        const bodyPreview = (n.body || '').substring(0, 80).replace(/\n/g, ' ');
        contextSections.push(`  - ${dateStr} [${n.title || 'Note'}]: ${bodyPreview}`);
      });
    }

    // Workflows
    if (workflowsRes.data && workflowsRes.data.length > 0) {
      const activeWfs = workflowsRes.data.filter((w: any) => w.is_active);
      contextSections.push(`\n=== ACTIVE WORKFLOWS ===`);
      contextSections.push(`Total Workflows: ${workflowsRes.data.length} (${activeWfs.length} currently active)`);
      workflowsRes.data.forEach((w: any) => {
        contextSections.push(`  - "${w.name}" [${w.is_active ? 'Active' : 'Paused'}] — Trigger: ${w.trigger_type || 'manual'} (Executed: ${w.runs_count || 0} times)`);
      });
    }

    // Companies & Contacts Totals
    if (companiesRes.count !== null || peopleRes.count !== null) {
      contextSections.push(`\n=== DATABASE ENTITY TOTALS ===`);
      if (companiesRes.count !== null) contextSections.push(`Total Companies on Record: ${companiesRes.count}`);
      if (peopleRes.count !== null) contextSections.push(`Total Contacts on Record: ${peopleRes.count}`);
    }

    // Sales Rep / Team Performance (Available for managers or team queries)
    if (teamProfiles && teamProfiles.length > 0 && (isManager || wantsReports)) {
      const reps = teamProfiles.filter((p: any) => p.role === 'sales_rep' || p.role === 'manager');
      const allOpps = oppsRes.data || [];
      const allVisits = visitsRes.data || [];
      const allCalls = callsRes.data || [];

      contextSections.push(`\n=== TEAM & SALES REP BREAKDOWN ===`);
      reps.forEach((r: any) => {
        const rName = `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.email;
        const rOpps = allOpps.filter((o: any) => o.user_id === r.id);
        const rOpenOpps = rOpps.filter((o: any) => !['closed-won', 'closed-lost', 'won', 'lost'].includes((o.stage || '').toLowerCase()));
        const rPipe = rOpenOpps.reduce((s: number, o: any) => s + (parseFloat(o.value) || 0), 0);
        const rVisits = allVisits.filter((v: any) => v.user_id === r.id);
        const rCalls = allCalls.filter((c: any) => c.user_id === r.id);

        contextSections.push(`  - ${rName} (${r.role}): ${rOpenOpps.length} open deals worth ${currency} ${rPipe.toLocaleString()} | ${rVisits.length} visits | ${rCalls.length} calls`);
      });
    }

    const structuredCRMContext = contextSections.join('\n');

    // ── 7. Compose Gemini Prompt ──────────────────────────────────────────────
    const systemPrompt = `You are SafAI, the intelligent CRM assistant built directly into SafiTrack CRM.
You assist ${userName} (${userRole === 'manager' ? 'Sales Manager / Executive' : 'Sales Representative'}) at "${orgName}".

RULES & BEHAVIOR:
1. SOURCE OF TRUTH: Use the CRM facts, exact computed metrics, and numbers provided in the CRM context below as your sole source of truth for CRM-specific information.
2. ACCURACY: Never fabricate, guess, or invent CRM records, customers, deal values, probabilities, contacts, dates, or activities.
3. INCOMPLETE INFORMATION: If the requested information is not available in the supplied context, state clearly and concisely that the CRM does not have enough information on that topic.
4. READ-ONLY: SafAI is strictly read-only. Do not claim to have modified, created, or deleted records.
5. MATHEMATICAL CONSISTENCY: When citing pipeline values, deal counts, overdue counts, or win rates, ALWAYS use the exact figures provided in the CRM calculations. Do not perform independent re-calculations that contradict the supplied numbers.
6. CURRENCY: Always use ${currency} (Kenyan Shilling) for monetary figures unless the user specifies otherwise (e.g. "${currency} 2.5M", "${currency} 850,000").
7. TONE & STYLE: Keep responses direct, professional, insightful, and concise. Avoid robotic AI filler phrases like "Based on the information provided..." or "As an AI...". Lead with the answer immediately.
8. FORMATTING: Use markdown bolding for names and key figures, bullet points for lists, and clean sections when answering multi-part questions.
9. FOLLOW-UPS: Use conversation history to resolve contextual pronouns like "that one", "which deal", "them", or "that customer".`;

    // Format contents for Gemini
    const contents: any[] = [];

    // History turns (last 6 messages max)
    const recentHistory = history.slice(-6);
    for (const h of recentHistory) {
      if (h.role === 'user' || h.role === 'assistant') {
        contents.push({
          role: h.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: h.content }],
        });
      }
    }

    // Current turn with CRM context
    contents.push({
      role: 'user',
      parts: [
        {
          text: `Current Question from user: "${userMessage}"\n\n[SAFITRACK CRM CONTEXT & DATA]:\n${structuredCRMContext}\n\nPlease answer the user's question directly and concisely based on the above CRM context.`
        }
      ]
    });

    const geminiPayload = {
      contents,
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1200,
      }
    };

    // ── 8. Invoke Gemini API — all verified models on this API key ──────────────
    // Priority order: fastest/cheapest first, all verified as supported by ListModels API
    const candidateModels = [
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.7-flash',
      'gemini-3.8-flash',
      'gemini-3.6-flash',
      'gemini-flash-latest',
    ];
    let geminiRes: Response | null = null;
    let geminiData: any = null;
    const modelErrors: string[] = [];

    for (const model of candidateModels) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiPayload),
        });
        const d = await res.json();
        if (res.ok && !d.error) {
          geminiRes = res;
          geminiData = d;
          console.log(`SafAI: success with model ${model}`);
          break;
        } else {
          const errCode = d.error?.code || res.status;
          const errMsg = d.error?.message || 'unknown error';
          modelErrors.push(`${model}(${errCode})`);
          console.warn(`Model ${model} failed (${res.status}): ${errMsg.substring(0, 80)}`);
          // Continue to next candidate on quota, not found, overloaded, or rate limit
          if (res.status === 404 || res.status === 429 || res.status === 503 ||
              errCode === 404 || errCode === 429 || errCode === 503) {
            continue;
          }
          // Fatal error (e.g. 400 bad request) - stop retrying
          geminiRes = res;
          geminiData = d;
          break;
        }
      } catch (fErr) {
        console.warn(`Fetch error for ${model}:`, fErr);
        modelErrors.push(`${model}(network)`);
      }
    }

    if (!geminiRes || !geminiData || !geminiRes.ok) {
      console.error('All Gemini models exhausted:', modelErrors.join(', '));
      // Return HTTP 200 with a user-friendly message so the UI shows it gracefully
      return json({
        reply: 'SafAI is temporarily unavailable — the AI backend is under high demand right now. Please wait a moment and try again.',
        exhausted: true,
      });
    }

    // Safely extract reply — handle STOP, MAX_TOKENS, and thinking model responses
    const candidate = geminiData.candidates?.[0];
    const rawText = candidate?.content?.parts?.find((p: any) => p.text && !p.thoughtSignature)?.text ||
                    candidate?.content?.parts?.[0]?.text ||
                    '';
    const replyText = rawText.trim() || 'I was unable to generate a response from the CRM data. Please try again.';
    const finishReason = candidate?.finishReason || 'STOP';
    if (finishReason === 'MAX_TOKENS') {
      console.warn('SafAI: response truncated at MAX_TOKENS, partial reply returned');
    }

    // ── 9. Asynchronous AI Usage Logging ──────────────────────────────────────
    if (geminiData.usageMetadata) {
      supabaseAdmin.from('ai_usage_logs').insert([{
        organization_id: orgId,
        user_id: user.id,
        action: 'safai-chat',
        prompt_tokens: geminiData.usageMetadata.promptTokenCount || 0,
        candidates_tokens: geminiData.usageMetadata.candidatesTokenCount || 0,
        total_tokens: geminiData.usageMetadata.totalTokenCount || 0,
      }]).then(({ error: logErr }: any) => {
        if (logErr) console.error('Failed to log AI usage:', logErr);
      });
    }

    return json({
      reply: replyText,
      usage: geminiData.usageMetadata || null,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('safai-assistant error:', message);
    return json({ error: message }, 500);
  }
});
