// modules/features/my-activity.js
// My activity feed – personal visit history.
import { state, supabaseClient } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials } from '../ui/toast.js';
import { renderSkeletonCards } from '../utils/helpers.js';

async function renderMyActivityView() {
  const { data: visits, error } = await supabaseClient
    .from('visits')
    .select('*')
    .eq('user_id', state.currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  // companies cache is preloaded during app init


  let html = `
  `;

  if (visits.length === 0) {
    html += `
      <div class="card">
        <div class="empty-state">
          <h3 class="empty-state-title">No visits yet</h3>
          <p class="empty-state-description">Start logging your field visits to see them here.</p>
          <button class="btn btn-primary" onclick="loadView('log-visit')">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus-icon lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            Log Your First Visit
          </button>
        </div>
      </div>
    `;
  } else {
    visits.forEach(visit => {
      html += renderVisitCard(visit);
    });
  }

  viewContainer.innerHTML = html;
}

function renderVisitCard(visit, showRepName = false) {
  const date = formatDate(visit.created_at);
  const leadScoreBadge = visit.lead_score ? getLeadScoreBadge(visit.lead_score) : '';

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

  const contactHtml = visit.contact_name ? `<span class="visit-meta-item"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-icon lucide-user"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${escapeHtml(visit.contact_name)}</span>` : '';
  const locationHtml = visit.location_name ? `<span class="visit-meta-item"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>${escapeHtml(visit.location_name)}</span>` : '';
  const typeHtml = visit.visit_type ? `<span class="visit-meta-item"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-tag-icon lucide-tag"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg> ${escapeHtml(String(visit.visit_type).replace('_', ' '))}</span>` : '';
  const travelHtml = visit.travel_time ? `<span class="visit-meta-item"><i class="fas fa-clock"></i> ${escapeHtml(String(visit.travel_time))} min travel</span>` : '';

  const tagsHtml = visit.tags && Array.isArray(visit.tags) && visit.tags.length > 0 ? `<div class="visit-tags mb-2">${visit.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : '';
  const photoHtml = visit.photo_url ? `<div class="photo-preview mb-2"><img src="${escapeHtml(visit.photo_url)}" alt="Visit photo" onerror="handleImageError(this)"></div>` : '';

  const repHtml = showRepName && visit.user ? `<div class="text-prim" style="font-size: 1rem;">by ${escapeHtml(getDisplayNameFromProfile(visit.user))}</div>` : '';

  const html = `
    <div class="visit-card" data-id="${escapeHtml(String(visit.id || ''))}">
      <div class="visit-header">
        <div class="visit-title">${escapeHtml(visit.title || visit.company_name || 'Visit')}</div>
        ${repHtml}
      </div>
      <div class="visit-date">${escapeHtml(date)}</div>
      <div class="visit-meta">
        ${contactHtml}
        ${locationHtml}
        ${typeHtml}
        ${travelHtml}
      </div>
      ${leadScoreBadge ? `<div class="mb-2">${leadScoreBadge}</div>` : ''}
      ${tagsHtml}
      ${photoHtml}
      <div class="visit-notes">${processedNotes}</div>
      ${visit.ai_summary ? `<div class="ai-insight"><div class="ai-insight-header">AI Summary</div><div class="ai-insight-content">${parseMarkdown(visit.ai_summary)}</div></div>` : ''}
    </div>`;

  return html;
}


// ── Exports ────────────────────────────────────────────────────
export {
  renderMyActivityView,
  renderVisitCard,
};
