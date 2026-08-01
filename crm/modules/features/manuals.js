// modules/features/manuals.js
// Manuals — file explorer for PDFs, images, and docs.
// Managers: full CRUD (folders + files). Technicians: read-only.
import { state, supabaseClient } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml } from '../ui/toast.js';
import { renderSkeletonCards, renderError } from '../utils/helpers.js';

const BUCKET = 'manuals';

// ── File type helpers ──────────────────────────────────────────────────────────

function getFileCategory(mimeType = '', name = '') {
  if (mimeType === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return 'pdf';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.includes('word') || name.match(/\.(docx?|odt)$/i)) return 'doc';
  if (mimeType.includes('sheet') || name.match(/\.(xlsx?|ods|csv)$/i)) return 'sheet';
  return 'file';
}

function fileCategoryIcon(cat) {
  switch (cat) {
    case 'pdf':
      return `<svg class="mf-file-icon pdf" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/><polyline points="9 9 10 9"/></svg>`;
    case 'image':
      return `<svg class="mf-file-icon img" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
    case 'doc':
      return `<svg class="mf-file-icon doc" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>`;
    case 'sheet':
      return `<svg class="mf-file-icon sheet" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`;
    default:
      return `<svg class="mf-file-icon generic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  }
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeDate(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Image compression (canvas) ─────────────────────────────────────────────────

async function compressImage(file, maxPx = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxPx || height > maxPx) {
          if (width >= height) { height = Math.round((height * maxPx) / width); width = maxPx; }
          else { width = Math.round((width * maxPx) / height); height = maxPx; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          blob => resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })),
          'image/jpeg',
          quality
        );
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── PDF compression via re-render is not feasible client-side; we just cap size ─

async function preparePdf(file) {
  // PDFs beyond 50MB are rejected with a clear message — no silent lossy transform
  const MAX_PDF_MB = 50;
  if (file.size > MAX_PDF_MB * 1024 * 1024) {
    throw new Error(`PDF is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed is ${MAX_PDF_MB} MB.`);
  }
  return file;
}

// ── Internal navigation state ──────────────────────────────────────────────────

const nav = {
  stack: [], // [{ id, name }] — trail from root; empty = we're at root
  get currentFolderId() { return this.stack.length ? this.stack[this.stack.length - 1].id : null; },
  push(id, name) { this.stack.push({ id, name }); },
  pop() { this.stack.pop(); },
  reset() { this.stack = []; },
};

// ── Supabase helpers ───────────────────────────────────────────────────────────

async function fetchFolders(parentId) {
  const orgId = state.currentOrganization?.id;
  if (!orgId) return [];
  let q = supabaseClient
    .from('manual_folders')
    .select('id, name, created_at, created_by')
    .eq('org_id', orgId)
    .order('name', { ascending: true });
  if (parentId) q = q.eq('parent_id', parentId);
  else q = q.is('parent_id', null);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function fetchFiles(folderId) {
  const orgId = state.currentOrganization?.id;
  if (!orgId) return [];
  let q = supabaseClient
    .from('manual_files')
    .select('id, name, storage_path, file_type, file_size, mime_type, created_at, created_by')
    .eq('org_id', orgId)
    .order('name', { ascending: true });
  if (folderId) q = q.eq('folder_id', folderId);
  else q = q.is('folder_id', null);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function createFolder(name, parentId) {
  const orgId = state.currentOrganization?.id;
  const { data, error } = await supabaseClient
    .from('manual_folders')
    .insert({ org_id: orgId, name: name.trim(), parent_id: parentId || null, created_by: state.currentUser.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function renameFolder(id, newName) {
  const { error } = await supabaseClient
    .from('manual_folders')
    .update({ name: newName.trim() })
    .eq('id', id);
  if (error) throw error;
}

async function deleteFolder(id) {
  // Recursively delete children handled by Supabase cascade (set up in SQL)
  const { error } = await supabaseClient
    .from('manual_folders')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

async function renameFile(id, newName) {
  const { error } = await supabaseClient
    .from('manual_files')
    .update({ name: newName.trim() })
    .eq('id', id);
  if (error) throw error;
}

async function deleteFile(fileId, storagePath) {
  const { error: storageErr } = await supabaseClient.storage.from(BUCKET).remove([storagePath]);
  if (storageErr) console.warn('[Manuals] Storage delete warning:', storageErr.message);
  const { error } = await supabaseClient.from('manual_files').delete().eq('id', fileId);
  if (error) throw error;
}

async function uploadFile(file, folderId) {
  const orgId = state.currentOrganization?.id;
  const ext = file.name.split('.').pop().toLowerCase();
  const safeBase = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.[^.]+$/, '');
  const storagePath = `${orgId}/${folderId || 'root'}/${Date.now()}_${safeBase}.${ext}`;

  const { error: upErr } = await supabaseClient.storage.from(BUCKET).upload(storagePath, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'application/octet-stream',
  });
  if (upErr) throw upErr;

  const cat = getFileCategory(file.type, file.name);
  const { data, error } = await supabaseClient
    .from('manual_files')
    .insert({
      org_id: orgId,
      folder_id: folderId || null,
      name: file.name,
      storage_path: storagePath,
      file_type: cat,
      file_size: file.size,
      mime_type: file.type || '',
      created_by: state.currentUser.id,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getFileUrl(storagePath) {
  const { data } = await supabaseClient.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
  return data?.signedUrl || null;
}

// ── Render helpers ─────────────────────────────────────────────────────────────

function renderBreadcrumb() {
  const canWrite = state.isManager;
  const parts = [{ id: null, name: 'Manuals' }, ...nav.stack];
  const crumbs = parts.map((p, i) => {
    const isLast = i === parts.length - 1;
    if (isLast) return `<span class="mf-breadcrumb-current">${escapeHtml(p.name)}</span>`;
    return `<button class="mf-breadcrumb-btn" data-crumb-index="${i}">${escapeHtml(p.name)}</button>`;
  }).join(`<svg class="mf-breadcrumb-sep" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`);

  const uploadBtn = canWrite ? `
    <label class="btn btn-primary mf-upload-btn" id="mf-upload-trigger">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      Upload
      <input type="file" id="mf-file-input" multiple accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.csv,.odt,.ods" style="display:none">
    </label>
    <button class="btn btn-secondary" id="mf-new-folder-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
      New Folder
    </button>` : '';

  return `
    <div class="mf-toolbar">
      <nav class="mf-breadcrumb">${crumbs}</nav>
      <div class="mf-toolbar-actions">${uploadBtn}</div>
    </div>`;
}

function renderFolderCard(folder) {
  const canWrite = state.isManager;
  const menu = canWrite ? `
    <div class="mf-item-menu-wrap">
      <button class="mf-item-menu-btn" data-folder-id="${folder.id}" aria-label="Folder options">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
      </button>
    </div>` : '';

  return `
    <div class="mf-item mf-folder" data-folder-id="${folder.id}" data-folder-name="${escapeHtml(folder.name)}" tabindex="0" role="button" aria-label="Open folder ${escapeHtml(folder.name)}">
      <div class="mf-item-icon-wrap">
        <svg class="mf-folder-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      </div>
      <div class="mf-item-meta">
        <span class="mf-item-name">${escapeHtml(folder.name)}</span>
        <span class="mf-item-date">${formatRelativeDate(folder.created_at)}</span>
      </div>
      ${menu}
    </div>`;
}

function renderFileCard(file) {
  const canWrite = state.isManager;
  const cat = file.file_type || getFileCategory(file.mime_type, file.name);
  const menu = canWrite ? `
    <div class="mf-item-menu-wrap">
      <button class="mf-item-menu-btn" data-file-id="${file.id}" data-storage-path="${escapeHtml(file.storage_path)}" aria-label="File options">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
      </button>
    </div>` : '';

  return `
    <div class="mf-item mf-file" data-file-id="${file.id}" data-storage-path="${escapeHtml(file.storage_path)}" data-file-cat="${cat}" tabindex="0" role="button" aria-label="Open file ${escapeHtml(file.name)}">
      <div class="mf-item-icon-wrap">
        ${fileCategoryIcon(cat)}
      </div>
      <div class="mf-item-meta">
        <span class="mf-item-name">${escapeHtml(file.name)}</span>
        <span class="mf-item-date">${formatBytes(file.file_size)} · ${formatRelativeDate(file.created_at)}</span>
      </div>
      ${menu}
    </div>`;
}

function renderEmptyState() {
  const canWrite = state.isManager;
  const hint = canWrite
    ? 'Upload PDFs, images, or other files, and organise them into folders.'
    : 'No files have been added to this folder yet.';
  return `
    <div class="mf-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      <p class="mf-empty-title">This folder is empty</p>
      <p class="mf-empty-hint">${hint}</p>
    </div>`;
}

// ── Upload progress overlay ────────────────────────────────────────────────────

function showUploadProgress(label) {
  let el = document.getElementById('mf-upload-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mf-upload-overlay';
    el.className = 'mf-upload-overlay';
    el.innerHTML = `
      <div class="mf-upload-box">
        <div class="mf-upload-spinner"></div>
        <p id="mf-upload-label" class="mf-upload-label"></p>
      </div>`;
    document.body.appendChild(el);
  }
  document.getElementById('mf-upload-label').textContent = label || 'Uploading…';
  el.style.display = 'flex';
}

function updateUploadProgress(label) {
  const el = document.getElementById('mf-upload-label');
  if (el) el.textContent = label;
}

function hideUploadProgress() {
  const el = document.getElementById('mf-upload-overlay');
  if (el) el.style.display = 'none';
}

// ── Context menu (rename / delete) ────────────────────────────────────────────

function showContextMenu(x, y, items) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.id = 'mf-ctx-menu';
  menu.className = 'mf-ctx-menu';
  menu.innerHTML = items.map(item =>
    item.divider
      ? `<div class="mf-ctx-divider"></div>`
      : `<button class="mf-ctx-item ${item.danger ? 'danger' : ''}" data-action="${item.action}">
          ${item.icon}
          <span>${escapeHtml(item.label)}</span>
         </button>`
  ).join('');

  document.body.appendChild(menu);

  // Position so it doesn't overflow viewport
  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = x, top = y;
  if (left + 180 > vw) left = vw - 190;
  if (top + rect.height + 20 > vh) top = y - rect.height - 8;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true, capture: true }), 0);
  return menu;
}

function closeContextMenu() {
  document.getElementById('mf-ctx-menu')?.remove();
}

// ── Inline rename input ────────────────────────────────────────────────────────

function startInlineRename(nameEl, currentName, onSave) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'mf-rename-input';
  input.value = currentName;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  async function commit() {
    const trimmed = input.value.trim();
    if (!trimmed || trimmed === currentName) {
      input.replaceWith(nameEl);
      return;
    }
    await onSave(trimmed);
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.replaceWith(nameEl); }
  });
}

// ── File preview modal ─────────────────────────────────────────────────────────

function openPreviewModal(url, cat, name) {
  closePreviewModal();
  const modal = document.createElement('div');
  modal.id = 'mf-preview-modal';
  modal.className = 'mf-preview-modal';

  let body = '';
  if (cat === 'pdf') {
    body = `<iframe src="${url}" class="mf-preview-iframe" title="${escapeHtml(name)}"></iframe>`;
  } else if (cat === 'image') {
    body = `<img src="${url}" class="mf-preview-img" alt="${escapeHtml(name)}">`;
  } else {
    body = `
      <div class="mf-preview-no-preview">
        ${fileCategoryIcon(cat)}
        <p>${escapeHtml(name)}</p>
        <a href="${url}" download="${escapeHtml(name)}" class="btn btn-primary" target="_blank" rel="noopener noreferrer">Download file</a>
      </div>`;
  }

  modal.innerHTML = `
    <div class="mf-preview-backdrop"></div>
    <div class="mf-preview-panel">
      <div class="mf-preview-header">
        <span class="mf-preview-title">${escapeHtml(name)}</span>
        <div class="mf-preview-header-actions">
          <a href="${url}" download="${escapeHtml(name)}" class="btn btn-secondary mf-preview-dl" target="_blank" rel="noopener noreferrer" aria-label="Download">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download
          </a>
          <button class="mf-preview-close" aria-label="Close preview">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="mf-preview-body">${body}</div>
    </div>`;

  document.body.appendChild(modal);

  modal.querySelector('.mf-preview-backdrop').addEventListener('click', closePreviewModal);
  modal.querySelector('.mf-preview-close').addEventListener('click', closePreviewModal);

  requestAnimationFrame(() => modal.classList.add('open'));
}

function closePreviewModal() {
  const modal = document.getElementById('mf-preview-modal');
  if (!modal) return;
  modal.classList.remove('open');
  setTimeout(() => modal.remove(), 220);
}

// ── New folder modal ───────────────────────────────────────────────────────────

function openNewFolderModal(onConfirm) {
  closeNewFolderModal();
  const modal = document.createElement('div');
  modal.id = 'mf-folder-modal';
  modal.className = 'mf-folder-modal modal';
  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-container" style="max-width:380px;">
      <div class="modal-header">
        <h3 class="modal-title">New Folder</h3>
        <button class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Folder name</label>
          <input type="text" id="mf-folder-name-input" class="form-control" placeholder="e.g. Installation Manuals" autocomplete="off" maxlength="120">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="mf-folder-cancel">Cancel</button>
        <button class="btn btn-primary" id="mf-folder-confirm">Create Folder</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  const input = modal.querySelector('#mf-folder-name-input');
  input.focus();

  const confirm = async () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    modal.querySelector('#mf-folder-confirm').disabled = true;
    await onConfirm(name);
    closeNewFolderModal();
  };

  modal.querySelector('#mf-folder-confirm').addEventListener('click', confirm);
  modal.querySelector('#mf-folder-cancel').addEventListener('click', closeNewFolderModal);
  modal.querySelector('.modal-close').addEventListener('click', closeNewFolderModal);
  modal.querySelector('.modal-backdrop').addEventListener('click', closeNewFolderModal);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); });
}

function closeNewFolderModal() {
  document.getElementById('mf-folder-modal')?.remove();
}

// ── Delete confirmation modal ──────────────────────────────────────────────────

function openDeleteModal(label, onConfirm) {
  closeDeleteModal();
  const modal = document.createElement('div');
  modal.id = 'mf-delete-modal';
  modal.className = 'mf-delete-modal modal';
  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-container" style="max-width:380px;">
      <div class="modal-header">
        <h3 class="modal-title">Delete "${escapeHtml(label)}"?</h3>
        <button class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        <p style="color:var(--text-secondary);font-size:14px;line-height:1.6;">This action cannot be undone. All contents will be permanently deleted.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="mf-delete-cancel">Cancel</button>
        <button class="btn btn-danger" id="mf-delete-confirm">Delete</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  modal.querySelector('#mf-delete-confirm').addEventListener('click', async () => {
    modal.querySelector('#mf-delete-confirm').disabled = true;
    await onConfirm();
    closeDeleteModal();
  });
  modal.querySelector('#mf-delete-cancel').addEventListener('click', closeDeleteModal);
  modal.querySelector('.modal-close').addEventListener('click', closeDeleteModal);
  modal.querySelector('.modal-backdrop').addEventListener('click', closeDeleteModal);
}

function closeDeleteModal() {
  document.getElementById('mf-delete-modal')?.remove();
}

// ── Main render ────────────────────────────────────────────────────────────────

async function renderGrid() {
  const folderId = nav.currentFolderId;
  const grid = document.getElementById('mf-grid');
  if (!grid) return;

  grid.innerHTML = `<div class="mf-loading">${renderSkeletonCards(6)}</div>`;

  try {
    const [folders, files] = await Promise.all([fetchFolders(folderId), fetchFiles(folderId)]);

    if (!folders.length && !files.length) {
      grid.innerHTML = renderEmptyState();
      return;
    }

    grid.innerHTML = `
      ${folders.map(renderFolderCard).join('')}
      ${files.map(renderFileCard).join('')}`;

    attachGridEvents(grid);
  } catch (err) {
    grid.innerHTML = renderError('Failed to load contents: ' + err.message);
  }
}

async function refreshAll() {
  // Re-render toolbar breadcrumb and grid
  const toolbar = document.getElementById('mf-toolbar-wrap');
  if (toolbar) toolbar.innerHTML = renderBreadcrumb();
  attachToolbarEvents();
  await renderGrid();
}

// ── Event wiring ───────────────────────────────────────────────────────────────

function attachGridEvents(grid) {
  const canWrite = state.isManager;

  // Open folder on click
  grid.querySelectorAll('.mf-folder').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.closest('.mf-item-menu-btn')) return;
      const folderId = el.dataset.folderId;
      const folderName = el.dataset.folderName;
      nav.push(folderId, folderName);
      await refreshAll();
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') el.click(); });
  });

  // Open file preview on click
  grid.querySelectorAll('.mf-file').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.closest('.mf-item-menu-btn')) return;
      const storagePath = el.dataset.storagePath;
      const cat = el.dataset.fileCat;
      const name = el.querySelector('.mf-item-name')?.textContent || 'File';
      showUploadProgress('Loading…');
      try {
        const url = await getFileUrl(storagePath);
        hideUploadProgress();
        if (url) openPreviewModal(url, cat, name);
        else showToast('Could not load file URL', 'error');
      } catch (err) {
        hideUploadProgress();
        showToast('Failed to open file: ' + err.message, 'error');
      }
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') el.click(); });
  });

  if (!canWrite) return;

  // Context menus for folders
  grid.querySelectorAll('.mf-item-menu-btn[data-folder-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const folderId = btn.dataset.folderId;
      const folderEl = btn.closest('.mf-folder');
      const nameEl = folderEl?.querySelector('.mf-item-name');
      const currentName = nameEl?.textContent || 'Folder';
      const rect = btn.getBoundingClientRect();

      const menu = showContextMenu(rect.left, rect.bottom + 4, [
        {
          action: 'rename-folder',
          label: 'Rename',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
        },
        { divider: true },
        {
          action: 'delete-folder',
          label: 'Delete',
          danger: true,
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
        },
      ]);

      menu.querySelector('[data-action="rename-folder"]').addEventListener('click', () => {
        closeContextMenu();
        if (!nameEl) return;
        startInlineRename(nameEl, currentName, async (newName) => {
          try {
            await renameFolder(folderId, newName);
            await renderGrid();
          } catch (err) {
            showToast('Rename failed: ' + err.message, 'error');
          }
        });
      });

      menu.querySelector('[data-action="delete-folder"]').addEventListener('click', () => {
        closeContextMenu();
        openDeleteModal(currentName, async () => {
          try {
            await deleteFolder(folderId);
            showToast('Folder deleted', 'success');
            await renderGrid();
          } catch (err) {
            showToast('Delete failed: ' + err.message, 'error');
          }
        });
      });
    });
  });

  // Context menus for files
  grid.querySelectorAll('.mf-item-menu-btn[data-file-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fileId = btn.dataset.fileId;
      const storagePath = btn.dataset.storagePath;
      const fileEl = btn.closest('.mf-file');
      const nameEl = fileEl?.querySelector('.mf-item-name');
      const currentName = nameEl?.textContent || 'File';
      const cat = fileEl?.dataset.fileCat;
      const rect = btn.getBoundingClientRect();

      const menu = showContextMenu(rect.left, rect.bottom + 4, [
        {
          action: 'open-file',
          label: 'Open / Preview',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
        },
        {
          action: 'rename-file',
          label: 'Rename',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
        },
        { divider: true },
        {
          action: 'delete-file',
          label: 'Delete',
          danger: true,
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
        },
      ]);

      menu.querySelector('[data-action="open-file"]').addEventListener('click', async () => {
        closeContextMenu();
        showUploadProgress('Loading…');
        try {
          const url = await getFileUrl(storagePath);
          hideUploadProgress();
          if (url) openPreviewModal(url, cat, currentName);
        } catch (err) {
          hideUploadProgress();
          showToast('Failed to open file', 'error');
        }
      });

      menu.querySelector('[data-action="rename-file"]').addEventListener('click', () => {
        closeContextMenu();
        if (!nameEl) return;
        startInlineRename(nameEl, currentName, async (newName) => {
          try {
            await renameFile(fileId, newName);
            await renderGrid();
          } catch (err) {
            showToast('Rename failed: ' + err.message, 'error');
          }
        });
      });

      menu.querySelector('[data-action="delete-file"]').addEventListener('click', () => {
        closeContextMenu();
        openDeleteModal(currentName, async () => {
          try {
            await deleteFile(fileId, storagePath);
            showToast('File deleted', 'success');
            await renderGrid();
          } catch (err) {
            showToast('Delete failed: ' + err.message, 'error');
          }
        });
      });
    });
  });
}

function attachToolbarEvents() {
  const canWrite = state.isManager;

  // Breadcrumb navigation
  document.querySelectorAll('.mf-breadcrumb-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.crumbIndex, 10);
      // idx 0 = root (Manuals), trim stack to (idx - 1) entries
      nav.stack = nav.stack.slice(0, idx);
      await refreshAll();
    });
  });

  if (!canWrite) return;

  document.getElementById('mf-new-folder-btn')?.addEventListener('click', () => {
    openNewFolderModal(async (name) => {
      try {
        await createFolder(name, nav.currentFolderId);
        await renderGrid();
      } catch (err) {
        showToast('Could not create folder: ' + err.message, 'error');
      }
    });
  });

  const fileInput = document.getElementById('mf-file-input');
  if (!fileInput) return;

  // Clicking the label triggers file picker — this wires the actual change
  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files);
    if (!files.length) return;
    fileInput.value = '';

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < files.length; i++) {
      const raw = files[i];
      showUploadProgress(`Uploading ${i + 1} of ${files.length}: ${raw.name}`);
      updateUploadProgress(`Processing ${raw.name}…`);

      try {
        let file = raw;
        if (raw.type.startsWith('image/')) {
          updateUploadProgress(`Compressing ${raw.name}…`);
          file = await compressImage(raw);
        } else if (raw.type === 'application/pdf' || raw.name.toLowerCase().endsWith('.pdf')) {
          file = await preparePdf(raw);
        }
        updateUploadProgress(`Uploading ${raw.name}…`);
        await uploadFile(file, nav.currentFolderId);
        successCount++;
      } catch (err) {
        failCount++;
        showToast(`Failed to upload ${raw.name}: ${err.message}`, 'error');
      }
    }

    hideUploadProgress();
    if (successCount) showToast(`${successCount} file${successCount > 1 ? 's' : ''} uploaded`, 'success');
    await renderGrid();
  });
}

// ── Entry point ────────────────────────────────────────────────────────────────

export async function renderManualsView() {
  nav.reset();

  viewContainer.innerHTML = `
    <div class="page-header" style="border-bottom:none;padding-bottom:0;">
      <div class="page-header-row">
        <div class="page-header-left">
          <h1 class="page-title">Manuals</h1>
          <p class="page-subtitle">Organise and share technical documentation for your team</p>
        </div>
      </div>
    </div>
    <div class="mf-explorer">
      <div id="mf-toolbar-wrap">${renderBreadcrumb()}</div>
      <div id="mf-grid" class="mf-grid"></div>
    </div>`;

  attachToolbarEvents();
  await renderGrid();
}
