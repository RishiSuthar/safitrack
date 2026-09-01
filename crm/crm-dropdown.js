/**
 * crm-dropdown.js — SafiTrack Custom Dropdown Engine
 *
 * API
 * ---
 * window.initCrmDropdown(el, options?)  — initialise one dropdown
 * window.initAllCrmDropdowns(root?)     — batch-init everything in root
 * window.setCrmDropdownValue(el, val)   — programmatically set value + fire 'change'
 * window.getCrmDropdownValue(el)        — read current value string
 * window.destroyCrmDropdown(el)         — tear down (useful for dynamically removed elements)
 *
 * Markup produced by buildCrmDropdown() helpers:
 *   <div class="crm-dd [crm-dd--form|crm-dd--filter|crm-dd--sm]"
 *        data-dd-id="<id>"
 *        data-dd-name="<name>"
 *        data-dd-required="true|false"
 *        data-dd-disabled="true|false">
 *     <button class="crm-dd-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
 *       <span class="crm-dd-label">Placeholder</span>
 *       <span class="crm-dd-chevron">…svg…</span>
 *     </button>
 *     <div class="crm-dd-panel" role="listbox">
 *       <ul class="crm-dd-list">
 *         <li class="crm-dd-option" role="option" data-value="val" data-label="Label">
 *           <svg class="crm-dd-check">…</svg> Label
 *         </li>
 *       </ul>
 *     </div>
 *     <input class="crm-dd-value-input" type="hidden" name="…" id="…" value="">
 *   </div>
 *
 * The hidden input preserves form-submit compatibility.
 * All listeners are on the .crm-dd root element so they survive innerHTML reuse.
 */

/* ─────────────────────── SVG helpers ─────────────────────── */
const CHEVRON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
const CHECK_SVG  = `<svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

/* ─────────────────────── Build helpers ─────────────────────── */

/**
 * buildCrmDropdown(config) → HTML string
 *
 * config = {
 *   id:          string   — will be set on the hidden input + referenced by label
 *   name:        string   — form field name (defaults to id)
 *   placeholder: string   — text when no value selected
 *   options:     Array<{value, label, selected?}>
 *   value:       string   — pre-selected value (overrides options[n].selected)
 *   required:    boolean
 *   disabled:    boolean
 *   variant:     'form' | 'filter' | 'sm' | ''   (adds .crm-dd--<variant>)
 *   className:   string   — extra class on root div
 * }
 */
window.buildCrmDropdown = function buildCrmDropdown(config = {}) {
  const {
    id          = '',
    name        = id,
    placeholder = 'Select...',
    options     = [],
    value       = '',
    required    = false,
    disabled    = false,
    variant     = 'form',
    className   = '',
  } = config;

  // Determine initial selected value
  let selectedValue = value;
  let selectedLabel = placeholder;

  if (!selectedValue) {
    const preSelected = options.find(o => o.selected);
    if (preSelected) {
      selectedValue = preSelected.value;
      selectedLabel = preSelected.label;
    }
  } else {
    const opt = options.find(o => String(o.value) === String(value));
    if (opt) selectedLabel = opt.label;
  }

  const hasValue   = selectedValue !== '';
  const variantCls = variant ? `crm-dd--${variant}` : '';
  const extraCls   = className ? ` ${className}` : '';

  const optionItems = options.map(o => {
    const isSel = String(o.value) === String(selectedValue);
    return `<li class="crm-dd-option${isSel ? ' is-selected' : ''}" role="option" aria-selected="${isSel}" data-value="${escHtml(String(o.value))}" data-label="${escHtml(String(o.label))}" tabindex="-1">
      ${CHECK_SVG}
      ${escHtml(String(o.label))}
    </li>`;
  }).join('');

  return `
<div class="crm-dd ${variantCls}${extraCls}"
     data-dd-id="${escHtml(id)}"
     data-dd-name="${escHtml(name)}"
     ${required ? 'data-dd-required="true"' : ''}
     ${disabled ? 'data-dd-disabled="true"' : ''}>
  <button type="button"
          class="crm-dd-trigger${hasValue ? ' has-value' : ''}${disabled ? ' is-disabled' : ''}"
          aria-haspopup="listbox"
          aria-expanded="false"
          ${disabled ? 'disabled' : ''}>
    <span class="crm-dd-label">${escHtml(selectedLabel)}</span>
    <span class="crm-dd-chevron">${CHEVRON_SVG}</span>
  </button>
  <div class="crm-dd-panel" role="listbox">
    <ul class="crm-dd-list">
      ${optionItems || '<li class="crm-dd-empty">No options</li>'}
    </ul>
  </div>
  <input class="crm-dd-value-input" type="hidden"
         ${id   ? `id="${escHtml(id)}"` : ''}
         ${name ? `name="${escHtml(name)}"` : ''}
         value="${escHtml(selectedValue)}"
         ${required ? 'required' : ''}>
</div>`.trim();
};

/** Minimal HTML escape used during HTML string generation */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ─────────────────────── Global open tracker ─────────────────────── */
let _openDropdown = null;  // currently-open .crm-dd element (or null)

function _getPanel(root) {
  if (!root) return null;
  const local = root.querySelector('.crm-dd-panel');
  if (local) return local;
  const openPanels = Array.from(document.body.querySelectorAll('.crm-dd-panel.is-open-panel'));
  return openPanels.find(p => p._crmDdRoot === root) || null;
}

function _getList(root) {
  const panel = _getPanel(root);
  return panel ? panel.querySelector('.crm-dd-list') : null;
}

function _closeAll(except = null) {
  if (_openDropdown && _openDropdown !== except) {
    _closeDropdown(_openDropdown);
  }
}

function _closeDropdown(root) {
  if (!root) return;
  root.classList.remove('is-open');
  const trigger = root.querySelector('.crm-dd-trigger');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  if (_openDropdown === root) _openDropdown = null;

  // Clean up portal panel
  const panel = _getPanel(root);
  if (panel) {
    panel.classList.remove('is-open-panel');
    panel.classList.remove('opens-up-panel');
    // Move it back to root to preserve expected DOM structure
    if (panel.parentElement !== root) root.appendChild(panel);
    panel.style.position = '';
    panel.style.top = '';
    panel.style.bottom = '';
    panel.style.left = '';
    panel.style.width = '';
    panel.style.zIndex = '';
  }
}

function _openDropdownEl(root) {
  if (!root || root.classList.contains('is-disabled')) return;
  _closeAll(root);
  root.classList.add('is-open');
  const trigger = root.querySelector('.crm-dd-trigger');
  if (trigger) trigger.setAttribute('aria-expanded', 'true');
  _openDropdown = root;

  // Position panel fixed and append to body to escape overflow containers
  const panel = _getPanel(root);
  if (panel) {
    if (panel.parentElement !== document.body) {
      document.body.appendChild(panel);
    }
    panel._crmDdRoot = root; // Keep reference to original root
    
    // We must manually add the is-open style class since it's no longer inside root
    panel.classList.add('is-open-panel');
    
    requestAnimationFrame(() => {
      const rect = trigger.getBoundingClientRect();
      const vp = window.innerHeight;
      const vw = window.innerWidth;
      const gutter = 8;
      const maxPanelWidth = Math.max(220, Math.min(420, vw - (gutter * 2)));

      // Measure the widest option so labels are not clipped.
      const options = Array.from(panel.querySelectorAll('.crm-dd-option'));
      const widestOption = options.reduce((max, el) => Math.max(max, el.scrollWidth), 0);
      // Account for panel paddings, check icon spacing, and optional scrollbar.
      const desiredWidth = Math.max(rect.width, widestOption + 34);
      const panelWidth = Math.min(maxPanelWidth, desiredWidth);
      
      panel.style.position = 'fixed';
      panel.style.width = `${Math.ceil(panelWidth)}px`;
      panel.style.zIndex = '2147483647'; // Max z-index

      const alignRight = root.classList.contains('crm-dd--right');
      let left = alignRight ? (rect.right - panelWidth) : rect.left;
      left = Math.max(gutter, Math.min(left, vw - panelWidth - gutter));
      panel.style.left = `${Math.round(left)}px`;
      
      // Determine if we should flip up
      const panelHeight = panel.offsetHeight || 200; // rough fallback
      if (rect.bottom + panelHeight > vp - 12 && rect.top > panelHeight) {
        root.classList.add('opens-up');
        panel.classList.add('opens-up-panel');
        panel.style.top = 'auto';
        panel.style.bottom = `${vp - rect.top + 4}px`;
      } else {
        root.classList.remove('opens-up');
        panel.classList.remove('opens-up-panel');
        panel.style.bottom = 'auto';
        panel.style.top = `${rect.bottom + 4}px`;
      }
    });
  }
}

/* ─────────────────────── Core init ─────────────────────── */

// Close on scroll globally for portaled panels
window.addEventListener('scroll', (e) => {
  // Only close if it's not scrolling the dropdown panel itself
  if (e.target && e.target.classList && e.target.classList.contains('crm-dd-list')) return;
  if (_openDropdown) {
    _closeDropdown(_openDropdown);
  }
}, { capture: true, passive: true });

/**
 * Attach all interaction handlers to a single .crm-dd root element.
 * Safe to call multiple times — deduped via _dd_init flag.
 */
window.initCrmDropdown = function initCrmDropdown(root) {
  if (!root || root._dd_init) return;
  root._dd_init = true;

  const getTrigger = () => root.querySelector('.crm-dd-trigger');
  const getList    = () => _getList(root);
  const getPanel   = () => _getPanel(root);
  const getInput   = () => root.querySelector('.crm-dd-value-input');

  const onKeydown = (e) => {
    const isOpen = root.classList.contains('is-open');
    const trigger = root.querySelector('.crm-dd-trigger');
    const list = getList();
    if (!list) return;

    const options = Array.from(list.querySelectorAll('.crm-dd-option'));
    const focused = list.querySelector('.crm-dd-option:focus') || list.querySelector('.crm-dd-option.is-focused');
    const idx = focused ? options.indexOf(focused) : -1;

    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (!isOpen) {
          _openDropdownEl(root);
          requestAnimationFrame(() => {
            const sel = list.querySelector('.crm-dd-option.is-selected') || options[0];
            if (sel) _focusOption(options, sel);
          });
          return;
        }
        const next = e.key === 'ArrowDown'
          ? options[Math.min(idx + 1, options.length - 1)]
          : options[Math.max(idx - 1, 0)];
        if (next) _focusOption(options, next);
        break;
      }
      case 'Enter':
      case ' ': {
        if (!isOpen) {
          e.preventDefault();
          _openDropdownEl(root);
          return;
        }
        if (focused) {
          e.preventDefault();
          _selectOption(root, focused);
          _closeDropdown(root);
          trigger?.focus();
        }
        break;
      }
      case 'Escape':
      case 'Tab': {
        if (isOpen) {
          if (e.key === 'Escape') e.preventDefault();
          _closeDropdown(root);
          trigger?.focus();
        }
        break;
      }
      case 'Home': {
        if (isOpen && options.length) {
          e.preventDefault();
          _focusOption(options, options[0]);
        }
        break;
      }
      case 'End': {
        if (isOpen && options.length) {
          e.preventDefault();
          _focusOption(options, options[options.length - 1]);
        }
        break;
      }
      default: {
        if (isOpen && e.key.length === 1) {
          const ch = e.key.toLowerCase();
          const match = options.find(o => (o.dataset.label || '').toLowerCase().startsWith(ch));
          if (match) _focusOption(options, match);
        }
      }
    }
  };

  // ── Open / close trigger ──
  root.addEventListener('click', (e) => {
    const trigger = e.target.closest('.crm-dd-trigger');
    if (trigger && !trigger.disabled) {
      if (root.classList.contains('is-open')) {
        _closeDropdown(root);
      } else {
        _openDropdownEl(root);
        // Focus first option (or selected)
        requestAnimationFrame(() => {
          const list = getList();
          if (!list) return;
          const sel = list.querySelector('.crm-dd-option.is-selected') || list.querySelector('.crm-dd-option');
          if (sel) { sel.tabIndex = 0; sel.focus(); }
        });
      }
    }

    // ── Option click (works when panel is not portaled) ──
    const option = e.target.closest('.crm-dd-option');
    if (option && getList()?.contains(option)) {
      _selectOption(root, option);
      _closeDropdown(root);
      getTrigger()?.focus();
    }
  });

  // ── Keyboard navigation ──
  root.addEventListener('keydown', onKeydown);

  // ── Prevent panel scroll from closing ──
  const panel = getPanel();
  if (panel && !panel._dd_panel_init) {
    panel._dd_panel_init = true;
    panel.addEventListener('mousedown', (e) => e.preventDefault());
    panel.addEventListener('click', (e) => {
      const option = e.target.closest('.crm-dd-option');
      if (option && getList()?.contains(option)) {
        _selectOption(root, option);
        _closeDropdown(root);
        getTrigger()?.focus();
      }
    });
    panel.addEventListener('keydown', onKeydown);
  }
};

function _focusOption(options, target) {
  options.forEach(o => { o.classList.remove('is-focused'); o.tabIndex = -1; });
  target.classList.add('is-focused');
  target.tabIndex = 0;
  target.focus();
}

function _selectOption(root, optEl) {
  const value  = optEl.dataset.value ?? '';
  const label  = optEl.dataset.label ?? optEl.textContent.trim();
  const input  = root.querySelector('.crm-dd-value-input');
  const trigger= root.querySelector('.crm-dd-trigger');
  const lblEl  = root.querySelector('.crm-dd-label');
  const list   = _getList(root);

  // Update hidden input
  if (input) {
    input.value = value;
    // Dispatch change on the hidden input so existing listeners (addEventListener('change', ...)) fire
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Update display label
  if (lblEl) lblEl.textContent = label;
  if (trigger) {
    trigger.classList.toggle('has-value', value !== '');
  }

  // Update aria-selected on options
  if (list) {
    list.querySelectorAll('.crm-dd-option').forEach(o => {
      const isSel = o.dataset.value === value;
      o.classList.toggle('is-selected', isSel);
      o.setAttribute('aria-selected', isSel);
    });
  }

  // Validation: remove invalid state when a value is chosen
  if (value) root.classList.remove('is-invalid');
}

/* ─────────────────────── Public API ─────────────────────── */

/**
 * Programmatically set a dropdown value.
 * Fires the 'change' event so existing listeners see the update.
 */
window.setCrmDropdownValue = function setCrmDropdownValue(rootOrId, value) {
  const root = _resolveRoot(rootOrId);
  if (!root) return;
  const list = _getList(root);
  if (!list) return;
  const opt = list.querySelector(`.crm-dd-option[data-value="${CSS.escape(String(value))}"]`);
  if (opt) {
    _selectOption(root, opt);
  } else {
    // Value doesn't match any option — just set the hidden input silently
    const input = root.querySelector('.crm-dd-value-input');
    if (input) { input.value = value; }
  }
};

/** Read the current value */
window.getCrmDropdownValue = function getCrmDropdownValue(rootOrId) {
  const root = _resolveRoot(rootOrId);
  if (!root) return '';
  const input = root.querySelector('.crm-dd-value-input');
  return input ? input.value : '';
};

/** Tear down — removes _dd_init flag (listeners are on root, GC'd when element is removed) */
window.destroyCrmDropdown = function destroyCrmDropdown(rootOrId) {
  const root = _resolveRoot(rootOrId);
  if (!root) return;
  if (_openDropdown === root) _closeDropdown(root);
  root._dd_init = false;
};

/** Update the options list dynamically (e.g., after an async fetch) */
window.updateCrmDropdownOptions = function updateCrmDropdownOptions(rootOrId, options, keepValue = true) {
  const root = _resolveRoot(rootOrId);
  if (!root) return;
  const list    = _getList(root);
  const input   = root.querySelector('.crm-dd-value-input');
  const lblEl   = root.querySelector('.crm-dd-label');
  const trigger = root.querySelector('.crm-dd-trigger');
  if (!list) return;

  const currentVal = keepValue && input ? input.value : '';

  list.innerHTML = options.map(o => {
    const isSel = String(o.value) === String(currentVal);
    return `<li class="crm-dd-option${isSel ? ' is-selected' : ''}" role="option" aria-selected="${isSel}" data-value="${escHtml(String(o.value))}" data-label="${escHtml(String(o.label))}" tabindex="-1">
      ${CHECK_SVG}
      ${escHtml(String(o.label))}
    </li>`;
  }).join('') || '<li class="crm-dd-empty">No options</li>';

  // Re-reflect label if current value still exists
  if (currentVal) {
    const sel = list.querySelector('.crm-dd-option.is-selected');
    if (sel && lblEl) { lblEl.textContent = sel.dataset.label; if (trigger) trigger.classList.add('has-value'); }
    else if (lblEl)   { if (trigger) trigger.classList.remove('has-value'); }
  }
};

function _resolveRoot(rootOrId) {
  if (!rootOrId) return null;
  if (typeof rootOrId === 'string') {
    // Try by data-dd-id, then by ID on the hidden input
    return document.querySelector(`.crm-dd[data-dd-id="${rootOrId}"]`)
        || document.querySelector(`.crm-dd:has(#${CSS.escape(rootOrId)})`);
  }
  // Element: could be the root itself, or a child
  return rootOrId.classList?.contains('crm-dd')
    ? rootOrId
    : rootOrId.closest?.('.crm-dd') || null;
}

/* ─────────────────────── Batch init ─────────────────────── */

/**
 * Init all .crm-dd elements inside `root` (defaults to document).
 * Called once on DOMContentLoaded, and after any dynamic render.
 */
window.initAllCrmDropdowns = function initAllCrmDropdowns(root = document) {
  root.querySelectorAll('.crm-dd').forEach(el => window.initCrmDropdown(el));
};

/* ─────────────────────── Global close on outside click ─────────────────────── */
document.addEventListener('click', (e) => {
  if (!_openDropdown) return;
  const openPanel = _getPanel(_openDropdown);
  if (!_openDropdown.contains(e.target) && !(openPanel && openPanel.contains(e.target))) {
    _closeDropdown(_openDropdown);
  }
}, { capture: true });

/* ─────────────────────── Init on load ─────────────────────── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.initAllCrmDropdowns());
} else {
  window.initAllCrmDropdowns();
}

/* ─────────────────────── MutationObserver: auto-init new dropdowns ─────────────────────── */
new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.classList?.contains('crm-dd')) {
        window.initCrmDropdown(node);
      } else {
        node.querySelectorAll?.('.crm-dd').forEach(el => window.initCrmDropdown(el));
      }
    }
  }
}).observe(document.body, { childList: true, subtree: true });
