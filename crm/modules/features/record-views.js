// modules/features/record-views.js
// Company and person panels, built like the deal and task panels: a header,
// a property list that edits in place, then related deals, people, calls and
// visits. The pencil opens the full form for everything else (address and
// location, categories, phone numbers, custom fields).
import { state, supabaseClient } from '../state.js';
import { showToast, escapeHtml, getInitials } from '../ui/toast.js';
import { formatCurrency } from '../utils/helpers.js';
import { getCompanyLogoUrl } from '../ui/spreadsheet.js';
import { fetchCustomFieldDefinitions, fetchCustomFieldValues } from './custom-fields.js';
import { getDefaultSalesStages, normalizeOpportunityStage } from '../utils/pipeline-stages.js';
import {
  rpIcon, rpProp, rpEditable, rpColor, rpTabs, rpItem, rpList, openRecordModal, startInlineEdit, rpAgo,
} from '../ui/record-panel.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

const orgId = () => state.currentOrganization?.id;

function withOrg(query) {
  return orgId() ? query.eq('organization_id', orgId()) : query;
}

/** For ilike: match the text exactly, ignoring case (escape its wildcards) */
function exactPattern(text) {
  return String(text || '').replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function dedupeById(...lists) {
  const map = new Map();
  lists.flat().forEach(item => { if (item?.id != null) map.set(String(item.id), item); });
  return Array.from(map.values());
}

function profileName(profile) {
  return profile ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') : '';
}

function shortName(name) {
  const [first, ...rest] = String(name || '').trim().split(/\s+/);
  return rest.length ? `${first} ${rest[rest.length - 1][0]}.` : (first || '');
}

/** A deal's stage title and colour from its pipeline (or the default stages) */
function dealStage(opp) {
  const pipelines = state.pipelines || [];
  const pipeline = pipelines.find(p => p.id === opp.pipeline_id) || pipelines.find(p => p.is_default);
  const stages = pipeline?.stages?.length ? pipeline.stages : getDefaultSalesStages();
  const id = stages.some(s => s.id === opp.stage) ? opp.stage : normalizeOpportunityStage(opp.stage);
  const stage = stages.find(s => s.id === id) || stages[0];
  return {
    title: String(stage?.title || 'Lead').replace(/[\p{Extended_Pictographic}‍️]/gu, '').trim(),
    color: stage?.color || '#94a3b8',
    closed: id === 'closed-won' || id === 'closed-lost',
    lost: id === 'closed-lost',
  };
}

function websiteUrl(domain) {
  const raw = String(domain || '').trim();
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function displayDomain(domain) {
  return String(domain || '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
}

/** Custom fields with a value, as property rows */
function renderCustomFieldRows(custom) {
  if (!custom?.defs?.length) return '';
  return custom.defs.map(def => {
    const raw = custom.values.get(def.id);
    if (raw === undefined || raw === null || raw === '') return '';
    let html;
    if (def.field_type === 'checkbox') html = raw === 'true' ? 'Yes' : 'No';
    else if (def.field_type === 'url') html = `<a class="od-link od-link--strong" href="${escapeHtml(websiteUrl(raw))}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayDomain(raw))}</a>`;
    else if (def.field_type === 'date') html = escapeHtml(formatDate(raw));
    else html = escapeHtml(raw);
    return rpProp(`custom-${def.id}`, def.field_name, 'custom', `<span class="od-readonly">${html}</span>`);
  }).join('');
}

async function loadCustomFields(entityType, id) {
  const [defs, values] = await Promise.all([fetchCustomFieldDefinitions(entityType), fetchCustomFieldValues(entityType, id)]);
  return { defs: defs || [], values: values || new Map() };
}

/** Rows for related lists, shared by both panels */
function renderDealRow(opp, i) {
  const stage = dealStage(opp);
  const owner = shortName(profileName(opp.profiles));
  const value = Number.isNaN(parseFloat(opp.value)) ? '' : formatCurrency(parseFloat(opp.value));
  return rpItem({
    action: 'open-deal',
    index: i,
    dot: stage.color,
    title: opp.name || 'Untitled deal',
    meta: [stage.title, value, owner].filter(Boolean).map(escapeHtml).join(' · '),
    // Lost deals fade back; won ones stay as they are
    muted: stage.lost,
  });
}

function renderCallRow(call, i, titleFallback) {
  return rpItem({
    action: 'open-call',
    index: i,
    dot: call.direction === 'Inbound' ? 'var(--color-success)' : 'var(--color-primary)',
    title: call.contact_name || call.people?.name || titleFallback || 'Call',
    meta: [call.outcome || 'Logged', call.duration_seconds ? `${Math.round(call.duration_seconds / 60)} min` : '', profileName(call.profiles), formatDateWithTime(call.call_at)]
      .filter(Boolean).map(escapeHtml).join(' · '),
    note: call.notes ? `${call.notes.slice(0, 140)}${call.notes.length > 140 ? '…' : ''}` : '',
  });
}

function renderVisitRow(visit, i) {
  return rpItem({
    action: 'open-visit',
    index: i,
    dot: '#8b5cf6',
    title: visit.contact_name || visit.visit_type || 'Visit',
    meta: [visit.visit_type, rpAgo(visit.created_at), profileName(visit.user)].filter(Boolean).map(escapeHtml).join(' · '),
    note: visit.notes ? `${visit.notes.slice(0, 140)}${visit.notes.length > 140 ? '…' : ''}` : '',
  });
}

/** Save fields on a company or person, then refresh the page behind the panel */
async function saveRecord(table, record, patch) {
  const updates = { ...patch, updated_at: new Date().toISOString() };
  const { data, error } = await supabaseClient.from(table).update(updates).eq('id', record.id).select('id');
  if (error || !data?.length) {
    showToast(error ? `Couldn't save: ${error.message}` : "This couldn't be saved. You may not have permission.", 'error');
    return false;
  }
  Object.assign(record, updates);
  const cache = table === 'companies' ? window.allCompaniesData : window.allPeopleData;
  const cached = Array.isArray(cache) ? cache.find(r => String(r.id) === String(record.id)) : null;
  if (cached && cached !== record) Object.assign(cached, updates);
  if (table === 'companies' && state.currentView === 'companies') window.renderCompaniesView?.();
  if (table === 'people' && state.currentView === 'people') window.renderPeopleView?.();
  return true;
}

/** Move from this panel to a related record: close it, then open the other one
 *  (panels don't stack, so the new one is never hidden behind the old) */
function openRelated(kind, item) {
  if (!item) return;
  window.closeModal('company-view-modal');
  window.closeModal('person-view-modal');
  setTimeout(() => {
    if (kind === 'deal') window.openOpportunityById?.(item.id);
    else if (kind === 'person') window.openPersonViewModal?.(item);
    else if (kind === 'company') window.openCompanyViewModal?.(item.id || item);
    else if (kind === 'call') window.openCallLogViewModal?.(item);
    else if (kind === 'visit') window.fetchAndOpenVisit?.(item.id);
  }, 120);
}

// ── Company ───────────────────────────────────────────────────────────────────

let companyView = null;

async function openCompanyPanel(companyOrId) {
  const panel = document.getElementById('company-detail');
  if (!panel) return;

  const id = typeof companyOrId === 'object' && companyOrId ? companyOrId.id : companyOrId;
  let company = typeof companyOrId === 'object' && companyOrId
    ? companyOrId
    : (Array.isArray(window.allCompaniesData) ? window.allCompaniesData.find(c => String(c.id) === String(id)) : null);
  if (!company) {
    const { data, error } = await supabaseClient.from('companies').select('*, company_categories(categories(id, name))').eq('id', id).maybeSingle();
    if (error || !data) {
      showToast("This company couldn't be opened.", 'error');
      return;
    }
    company = data;
  }

  companyView = { company, tab: 'deals', deals: undefined, people: undefined, calls: undefined, visits: undefined, custom: null };
  openRecordModal({ modalId: 'company-view-modal', panel, onClick: onCompanyClick });
  renderCompanyPanel();
  panel.querySelector('.od-body')?.scrollTo(0, 0);

  // Fresh record (categories included) and everything related, after the panel shows
  const current = companyView;
  const name = company.name || '';
  const [fresh, dealsRes, peopleRes, callsById, callsByName, visitsRes, custom] = await Promise.all([
    supabaseClient.from('companies').select('*, company_categories(categories(id, name))').eq('id', company.id).maybeSingle(),
    withOrg(supabaseClient.from('opportunities')
      .select('id, name, company_name, stage, value, probability, user_id, pipeline_id, updated_at, profiles(first_name, last_name)')
      .ilike('company_name', exactPattern(name))
      .order('updated_at', { ascending: false })),
    withOrg(supabaseClient.from('people').select('id, name, job_title, email, phone_numbers, company_id').eq('company_id', company.id).order('name')),
    withOrg(supabaseClient.from('call_logs').select('*, people(*), profiles(*)').eq('company_id', company.id).order('call_at', { ascending: false }).limit(50)),
    withOrg(supabaseClient.from('call_logs').select('*, people(*), profiles(*)').ilike('company_name', exactPattern(name)).order('call_at', { ascending: false }).limit(50)),
    withOrg(supabaseClient.from('visits').select('*, user:profiles(first_name, last_name)').ilike('company_name', exactPattern(name)).order('created_at', { ascending: false }).limit(30)),
    loadCustomFields('company', company.id),
  ]);
  if (companyView !== current) return;

  if (fresh.data) Object.assign(company, fresh.data);
  current.deals = dealsRes.error ? null : (dealsRes.data || []);
  current.people = peopleRes.error ? null : (peopleRes.data || []);
  current.calls = callsById.error && callsByName.error
    ? null
    : dedupeById(callsById.data || [], callsByName.data || []).sort((a, b) => new Date(b.call_at) - new Date(a.call_at));
  current.visits = visitsRes.error ? null : (visitsRes.data || []);
  current.custom = custom;
  renderCompanyPanel();
}

function renderCompanyPanel() {
  const panel = document.getElementById('company-detail');
  if (!panel || !companyView) return;
  const { company } = companyView;
  const name = company.name || 'Untitled company';

  const logoUrl = company.domain ? getCompanyLogoUrl(company.domain) : '';
  const site = websiteUrl(company.domain);
  const hasLocation = company.latitude != null && company.longitude != null && company.latitude !== '' && company.longitude !== '';

  const categories = (company.company_categories || [])
    .map(c => c?.categories?.name || c?.name)
    .filter(Boolean);

  // Pipeline: open deals and their value; last activity across deals, calls and visits
  const deals = companyView.deals;
  let pipelineHtml = '<span class="od-readonly is-empty">Loading…</span>';
  let activityHtml = '<span class="od-readonly is-empty">Loading…</span>';
  if (Array.isArray(deals)) {
    const open = deals.filter(d => !dealStage(d).closed);
    const total = open.reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);
    pipelineHtml = open.length
      ? `<span class="od-readonly">${escapeHtml(formatCurrency(total))}</span><span class="od-muted">across ${open.length} open deal${open.length === 1 ? '' : 's'}</span>`
      : '<span class="od-readonly is-empty">No open deals</span>';
    const dates = [
      ...deals.map(d => d.updated_at),
      ...(companyView.calls || []).map(c => c.call_at),
      ...(companyView.visits || []).map(v => v.created_at),
    ].filter(Boolean).map(d => new Date(d).getTime()).filter(t => !Number.isNaN(t));
    activityHtml = dates.length
      ? `<span class="od-readonly">${escapeHtml(rpAgo(new Date(Math.max(...dates))))}</span>`
      : '<span class="od-readonly is-empty">Nothing yet</span>';
  }

  const addressHtml = company.address
    ? `<span class="od-readonly">${escapeHtml(company.address)}</span>`
      + (hasLocation ? `<a class="od-link" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${company.latitude},${company.longitude}`)}" target="_blank" rel="noopener noreferrer">Directions</a>` : '')
    : (hasLocation
      ? `<a class="od-link od-link--strong" href="https://www.google.com/maps?q=${encodeURIComponent(`${company.latitude},${company.longitude}`)}" target="_blank" rel="noopener noreferrer">Pinned location</a>`
      : '<span class="od-readonly is-empty">None</span>');

  const subtitle = [
    site ? `<a class="od-company is-link" href="${escapeHtml(site)}" target="_blank" rel="noopener noreferrer">${rpIcon('website')}${escapeHtml(displayDomain(company.domain))}</a>` : '',
    company.company_type ? `<span>${escapeHtml(company.company_type)}</span>` : '',
    company.subsector ? `<span>${escapeHtml(company.subsector)}</span>` : '',
  ].filter(Boolean).join('<span class="od-dot">·</span>');

  const tab = companyView.tab;
  let tabHtml;
  if (tab === 'people') {
    tabHtml = rpList(companyView.people, 'No people at this company yet.', (p, i) => rpItem({
      action: 'open-person', index: i, initials: p.name || '?', color: rpColor(p.id),
      title: p.name || 'Unnamed', meta: escapeHtml([p.job_title, p.email].filter(Boolean).join(' · ')),
    }));
  } else if (tab === 'calls') {
    tabHtml = rpList(companyView.calls, 'No calls logged with this company yet.', (c, i) => renderCallRow(c, i));
  } else if (tab === 'visits') {
    tabHtml = rpList(companyView.visits, 'No visits to this company yet.', renderVisitRow);
  } else {
    tabHtml = rpList(companyView.deals, 'No deals with this company yet.', renderDealRow);
  }
  const count = (list) => (Array.isArray(list) ? list.length : null);

  const description = (company.description || '').trim();
  const updated = company.updated_at && company.updated_at !== company.created_at ? company.updated_at : null;
  const scrollTop = panel.querySelector('.od-body')?.scrollTop || 0;

  panel.innerHTML = `
    <header class="od-header">
      <span class="od-avatar" aria-hidden="true">
        <span class="opp-avatar-initials">${escapeHtml(getInitials(name))}</span>
        ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" onload="this.previousElementSibling.style.visibility='hidden'" onerror="this.remove()" />` : ''}
      </span>
      <div class="od-heading">
        <button type="button" class="od-title od-editable" id="rp-company-title" data-edit="name">${escapeHtml(name)}</button>
        ${subtitle ? `<div class="od-subtitle">${subtitle}</div>` : ''}
      </div>
      <div class="od-actions">
        ${hasLocation ? `<button type="button" class="od-icon-btn" data-action="safifind" title="Find nearby companies" aria-label="Find nearby companies">${rpIcon('find')}</button>` : ''}
        <button type="button" class="od-icon-btn" data-action="edit" title="Edit all fields" aria-label="Edit all fields">${rpIcon('edit')}</button>
        <button type="button" class="od-icon-btn" data-action="close" title="Close" aria-label="Close">${rpIcon('close')}</button>
      </div>
    </header>

    <div class="od-body">
      <dl class="od-props">
        ${rpProp('type', 'Type', 'type', rpEditable('company_type', escapeHtml(company.company_type || ''), 'Add type'))}
        ${rpProp('subsector', 'Subsector', 'sector', rpEditable('subsector', escapeHtml(company.subsector || ''), 'Add subsector'))}
        ${rpProp('website', 'Website', 'website', rpEditable('domain', escapeHtml(displayDomain(company.domain)), 'Add website')
          + (site ? `<a class="od-icon-link" href="${escapeHtml(site)}" target="_blank" rel="noopener noreferrer" title="Open website" aria-label="Open website">${rpIcon('open')}</a>` : ''))}
        ${rpProp('address', 'Address', 'address', addressHtml)}
        ${categories.length ? rpProp('categories', 'Categories', 'categories', categories.map(c => `<span class="od-tag">${escapeHtml(c)}</span>`).join('')) : ''}
        ${rpProp('pipeline', 'Open pipeline', 'pipeline', pipelineHtml)}
        ${rpProp('activity', 'Last activity', 'activity', activityHtml)}
        ${renderCustomFieldRows(companyView.custom)}
      </dl>

      <section class="td-section">
        <h3 class="td-section-title">About</h3>
        <div class="od-notes${description ? '' : ' is-empty'}" data-edit="description" role="button" tabindex="0" aria-label="Edit description">${description ? escapeHtml(description) : 'Add a description…'}</div>
      </section>

      ${rpTabs([
        { key: 'deals', label: 'Deals', count: count(companyView.deals) },
        { key: 'people', label: 'People', count: count(companyView.people) },
        { key: 'calls', label: 'Calls', count: count(companyView.calls) },
        { key: 'visits', label: 'Visits', count: count(companyView.visits) },
      ], tab)}
      <div class="od-tab-panel" role="tabpanel">${tabHtml}</div>
    </div>

    <footer class="od-footer">
      <span>Added ${escapeHtml(formatDate(company.created_at))}</span>
      ${updated ? `<span class="od-dot">·</span><span>Updated ${escapeHtml(formatDate(updated))}</span>` : ''}
    </footer>`;

  const body = panel.querySelector('.od-body');
  if (body) body.scrollTop = scrollTop;
}

function onCompanyClick(e) {
  if (!companyView) return;
  const { company } = companyView;

  const editTarget = e.target.closest('[data-edit]');
  if (editTarget) {
    const field = editTarget.dataset.edit;
    const isDescription = field === 'description';
    startInlineEdit(editTarget, {
      value: field === 'domain' ? displayDomain(company.domain) : (company[field] || ''),
      multiline: isDescription,
      className: field === 'name' ? 'od-input--name' : (isDescription ? 'od-input--notes' : ''),
      placeholder: { name: 'Company name', company_type: 'e.g. Retailer', subsector: 'e.g. Supermarket', domain: 'e.g. naivas.co.ke', description: 'What they do, who to talk to…' }[field],
      onSave: async (text) => {
        if (field === 'name' && !text) {
          showToast('A company needs a name', 'error');
          return false;
        }
        const saved = await saveRecord('companies', company, { [field]: text || null });
        if (saved) renderCompanyPanel();
        return saved;
      },
    });
    return;
  }

  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) {
    companyView.tab = tabBtn.dataset.tab;
    renderCompanyPanel();
    return;
  }

  const actionEl = e.target.closest('[data-action]');
  const action = actionEl?.dataset.action;
  const index = Number(actionEl?.dataset.index);
  if (action === 'close') window.closeModal('company-view-modal');
  else if (action === 'edit') {
    window.closeModal('company-view-modal');
    setTimeout(() => window.openCompanyModal?.(company), 100);
  } else if (action === 'safifind') window.openSafiFindForCompany?.(company);
  else if (action === 'open-deal') openRelated('deal', companyView.deals[index]);
  else if (action === 'open-person') openRelated('person', companyView.people[index]);
  else if (action === 'open-call') openRelated('call', companyView.calls[index]);
  else if (action === 'open-visit') openRelated('visit', companyView.visits[index]);
}

// ── Person ────────────────────────────────────────────────────────────────────

let personView = null;

async function openPersonPanel(personOrId) {
  const panel = document.getElementById('person-detail');
  if (!panel) return;

  const id = typeof personOrId === 'object' && personOrId ? personOrId.id : personOrId;
  let person = typeof personOrId === 'object' && personOrId?.name
    ? personOrId
    : (Array.isArray(window.allPeopleData) ? window.allPeopleData.find(p => String(p.id) === String(id)) : null);
  if (!person) {
    const { data, error } = await supabaseClient.from('people').select('*').eq('id', id).maybeSingle();
    if (error || !data) {
      showToast("This person couldn't be opened.", 'error');
      return;
    }
    person = data;
  }

  personView = { person, company: null, tab: 'deals', deals: undefined, calls: undefined, visits: undefined, custom: null };
  openRecordModal({ modalId: 'person-view-modal', panel, onClick: onPersonClick });
  renderPersonPanel();
  panel.querySelector('.od-body')?.scrollTo(0, 0);

  const current = personView;
  const name = person.name || '';
  const [fresh, dealsTagged, dealLinked, callsRes, visitsTagged, visitsNamed, custom] = await Promise.all([
    supabaseClient.from('people').select('*').eq('id', person.id).maybeSingle(),
    // Deals that tagged this person (an @mention or the contact on the deal)
    withOrg(supabaseClient.from('opportunities')
      .select('id, name, company_name, stage, value, probability, user_id, pipeline_id, updated_at, profiles(first_name, last_name)')
      .contains('mentioned_people', [{ id: person.id }])
      .order('updated_at', { ascending: false })),
    person.opportunity_id
      ? supabaseClient.from('opportunities').select('id, name, company_name, stage, value, probability, user_id, pipeline_id, updated_at, profiles(first_name, last_name)').eq('id', person.opportunity_id)
      : Promise.resolve({ data: [] }),
    withOrg(supabaseClient.from('call_logs').select('*, people(*), profiles(*)').eq('contact_id', person.id).order('call_at', { ascending: false }).limit(50)),
    withOrg(supabaseClient.from('visits').select('*, user:profiles(first_name, last_name)').contains('mentioned_people', [{ id: person.id }]).order('created_at', { ascending: false }).limit(30)),
    name
      ? withOrg(supabaseClient.from('visits').select('*, user:profiles(first_name, last_name)').ilike('contact_name', exactPattern(name)).order('created_at', { ascending: false }).limit(30))
      : Promise.resolve({ data: [] }),
    loadCustomFields('person', person.id),
  ]);
  if (personView !== current) return;

  if (fresh.data) Object.assign(person, fresh.data);
  if (person.company_id) {
    current.company = (Array.isArray(window.allCompaniesData) ? window.allCompaniesData.find(c => String(c.id) === String(person.company_id)) : null)
      || (await supabaseClient.from('companies').select('id, name, domain').eq('id', person.company_id).maybeSingle()).data
      || null;
  }
  current.deals = dealsTagged.error && dealLinked.error ? null : dedupeById(dealsTagged.data || [], dealLinked.data || []);
  current.calls = callsRes.error ? null : (callsRes.data || []);
  current.visits = visitsTagged.error && visitsNamed.error
    ? null
    : dedupeById(visitsTagged.data || [], visitsNamed.data || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  current.custom = custom;
  if (personView === current) renderPersonPanel();
}

function renderPersonPanel() {
  const panel = document.getElementById('person-detail');
  if (!panel || !personView) return;
  const { person, company } = personView;
  const name = person.name || 'Unnamed person';
  const phones = (Array.isArray(person.phone_numbers) ? person.phone_numbers : []).filter(Boolean);
  const email = (person.email || '').trim();

  const companyHtml = company?.id
    ? `<button type="button" class="od-company is-link" data-action="open-company">${rpIcon('company')}${escapeHtml(company.name || 'Company')}</button>`
    : (person.company_id ? '<span class="od-readonly is-empty">Loading…</span>' : '<span class="od-readonly is-empty">None</span>');

  const subtitle = [
    person.job_title ? `<span>${escapeHtml(person.job_title)}</span>` : '',
    company?.id ? `<button type="button" class="od-company is-link" data-action="open-company">${escapeHtml(company.name || 'Company')}</button>` : '',
  ].filter(Boolean).join('<span class="od-dot">·</span>');

  const phonesHtml = phones.length
    ? phones.map(p => `<a class="od-link od-link--strong" href="tel:${escapeHtml(String(p).replace(/[^\d+]/g, ''))}">${escapeHtml(p)}</a>`).join('')
    : '<span class="od-readonly is-empty">None</span>';

  const tab = personView.tab;
  let tabHtml;
  if (tab === 'calls') tabHtml = rpList(personView.calls, 'No calls logged with this person yet.', (c, i) => renderCallRow(c, i, name));
  else if (tab === 'visits') tabHtml = rpList(personView.visits, 'No visits with this person yet.', renderVisitRow);
  else tabHtml = rpList(personView.deals, 'Not tagged on any deals yet.', renderDealRow);
  const count = (list) => (Array.isArray(list) ? list.length : null);
  const scrollTop = panel.querySelector('.od-body')?.scrollTop || 0;

  panel.innerHTML = `
    <header class="od-header">
      <span class="od-avatar rp-person-avatar" aria-hidden="true" style="background:${rpColor(person.id)}">${escapeHtml(getInitials(name))}</span>
      <div class="od-heading">
        <button type="button" class="od-title od-editable" id="rp-person-title" data-edit="name">${escapeHtml(name)}</button>
        ${subtitle ? `<div class="od-subtitle">${subtitle}</div>` : ''}
      </div>
      <div class="od-actions">
        ${phones.length ? `<a class="od-icon-btn" href="tel:${escapeHtml(String(phones[0]).replace(/[^\d+]/g, ''))}" title="Call ${escapeHtml(phones[0])}" aria-label="Call">${rpIcon('phone')}</a>` : ''}
        ${email ? `<a class="od-icon-btn" href="mailto:${escapeHtml(email)}" title="Email ${escapeHtml(email)}" aria-label="Email">${rpIcon('email')}</a>` : ''}
        <button type="button" class="od-icon-btn" data-action="edit" title="Edit all fields" aria-label="Edit all fields">${rpIcon('edit')}</button>
        <button type="button" class="od-icon-btn" data-action="close" title="Close" aria-label="Close">${rpIcon('close')}</button>
      </div>
    </header>

    <div class="od-body">
      <dl class="od-props">
        ${rpProp('job', 'Job title', 'job', rpEditable('job_title', escapeHtml(person.job_title || ''), 'Add job title'))}
        ${rpProp('company', 'Company', 'company', companyHtml)}
        ${rpProp('email', 'Email', 'email', rpEditable('email', escapeHtml(email), 'Add email')
          + (email ? `<a class="od-icon-link" href="mailto:${escapeHtml(email)}" title="Send email" aria-label="Send email">${rpIcon('open')}</a>` : ''))}
        ${rpProp('phone', phones.length > 1 ? 'Phones' : 'Phone', 'phone', phonesHtml)}
        ${renderCustomFieldRows(personView.custom)}
      </dl>

      ${rpTabs([
        { key: 'deals', label: 'Deals', count: count(personView.deals) },
        { key: 'calls', label: 'Calls', count: count(personView.calls) },
        { key: 'visits', label: 'Visits', count: count(personView.visits) },
      ], tab)}
      <div class="od-tab-panel" role="tabpanel">${tabHtml}</div>
    </div>

    <footer class="od-footer">
      <span>Added ${escapeHtml(formatDate(person.created_at))}</span>
    </footer>`;

  const body = panel.querySelector('.od-body');
  if (body) body.scrollTop = scrollTop;
}

function onPersonClick(e) {
  if (!personView) return;
  const { person } = personView;

  const editTarget = e.target.closest('[data-edit]');
  if (editTarget) {
    const field = editTarget.dataset.edit;
    startInlineEdit(editTarget, {
      value: person[field] || '',
      type: field === 'email' ? 'email' : 'text',
      className: field === 'name' ? 'od-input--name' : '',
      placeholder: { name: 'Full name', job_title: 'e.g. Purchasing manager', email: 'name@company.com' }[field],
      onSave: async (text) => {
        if (field === 'name' && !text) {
          showToast('A person needs a name', 'error');
          return false;
        }
        if (field === 'email' && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
          showToast("That doesn't look like an email address", 'error');
          return false;
        }
        const saved = await saveRecord('people', person, { [field]: text || null });
        if (saved) renderPersonPanel();
        return saved;
      },
    });
    return;
  }

  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) {
    personView.tab = tabBtn.dataset.tab;
    renderPersonPanel();
    return;
  }

  const actionEl = e.target.closest('[data-action]');
  const action = actionEl?.dataset.action;
  const index = Number(actionEl?.dataset.index);
  if (action === 'close') window.closeModal('person-view-modal');
  else if (action === 'edit') {
    window.closeModal('person-view-modal');
    setTimeout(() => window.openPersonModal?.(person), 100);
  } else if (action === 'open-company' && personView.company) openRelated('company', personView.company);
  else if (action === 'open-deal') openRelated('deal', personView.deals[index]);
  else if (action === 'open-call') openRelated('call', personView.calls[index]);
  else if (action === 'open-visit') openRelated('visit', personView.visits[index]);
}

export { openCompanyPanel, openPersonPanel, renderDealRow, dealStage };
