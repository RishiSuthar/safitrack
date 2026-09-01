// modules/features/my-activity.js
// My activity feed – personal visit history.
import { state, supabaseClient } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials } from '../ui/toast.js';
import { renderSkeletonCards } from '../utils/helpers.js';

function ensureMyActivityRedesignStyles() {
  if (document.getElementById('my-activity-redesign-v2')) return;
  const style = document.createElement('style');
  style.id = 'my-activity-redesign-v2';
  style.textContent = `
    .myact-shell { max-width: 980px; margin: 0 auto; padding: 10px 0 24px; }
    .myact-timeline { display: flex; flex-direction: column; gap: 14px; }
    .myact-group { display: flex; flex-direction: column; gap: 10px; }
    .myact-date {
      font-size: 0.73rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--text-muted);
      margin: 2px 0 4px;
    }
    .myact-card {
      border: 1px solid var(--border-color);
      border-radius: 12px;
      background: linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 86%, white), var(--bg-secondary));
      overflow: hidden;
    }
    .myact-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border-color);
      background: color-mix(in srgb, var(--bg-secondary) 78%, var(--bg-primary));
    }
    .myact-title { margin: 0; font-size: 1.02rem; color: var(--text-primary); letter-spacing: -0.01em; }
    .myact-time {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.78rem;
      color: var(--text-muted);
      font-weight: 600;
      padding: 5px 9px;
      border: 1px solid var(--border-color);
      border-radius: 999px;
      background: var(--bg-secondary);
      white-space: nowrap;
    }
    .myact-body { padding: 12px 16px 14px; }
    .myact-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
    .myact-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 0.83rem;
      border: 1px solid var(--border-color);
      background: var(--bg-secondary);
      color: var(--text-secondary);
      line-height: 1;
      max-width: 100%;
    }
    .myact-chip svg { width: 13px; height: 13px; flex-shrink: 0; opacity: 0.82; }
    .myact-chip-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; max-width: 320px; }
    .myact-notes {
      margin: 0;
      color: var(--text-primary);
      font-size: 0.92rem;
      line-height: 1.55;
      padding: 10px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--bg-primary) 58%, transparent);
      border: 1px solid color-mix(in srgb, var(--border-color) 86%, transparent);
    }
    .myact-fare {
      margin-top: 10px;
      padding: 12px;
      border: 1px solid var(--border-color);
      border-radius: 10px;
      background: var(--bg-secondary);
    }
    .myact-fare-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .myact-fare-label { font-size: 0.82rem; font-weight: 700; color: var(--text-primary); letter-spacing: 0.02em; }
    .myact-fare-status { display: inline-flex; align-items: center; padding: 2px 9px; border-radius: 999px; font-size: 0.75rem; font-weight: 700; }
    .myact-fare-grid { margin-top: 8px; display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }
    .myact-k { font-size: 0.74rem; color: var(--text-muted); }
    .myact-v { margin-top: 2px; font-size: 0.86rem; color: var(--text-primary); font-weight: 600; }
    @media (max-width: 768px) {
      .myact-shell { padding: 4px 0 20px; }
      .myact-head { padding: 12px; }
      .myact-body { padding: 10px 12px 12px; }
      .myact-chip-text { max-width: 220px; }
    }
  `;
  document.head.appendChild(style);
}

function getDateGroup(dateString) {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
}

function getTimeString(dateString) {
  return new Date(dateString).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

async function renderMyActivityView() {
  ensureMyActivityRedesignStyles();
  const { data: visits, error } = await supabaseClient
    .from('visits')
    .select('*')
    .eq('user_id', state.currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    viewContainer.innerHTML = `<div class="error-msg">${escapeHtml(error.message)}</div>`;
    return;
  }

  const actorIds = [...new Set(
    (visits || [])
      .flatMap(v => [v.fare_requested_by, v.fare_reviewed_by])
      .filter(Boolean)
  )];

  let profileById = {};
  if (actorIds.length > 0) {
    try {
      const { data: actors } = await supabaseClient
        .from('profiles')
        .select('id, first_name, last_name, email')
        .in('id', actorIds);

      profileById = (actors || []).reduce((acc, row) => {
        acc[String(row.id)] = row;
        return acc;
      }, {});
    } catch {
      profileById = {};
    }
  }

  let html = '';

  if (visits.length === 0) {
    html = `
      <div class="card" style="max-width: 800px; margin: 40px auto;">
        <div class="empty-state" style="flex-direction: column; padding: 40px;">
          <h3 class="empty-state-title" style="margin-bottom: 8px;">No visits yet</h3>
          <p class="empty-state-description" style="margin-bottom: 24px;">Start logging your field visits to see them here.</p>
          <button class="btn btn-primary" onclick="navigateView('log-visit')">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            Log Your First Visit
          </button>
        </div>
      </div>
    `;
  } else {
    // Group visits by date
    const groupedVisits = {};
    visits.forEach(visit => {
      const group = getDateGroup(visit.created_at);
      if (!groupedVisits[group]) {
        groupedVisits[group] = [];
      }
      groupedVisits[group].push(visit);
    });

    html = `<div class="myact-shell"><div class="myact-timeline">`;
    
    for (const [dateGroup, groupVisits] of Object.entries(groupedVisits)) {
      html += `
        <div class="myact-group">
          <div class="myact-date">${escapeHtml(dateGroup)}</div>
      `;
      
      groupVisits.forEach(visit => {
        html += renderVisitCard(visit, false, profileById);
      });
      
      html += `</div>`; // Close myact-group
    }
    
    html += `</div></div>`; // Close myact-timeline + myact-shell
  }

  viewContainer.innerHTML = html;
}

function getVisitIcon(type) {
  switch(type) {
    case 'new_lead':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`;
    case 'follow_up':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`;
    case 'demo':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
    case 'closing':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    case 'support':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="m9 15 2 2 4-4"/></svg>`;
    default:
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getProfileName(profile) {
  if (!profile) return 'Unknown';
  const full = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
  return full || profile.email || 'Unknown';
}

function formatLocationLabel(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const coordMatch = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coordMatch) {
    const lat = Number(coordMatch[1]);
    const lon = Number(coordMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }
  }
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function renderVisitCard(visit, showRepName = false, profileById = {}) {
  const timeStr = getTimeString(visit.created_at);
  const typeClass = visit.visit_type ? `type-${visit.visit_type}` : '';

  // Build processed notes and convert mentions to clickable spans
  let processedNotes = escapeHtml(visit.notes || '');
  if (visit.mentioned_people && Array.isArray(visit.mentioned_people) && visit.mentioned_people.length > 0) {
    visit.mentioned_people.forEach(person => {
      if (!person || !person.name) return;
      const safeName = escapeRegExp(String(person.name).trim());
      const pattern = new RegExp(`@${safeName}\\b`, 'gi');
      processedNotes = processedNotes.replace(pattern, `<span class="mentioned-person" data-person-id="${person.id}">@${escapeHtml(person.name)}</span>`);
    });
  } else {
    processedNotes = processedNotes.replace(/@([A-Za-z0-9_\-]+)\b/g, '<span class="mentioned-person" data-person-name="$1">@$1</span>');
  }

  const typeName = visit.visit_type ? String(visit.visit_type).replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Visit';
  const hasFare = Number.isFinite(Number(visit.fare_amount)) && Number(visit.fare_amount) >= 0;
  const fareAmount = hasFare ? Number(visit.fare_amount).toFixed(2) : null;
  const fareCurrency = visit.fare_currency || state.orgCurrency || state.currentOrganization?.currency || 'USD';
  const fareStatusRaw = String(visit.fare_status || (hasFare ? 'requested' : '')).toLowerCase();
  const fareStatusLabel = fareStatusRaw === 'approved'
    ? 'Approved'
    : fareStatusRaw === 'rejected'
      ? 'Rejected'
      : fareStatusRaw === 'requested'
        ? 'Requested'
        : 'Not submitted';
  const fareStatusStyle = fareStatusRaw === 'approved'
    ? 'background:rgba(34,197,94,0.12);color:#15803d;border:1px solid rgba(34,197,94,0.25);'
    : fareStatusRaw === 'rejected'
      ? 'background:rgba(239,68,68,0.10);color:#b91c1c;border:1px solid rgba(239,68,68,0.24);'
      : fareStatusRaw === 'requested'
        ? 'background:rgba(245,158,11,0.13);color:#b45309;border:1px solid rgba(245,158,11,0.28);'
        : 'background:var(--bg-secondary);color:var(--text-muted);border:1px solid var(--border-color);';
  const requestedByName = visit.fare_requested_by
    ? getProfileName(profileById[String(visit.fare_requested_by)])
    : (state.currentUserProfile ? getProfileName(state.currentUserProfile) : 'You');
  const reviewedByName = visit.fare_reviewed_by
    ? getProfileName(profileById[String(visit.fare_reviewed_by)])
    : null;
  
  const contactHtml = visit.contact_name ? `<span class="myact-chip"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><span class="myact-chip-text">${escapeHtml(visit.contact_name)}</span></span>` : '';
  const displayLocation = formatLocationLabel(visit.location_address || visit.location_name);
  const locationHtml = displayLocation ? `<span class="myact-chip"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg><span class="myact-chip-text">${escapeHtml(displayLocation)}</span></span>` : '';
  const travelHtml = visit.travel_time ? `<span class="myact-chip"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span class="myact-chip-text">${escapeHtml(String(visit.travel_time))}m travel</span></span>` : '';
  const subsectorHtml = `<span class="myact-chip"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/></svg><span class="myact-chip-text">Subsector: ${escapeHtml(String(visit.subsector || '').trim() || 'Unassigned')}</span></span>`;
  const typeHtml = `<span class="myact-chip"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg><span class="myact-chip-text">${escapeHtml(typeName)}</span></span>`;

  const visibleTags = Array.isArray(visit.tags)
    ? visit.tags.filter(tag => {
      const t = String(tag || '').trim();
      return t && !t.startsWith('__distance:') && t !== 'location-unverified';
    })
    : [];
  const tagsHtml = visibleTags.length > 0 ? `<div class="activity-meta-row" style="margin-top: 8px;">${visibleTags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : '';
  const photoHtml = visit.photo_url ? `<div class="photo-preview" style="margin-top: 8px;"><img src="${escapeHtml(visit.photo_url)}" alt="Visit photo" onerror="handleImageError(this)" style="border-radius: var(--radius-sm); max-height: 200px; width: auto;"></div>` : '';
  const fareMetaHtml = hasFare || fareStatusRaw
    ? `<div class="myact-fare">
        <div class="myact-fare-top">
          <div class="myact-fare-label">Fare Request</div>
          <span class="myact-fare-status" style="${fareStatusStyle}">${fareStatusLabel}</span>
        </div>
        <div class="myact-fare-grid">
          <div>
            <div class="myact-k">Requested Amount</div>
            <div class="myact-v">${hasFare ? `${fareCurrency} ${fareAmount}` : 'Not submitted'}</div>
          </div>
          <div>
            <div class="myact-k">Requested By</div>
            <div class="myact-v">${escapeHtml(requestedByName || 'You')}</div>
          </div>
          <div>
            <div class="myact-k">Reviewed By</div>
            <div class="myact-v">${escapeHtml(reviewedByName || 'Pending review')}</div>
          </div>
        </div>
      </div>`
    : '';

  const repHtml = showRepName && visit.user ? `<div class="text-prim" style="font-size: 1rem;">by ${escapeHtml(getDisplayNameFromProfile(visit.user))}</div>` : '';

  const iconSvg = getVisitIcon(visit.visit_type);

  // Note: lead score badge is removed from here for cleaner UI, but could be added back if needed

  return `
    <div class="myact-card ${typeClass}" data-id="${escapeHtml(String(visit.id || ''))}">
      <div class="myact-head">
          <div>
            <h4 class="myact-title">${escapeHtml(visit.title || visit.company_name || 'Visit')}</h4>
            ${repHtml}
          </div>
          <span class="myact-time">${timeStr}</span>
      </div>

      <div class="myact-body">
          <div class="myact-meta">
            ${typeHtml}
            ${subsectorHtml}
            ${contactHtml}
            ${locationHtml}
            ${travelHtml}
          </div>

          <p class="myact-notes">${processedNotes}</p>
          
          ${fareMetaHtml}
          ${tagsHtml}
          ${photoHtml}
          
          ${visit.ai_summary ? `
            <div class="activity-ai-insight">
              <div class="activity-ai-header">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                AI Summary
              </div>
              <div class="activity-ai-content">${visit.ai_summary}</div>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

// ── Exports ────────────────────────────────────────────────────
export {
  renderMyActivityView,
  renderVisitCard,
};

