// modules/features/my-activity.js
// My activity feed – personal visit history.
import { state, supabaseClient } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials } from '../ui/toast.js';
import { renderSkeletonCards } from '../utils/helpers.js';

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
  const { data: visits, error } = await supabaseClient
    .from('visits')
    .select('*')
    .eq('user_id', state.currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    viewContainer.innerHTML = `<div class="error-msg">${escapeHtml(error.message)}</div>`;
    return;
  }

  let html = '';

  if (visits.length === 0) {
    html = `
      <div class="card" style="max-width: 800px; margin: 40px auto;">
        <div class="empty-state" style="flex-direction: column; padding: 40px;">
          <h3 class="empty-state-title" style="margin-bottom: 8px;">No visits yet</h3>
          <p class="empty-state-description" style="margin-bottom: 24px;">Start logging your field visits to see them here.</p>
          <button class="btn btn-primary" onclick="loadView('log-visit')">
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

    html = `<div class="activity-timeline">`;
    
    for (const [dateGroup, groupVisits] of Object.entries(groupedVisits)) {
      html += `
        <div class="timeline-group">
          <div class="timeline-date-header">${escapeHtml(dateGroup)}</div>
      `;
      
      groupVisits.forEach(visit => {
        html += renderVisitCard(visit);
      });
      
      html += `</div>`; // Close timeline-group
    }
    
    html += `</div>`; // Close activity-timeline
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

function renderVisitCard(visit, showRepName = false) {
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
  
  const contactHtml = visit.contact_name ? `<span class="activity-chip"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${escapeHtml(visit.contact_name)}</span>` : '';
  const displayLocation = visit.location_address || visit.location_name;
  const locationHtml = displayLocation ? `<span class="activity-chip"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg> ${escapeHtml(displayLocation)}</span>` : '';
  const travelHtml = visit.travel_time ? `<span class="activity-chip"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${escapeHtml(String(visit.travel_time))}m travel</span>` : '';
  const typeHtml = `<span class="activity-chip"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg> ${escapeHtml(typeName)}</span>`;

  const tagsHtml = visit.tags && Array.isArray(visit.tags) && visit.tags.length > 0 ? `<div class="activity-meta-row" style="margin-top: 8px;">${visit.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : '';
  const photoHtml = visit.photo_url ? `<div class="photo-preview" style="margin-top: 8px;"><img src="${escapeHtml(visit.photo_url)}" alt="Visit photo" onerror="handleImageError(this)" style="border-radius: var(--radius-sm); max-height: 200px; width: auto;"></div>` : '';

  const repHtml = showRepName && visit.user ? `<div class="text-prim" style="font-size: 1rem;">by ${escapeHtml(getDisplayNameFromProfile(visit.user))}</div>` : '';

  const iconSvg = getVisitIcon(visit.visit_type);

  // Note: lead score badge is removed from here for cleaner UI, but could be added back if needed

  return `
    <div class="timeline-item ${typeClass}" data-id="${escapeHtml(String(visit.id || ''))}">
      <div class="timeline-connector">
        <div class="timeline-icon-wrap">${iconSvg}</div>
      </div>
      
      <div class="activity-card">
        <div class="activity-card-header">
          <div>
            <h4 class="activity-title">${escapeHtml(visit.title || visit.company_name || 'Visit')}</h4>
            ${repHtml}
          </div>
          <span class="activity-time">${timeStr}</span>
        </div>
        
        <div class="activity-card-body">
          <div class="activity-meta-row">
            ${typeHtml}
            ${contactHtml}
            ${locationHtml}
            ${travelHtml}
          </div>
          
          <div class="activity-notes">${processedNotes}</div>
          
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

