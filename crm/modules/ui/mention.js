// modules/ui/mention.js
// @mention suggestion system for text areas.
import { state } from '../state.js';

// ==================== MENTION SYSTEM HELPERS ====================

function showMentionSuggestions(query, container) {
  const filteredPeople = state.allPeople.filter(person =>
    matchesTokenizedQuery(query, person.name, person.email, person.job_title, person.companies?.name)
  );


  if (filteredPeople.length === 0) {
    container.innerHTML = '<div class="mention-suggestion">No people found</div>';
  } else {
    container.innerHTML = filteredPeople.map(person => `
      <div class="mention-suggestion" data-person-id="${person.id}">
        <div class="mention-avatar">${getInitials(person.name)}</div>
        <div class="mention-info">
          <div class="mention-name">${person.name}</div>
          <div class="mention-details">${person.email || ''} ${person.companies ? `• ${person.companies.name}` : ''}</div>
        </div>
      </div>
    `).join('');
  }

  container.style.display = 'block';
}

function setActiveMention(items, activeIndex) {
  items.forEach((item, index) => {
    item.classList.toggle('active', index === activeIndex);
  });
}

function insertMentionFromSuggestion(suggestionEl, textareaEl, startIndex, query, containerEl) {


  const personId = suggestionEl.dataset.personId;
  const person = state.allPeople.find(p => String(p.id) === String(personId)); // Use string comparison for robustness



  if (!person) {
    console.error('❌ Person not found with ID:', personId);
    return;
  }

  const text = textareaEl.value;
  const cursorPos = textareaEl.selectionStart;
  const beforeMention = text.substring(0, startIndex);
  // Calculate afterMention from cursor position (accounts for partial typing)
  const afterMention = text.substring(cursorPos);



  // Insert mention with styling markup
  const mentionHTML = `@${person.name}`;
  const newText = `${beforeMention}${mentionHTML} ${afterMention}`;
  textareaEl.value = newText;



  // Add to mentioned people array
  if (!state.mentionedPeople.find(p => String(p.id) === String(personId))) {
    state.mentionedPeople.push({
      id: personId,
      name: person.name
    });
  }

  // Close suggestions
  containerEl.style.display = 'none';

  // Update cursor position (after the mention and space)
  const newCursorPos = beforeMention.length + mentionHTML.length + 1;
  textareaEl.focus();
  textareaEl.setSelectionRange(newCursorPos, newCursorPos);


}


// ======================
// SIDEBAR COLLAPSE LOGIC
// ======================



// ── Exports ────────────────────────────────────────────────────
export {
  showMentionSuggestions,
  setActiveMention,
  insertMentionFromSuggestion,
};
