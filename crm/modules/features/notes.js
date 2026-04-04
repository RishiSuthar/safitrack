// modules/features/notes.js
// Notes view, slide-over editor, tag system.
import { state, supabaseClient } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml } from '../ui/toast.js';
import { renderSkeletonCards } from '../utils/helpers.js';

let currentNotesFilter = 'all';
let currentNotesSearch = '';
let activeNoteId = null;
let noteAutoSaveTimeout = null;

async function renderNotesView() {
  const container = document.getElementById('notes-view-container');
  const viewContainer = document.getElementById('view-container');
  if (!container || !viewContainer) return;

  // Show the new container, hide the old one
  container.style.display = 'flex';
  viewContainer.style.display = 'none';

  // Fetch data
  let notesQ = supabaseClient
    .from('notes')
    .select('*')
    .eq('user_id', state.currentUser.id)
    .order('is_pinned', { ascending: false })
    .order('updated_at', { ascending: false });
  if (state.currentOrganization?.id) notesQ = notesQ.eq('organization_id', state.currentOrganization.id);
  const { data: notes, error } = await notesQ;

  if (error) {
    showToast('Error loading notes: ' + error.message, 'error');
    return;
  }

  window.allNotesData = notes || [];
  
  if (window.lucide) {
    setTimeout(() => lucide.createIcons(), 0);
  }

  // Initial render
  updateNotesSidebar();
  renderNotesGrid();
  attachNotesViewEvents();
}

function updateNotesSidebar() {
  const allCount = window.allNotesData.length;
  const pinnedCount = window.allNotesData.filter(n => n.is_pinned).length;
  
  const allEl = document.getElementById('count-all');
  const pinnedEl = document.getElementById('count-pinned');
  
  if (allEl) allEl.textContent = allCount;
  if (pinnedEl) pinnedEl.textContent = pinnedCount;

  renderNotesTags();
}

function renderNotesTags() {
  const tagsList = document.getElementById('notes-tags-list');
  if (!tagsList) return;

  const tags = new Set();
  window.allNotesData.forEach(note => {
    const matches = (note.content || '').match(/#(\w+)/g);
    if (matches) {
      matches.forEach(tag => tags.add(tag));
    }
  });

  if (tags.size === 0) {
    tagsList.innerHTML = '<div class="text-xs text-muted italic p-2">No tags yet</div>';
    return;
  }

  tagsList.innerHTML = Array.from(tags).map(tag => `
    <span class="nss-tag-item">${tag}</span>
  `).join('');

  tagsList.querySelectorAll('.nss-tag-item').forEach(el => {
    el.addEventListener('click', () => {
      currentNotesSearch = el.textContent;
      const searchBox = document.getElementById('nb-search-input');
      if (searchBox) searchBox.value = currentNotesSearch;
      renderNotesGrid();
    });
  });
}

function renderNotesGrid() {
  const grid = document.getElementById('notes-grid');
  if (!grid) return;

  let filtered = [...window.allNotesData];

  if (currentNotesFilter === 'pinned') {
    filtered = filtered.filter(n => n.is_pinned);
  }

  if (currentNotesSearch) {
    const query = currentNotesSearch.toLowerCase();
    filtered = filtered.filter(n => 
      (n.title || '').toLowerCase().includes(query) || 
      (n.content || '').toLowerCase().includes(query)
    );
  }

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state-full grid-center" style="grid-column: 1/-1; padding: 4rem; text-align: center;">
        <i data-lucide="sticky-note" style="width: 48px; height: 48px; opacity: 0.2; margin: 0 auto 1rem;"></i>
        <h3 class="text-muted">No notes found</h3>
        <p class="text-sm text-muted">Try a different filter or create a new note.</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  grid.innerHTML = filtered.map(note => {
    const title = note.title || 'Untitled Note';
    // Clean content: remove HTML, decode &nbsp; and other entities for preview
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = (note.content || '').replace(/<[^>]*>/g, ' ');
    const cleanContent = tempDiv.textContent || tempDiv.innerText || '';
    const finalContent = cleanContent.trim().substring(0, 150);
    const date = formatDate(note.updated_at);

    return `
      <article class="note-card ${note.is_pinned ? 'pinned' : ''}" data-id="${note.id}">
        <div class="nc-header">
          <h4 class="nc-title">${escapeHtml(title)}</h4>
          ${note.is_pinned ? '<i data-lucide="pin" class="nc-pin-icon"></i>' : ''}
        </div>
        <div class="nc-content">${escapeHtml(finalContent)}${finalContent.length >= 150 ? '...' : ''}</div>
        <div class="nc-footer">
          <div class="nc-mentions"></div>
          <span class="nc-date">${date}</span>
        </div>
      </article>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();

  grid.querySelectorAll('.note-card').forEach(card => {
    card.addEventListener('click', () => openNoteSlideOver(card.dataset.id));
  });
}

function attachNotesViewEvents() {
  document.querySelectorAll('.nss-item').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.nss-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentNotesFilter = btn.dataset.category;
      renderNotesGrid();
    };
  });

  const searchInput = document.getElementById('nb-search-input');
  if (searchInput) {
    searchInput.oninput = (e) => {
      currentNotesSearch = e.target.value;
      renderNotesGrid();
    };
  }

  const addBtn = document.getElementById('add-note-action-btn');
  if (addBtn) {
    addBtn.onclick = () => createNewNoteV2();
  }

  const closeBtn = document.getElementById('nso-close-btn');
  if (closeBtn) closeBtn.onclick = () => closeNoteSlideOver();

  const backdrop = document.querySelector('.nso-backdrop');
  if (backdrop) backdrop.onclick = () => closeNoteSlideOver();

  const pinBtn = document.getElementById('nso-pin-btn');
  if (pinBtn) pinBtn.onclick = () => togglePinActiveNote();

  const deleteBtn = document.getElementById('nso-delete-btn');
  if (deleteBtn) deleteBtn.onclick = () => deleteActiveNote();
  
  document.querySelectorAll('.nso-tool-btn[data-command]').forEach(btn => {
    btn.onclick = () => {
      const command = btn.dataset.command;
      document.execCommand(command, false, null);
      document.getElementById('nso-editor-content').focus();
    };
  });
}

async function openNoteSlideOver(noteId) {
  activeNoteId = noteId;
  const note = window.allNotesData.find(n => String(n.id) === String(noteId));
  if (!note) return;

  const slideOver = document.getElementById('note-slide-over');
  const titleInput = document.getElementById('nso-title-input');
  const dateSpan = document.getElementById('nso-date');
  const editor = document.getElementById('nso-editor-content');
  const pinBtn = document.getElementById('nso-pin-btn');

  if (titleInput) titleInput.value = note.title || '';
  if (dateSpan) dateSpan.textContent = formatDate(note.updated_at);
  if (editor) editor.innerHTML = note.content || '';
  if (pinBtn) {
    pinBtn.classList.toggle('active', !!note.is_pinned);
    pinBtn.style.color = note.is_pinned ? 'var(--color-warning)' : '';
  }

  slideOver.classList.add('active');

  if (titleInput) {
    titleInput.oninput = () => {
      const statusEl = document.getElementById('nso-save-status');
      if (statusEl) statusEl.textContent = 'Saving...';
      clearTimeout(noteAutoSaveTimeout);
      noteAutoSaveTimeout = setTimeout(saveActiveNote, 1000);
    };
  }

  if (editor) {
    editor.oninput = (e) => {
      const statusEl = document.getElementById('nso-save-status');
      if (statusEl) statusEl.textContent = 'Saving...';
      clearTimeout(noteAutoSaveTimeout);
      noteAutoSaveTimeout = setTimeout(saveActiveNote, 1000);
      handleNoteTagging(e);
    };
  }

  // Handle color picker
  const colorPicker = document.getElementById('nso-color-picker');
  if (colorPicker) {
    colorPicker.oninput = (e) => {
      const color = e.target.value;
      if (editor) {
        editor.focus();
        document.execCommand('foreColor', false, color);
      }
    };
  }

  // Handle toolbar commands
  document.querySelectorAll('.nso-tool-btn[data-command]').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      const command = btn.getAttribute('data-command');
      if (editor) {
        editor.focus();
        document.execCommand(command, false, null);
      }
    };
  });

  // Handle clickable tags in editor
  if (editor) {
    editor.onclick = (e) => {
      const tag = e.target.closest('.company-tag');
      if (tag && tag.dataset.id) {
        e.preventDefault();
        e.stopPropagation();
        openCompanyViewModal(tag.dataset.id);
      }
    };
  }
}

async function closeNoteSlideOver() {
  const statusEl = document.getElementById('nso-save-status');
  const slideOver = document.getElementById('note-slide-over');
  
  // Guard: If saving is in progress, finish it first
  if (statusEl && statusEl.textContent === 'Saving...') {
    await saveActiveNote();
  }

  // Deletion logic: If it's a "New Note" and content is truly empty, delete it
  const title = document.getElementById('nso-title-input')?.value.trim();
  const editor = document.getElementById('nso-editor-content');
  const content = editor ? editor.innerHTML.replace(/<[^>]*>/g, '').trim() : '';

  if (activeNoteId && title === 'New Note' && !content) {
    const confirmed = await deleteNoteRecord(activeNoteId);
    if (confirmed) {
      showToast('Empty note discarded', 'info');
    }
  }

  if (slideOver) slideOver.classList.remove('active');
  activeNoteId = null;
  renderNotesGrid();
}

async function deleteNoteRecord(id) {
  const { error } = await supabaseClient.from('notes').delete().eq('id', id);
  if (error) {
    console.error('Error deleting note:', error);
    return false;
  }
  window.allNotesData = window.allNotesData.filter(n => String(n.id) !== String(id));
  return true;
}

async function saveActiveNote() {
  if (!activeNoteId) return;

  const title = document.getElementById('nso-title-input').value.trim();
  const content = document.getElementById('nso-editor-content').innerHTML;

  if (!title) return;

  const { error } = await supabaseClient
    .from('notes')
    .update({ 
      title, 
      content,
      updated_at: new Date().toISOString()
    })
    .eq('id', activeNoteId);

  if (error) {
    document.getElementById('nso-save-status').textContent = 'Error';
    return;
  }

  const note = window.allNotesData.find(n => String(n.id) === String(activeNoteId));
  if (note) {
    note.title = title;
    note.content = content;
    note.updated_at = new Date().toISOString();
  }

  document.getElementById('nso-save-status').textContent = 'Saved';
}

async function createNewNoteV2() {
  const newNoteData = {
    user_id: state.currentUser.id,
    title: 'New Note',
    content: '',
    organization_id: state.currentOrganization?.id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabaseClient
    .from('notes')
    .insert([newNoteData])
    .select();

  if (error) {
    showToast('Failed to create note', 'error');
    return;
  }

  if (data && data[0]) {
    window.allNotesData.unshift(data[0]);
    updateNotesSidebar();
    renderNotesGrid();
    openNoteSlideOver(data[0].id);
  }
}

async function togglePinActiveNote() {
  if (!activeNoteId) return;
  const note = window.allNotesData.find(n => String(n.id) === String(activeNoteId));
  if (!note) return;

  const newPinned = !note.is_pinned;
  const { error } = await supabaseClient
    .from('notes')
    .update({ is_pinned: newPinned })
    .eq('id', activeNoteId);

  if (error) {
    showToast('Failed to pin note', 'error');
    return;
  }

  note.is_pinned = newPinned;
  const pinBtn = document.getElementById('nso-pin-btn');
  if (pinBtn) {
    pinBtn.classList.toggle('active', newPinned);
    pinBtn.style.color = newPinned ? 'var(--color-warning)' : '';
  }
  
  updateNotesSidebar();
  showToast(newPinned ? 'Note pinned' : 'Note unpinned', 'success');
}

async function deleteActiveNote() {
  if (!activeNoteId) return;
  const confirmed = await showConfirmDialog('Delete Note', 'Are you sure you want to delete this note?');
  if (!confirmed) return;

  const { error } = await supabaseClient
    .from('notes')
    .delete()
    .eq('id', activeNoteId);

  if (error) {
    showToast('Failed to delete note', 'error');
    return;
  }

  window.allNotesData = window.allNotesData.filter(n => String(n.id) !== String(activeNoteId));
  closeNoteSlideOver();
  updateNotesSidebar();
  renderNotesGrid();
  showToast('Note deleted', 'success');
}

// ======================
// NOTES TAGGING SYSTEM (v2)
// ======================

let activeTaggingRange = null;
let taggingType = null;
let taggingStartPos = 0;
let taggingQuery = '';

function handleNoteTagging(e) {
  const editor = e.target;
  const selection = window.getSelection();
  if (selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  activeTaggingRange = range.cloneRange();

  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(editor);
  preCaretRange.setEnd(range.endContainer, range.endOffset);

  const text = preCaretRange.toString();
  const cursorPos = text.length;

  // Person mention (@)
  const personMatch = text.match(/@([^\s@]*)$/);
  if (personMatch) {
    taggingType = 'person';
    taggingQuery = personMatch[1];
    taggingStartPos = cursorPos - personMatch[0].length;
    showNotePersonSuggestions(taggingQuery, editor);
    return;
  }

  // Company mention (last word if 2+ chars and not @)
  const words = text.split(/\s+/);
  const lastWord = words[words.length - 1] || '';
  if (lastWord.length >= 2 && !lastWord.startsWith('@')) {
    taggingType = 'company';
    taggingQuery = lastWord;
    taggingStartPos = cursorPos - lastWord.length;
    showNoteCompanySuggestions(taggingQuery, editor);
    return;
  }

  hideNoteTaggingSuggestions();
}

function showNotePersonSuggestions(query, editor) {
  hideNoteTaggingSuggestions();
  if (!window.allPeopleData) return;

  const matches = window.allPeopleData.filter(p => 
    matchesTokenizedQuery(query, p.name, p.email)
  ).slice(0, 5);

  if (matches.length === 0) return;

  renderNoteSuggestions(matches, 'person', editor);
}

function showNoteCompanySuggestions(query, editor) {
  hideNoteTaggingSuggestions();
  if (!window.allCompaniesData) return;

  const matches = window.allCompaniesData.filter(c => 
    matchesTokenizedQuery(query, c.name)
  ).slice(0, 5);

  if (matches.length === 0) return;

  renderNoteSuggestions(matches, 'company', editor);
}

function renderNoteSuggestions(matches, type, editor) {
  const suggestions = document.createElement('div');
  suggestions.className = 'tagging-suggestions';
  suggestions.id = 'note-tag-suggestions';

  suggestions.innerHTML = matches.map(item => `
    <div class="suggestion-item" data-id="${item.id}" data-name="${item.name}">
      <i data-lucide="${type === 'person' ? 'user' : 'building'}"></i>
      <div>
        <span>${escapeHtml(item.name)}</span>
        <small>${escapeHtml(type === 'person' ? item.email : (item.industry || ''))}</small>
      </div>
    </div>
  `).join('');

  document.body.appendChild(suggestions);
  if (window.lucide) lucide.createIcons({ props: { size: 16 } });

  const rect = activeTaggingRange.getBoundingClientRect();
  suggestions.style.left = `${rect.left + window.scrollX}px`;
  suggestions.style.top = `${rect.bottom + window.scrollY + 5}px`;

  suggestions.querySelectorAll('.suggestion-item').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      insertNoteTag(el.dataset.id, el.dataset.name, type, editor);
    };
  });

  setTimeout(() => {
    document.addEventListener('click', hideNoteTaggingSuggestions, { once: true });
  }, 10);
}

function hideNoteTaggingSuggestions() {
  const el = document.getElementById('note-tag-suggestions');
  if (el) el.remove();
}

function insertNoteTag(id, name, type, editor) {
  if (!activeTaggingRange) return;

  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(activeTaggingRange);

  // Create the tag element
  const tag = document.createElement('span');
  tag.className = type === 'person' ? 'person-tag' : 'company-tag';
  tag.textContent = name;
  tag.contentEditable = false;
  tag.dataset.id = id;
  tag.dataset.type = type;

  // Replacement logic: delete the typed chars then insert node
  const typedLength = taggingQuery.length + (type === 'person' ? 1 : 0);
  
  for (let i = 0; i < typedLength; i++) {
    document.execCommand('delete', false, null);
  }

  // Insert the tag
  const range = selection.getRangeAt(0);
  const space = document.createTextNode('\u00A0');
  range.insertNode(space);
  range.insertNode(tag);
  
  // Move cursor after the space
  const newRange = document.createRange();
  newRange.setStartAfter(space);
  newRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(newRange);

  hideNoteTaggingSuggestions();
  saveActiveNote();
}


// ── Exports ────────────────────────────────────────────────────
export {
  renderNotesView,
  updateNotesSidebar,
  renderNotesTags,
  renderNotesGrid,
  attachNotesViewEvents,
  openNoteSlideOver,
  closeNoteSlideOver,
  deleteNoteRecord,
  saveActiveNote,
  createNewNoteV2,
  togglePinActiveNote,
  deleteActiveNote,
  handleNoteTagging,
  showNotePersonSuggestions,
  showNoteCompanySuggestions,
  renderNoteSuggestions,
  hideNoteTaggingSuggestions,
  insertNoteTag,
};
