// modules/features/log-visit.js
// Field visit logging form and geocoding.
import { state, supabaseClient } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials, triggerConfetti } from '../ui/toast.js';
import { renderSkeletonCards } from '../utils/helpers.js';
import { geocodeAddressWithOSM } from '../utils/geo.js';


async function renderLogVisitView() {
  if (window.allCompaniesPromise) await window.allCompaniesPromise;
  
  // Create a sorted copy of the cached companies
  let companies = [...(window.allCompaniesData || [])];
  companies.sort((a, b) => {
    let nameA = (a.name || '').toLowerCase();
    let nameB = (b.name || '').toLowerCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return 0;
  });

  viewContainer.innerHTML = `
    <div class="log-visit-shell">
      <div class="log-visit-flow">
        <section class="log-visit-step" data-step="1">
          <div class="log-visit-step-head">
            <span class="log-visit-step-num">1</span>
            <h3 class="log-visit-section-title">Choose Company</h3>
          </div>

          <div class="form-field">
            <label for="company-name">Company Name *</label>
            <div class="search-container">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg>
              <input type="text" id="company-name" placeholder="Search for a company..." required />
              <div id="company-search-results" class="search-results" style="display: none;"></div>
            </div>
          </div>

          <div class="form-field" id="selected-company" style="display: none;">
            <div class="selected-location-info log-visit-selected-company">
              <div id="selected-company-name"></div>
              <div id="selected-company-address" class="text-muted"></div>
            </div>
          </div>

          <button type="button" id="verify-location" class="btn btn-secondary w-full" disabled>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
            Verify Location
          </button>

          <div id="location-status" class="location-status" style="display: none;"></div>
          <div id="location-map" class="location-map" style="display: none;"></div>
        </section>

        <section class="log-visit-step" data-step="2">
          <div class="log-visit-step-head">
            <span class="log-visit-step-num">2</span>
            <h3 class="log-visit-section-title">Visit Details</h3>
          </div>

          <div class="log-visit-row">
            <div class="form-field">
              <label for="contact-name">Contact Person</label>
              <input type="text" id="contact-name" placeholder="Client contact name" />
            </div>

            <div class="form-field">
              <label for="visit-type">Visit Type</label>
              <select id="visit-type">
                <option value="new_lead">New Lead</option>
                <option value="follow_up">Follow-up</option>
                <option value="demo">Product Demo</option>
                <option value="closing">Closing</option>
                <option value="support">Customer Support</option>
              </select>
            </div>

            <div class="form-field log-visit-row-span">
              <label for="travel-time">Travel Time (minutes)</label>
              <input type="number" id="travel-time" placeholder="How long did it take to get here?" min="0" />
            </div>
          </div>
        </section>

        <section class="log-visit-step" data-step="3">
          <div class="log-visit-step-head">
            <span class="log-visit-step-num">3</span>
            <h3 class="log-visit-section-title">Notes & Tags</h3>
          </div>

          <div class="form-field">
            <label for="notes">Notes *</label>
            <div class="mention-container">
              <textarea id="notes" class="mention-input" placeholder="What happened during the visit? Key takeaways, objections, and next steps..." rows="6" required></textarea>
              <div id="mention-suggestions" class="mention-suggestions" style="display: none;"></div>
            </div>
            <div class="text-right text-muted mt-1"><span id="char-count">0</span>/1000</div>
          </div>

          <div class="form-field">
            <label>Tags</label>
            <div class="tags-input-container" id="tags-container">
              <input type="text" class="tags-input" id="tags-input" placeholder="Add tags...">
            </div>
            <div class="tag-suggestions">
              <button type="button" class="tag-suggestion" onclick="addTag('urgent')">urgent</button>
              <button type="button" class="tag-suggestion" onclick="addTag('high-value')">high-value</button>
              <button type="button" class="tag-suggestion" onclick="addTag('decision-maker')">decision-maker</button>
              <button type="button" class="tag-suggestion" onclick="addTag('follow-up')">follow-up</button>
            </div>
          </div>
        </section>

        <section class="log-visit-step" data-step="4">
          <div class="log-visit-step-head">
            <span class="log-visit-step-num">4</span>
            <h3 class="log-visit-section-title">Evidence & Save</h3>
          </div>

          <div class="form-field">
            <label>Visit Photo</label>
            <input type="file" id="visit-photo" accept="image/*" style="display: none;" />
            <div class="photo-upload-area" id="photo-upload-area">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-camera-icon lucide-camera"><path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/></svg>
              <span>Tap to take photo</span>
            </div>
            <div id="photo-preview" class="photo-preview"></div>
          </div>

          <div class="log-visit-actionbar">
            <button type="button" id="submit-visit" class="btn btn-primary btn-lg log-visit-submit" disabled>
              Save Visit
            </button>
          </div>
          <p id="log-visit-submit-hint" class="log-visit-submit-hint">Select a company and verify location to enable saving.</p>
        </section>
      </div>
    </div>
  `;

  initLogVisitForm(companies);
}

function initLogVisitForm(companies) {
  const companyNameInput = document.getElementById('company-name');
  const companySearchResults = document.getElementById('company-search-results');
  const selectedCompanyDiv = document.getElementById('selected-company');
  const selectedCompanyName = document.getElementById('selected-company-name');
  const selectedCompanyAddress = document.getElementById('selected-company-address');
  // sales rep should select a company from search; no custom company input here
  const notesEl = document.getElementById('notes');
  const charCountEl = document.getElementById('char-count');
  const verifyLocationBtn = document.getElementById('verify-location');
  const locationStatus = document.getElementById('location-status');
  const locationMapEl = document.getElementById('location-map');
  const submitBtn = document.getElementById('submit-visit');
  const submitHint = document.getElementById('log-visit-submit-hint');
  const contactNameInput = document.getElementById('contact-name');
  const visitTypeSelect = document.getElementById('visit-type');
  const travelTimeInput = document.getElementById('travel-time');
  const stepOneEl = document.querySelector('.log-visit-step[data-step="1"]');
  const stepTwoEl = document.querySelector('.log-visit-step[data-step="2"]');
  const stepThreeEl = document.querySelector('.log-visit-step[data-step="3"]');
  const stepFourEl = document.querySelector('.log-visit-step[data-step="4"]');
  const photoUploadArea = document.getElementById('photo-upload-area');
  const photoInput = document.getElementById('visit-photo');
  const photoPreview = document.getElementById('photo-preview');
  const tagsInput = document.getElementById('tags-input');
  const mentionSuggestions = document.getElementById('mention-suggestions');

  let locationVerified = false;
  let map = null;
  let mentionStartIndex = -1;
  let currentMentionQuery = '';
  const defaultVisitType = visitTypeSelect?.value || '';

  const resetLocationVerificationState = () => {
    locationVerified = false;
    submitBtn.disabled = true;
    locationStatus.style.display = 'none';
    locationMapEl.style.display = 'none';
    if (map) {
      map.remove();
      map = null;
    }
    verifyLocationBtn.disabled = !window.selectedCompanyData;
    verifyLocationBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg> Verify Location';
  };

  const updateLogVisitStepState = () => {
    const hasCompany = Boolean(window.selectedCompanyData && window.selectedCompanyData.id);
    const hasDetails = Boolean(
      (contactNameInput?.value || '').trim() ||
      (travelTimeInput?.value || '').trim() ||
      (visitTypeSelect?.value || '') !== defaultVisitType
    );
    const hasNotes = Boolean((notesEl?.value || '').trim().length > 0);

    stepOneEl?.classList.toggle('is-complete', hasCompany);
    stepTwoEl?.classList.toggle('is-complete', hasDetails);
    stepThreeEl?.classList.toggle('is-complete', hasNotes);
    stepFourEl?.classList.toggle('is-complete', locationVerified);

    if (submitHint) {
      if (!hasCompany) {
        submitHint.textContent = 'Select a company first.';
      } else if (!locationVerified) {
        submitHint.textContent = 'Verify location to enable saving.';
      } else {
        submitHint.textContent = 'Ready to save this visit.';
      }
    }
  };

  window.updateLogVisitStepState = updateLogVisitStepState;

  // Store for global access
  window.companiesData = companies;

  // Company search functionality
  companyNameInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();

    if (window.selectedCompanyData && e.target.value.trim() !== window.selectedCompanyData.name) {
      window.selectedCompanyData = null;
      selectedCompanyDiv.style.display = 'none';
      resetLocationVerificationState();
      updateLogVisitStepState();
    }

    if (query.length === 0) {
      companySearchResults.style.display = 'none';
      return;
    }

    const filtered = companies.filter(company =>
      matchesTokenizedQuery(query, company.name, company.description, company.address)
    );

    if (filtered.length === 0) {
      companySearchResults.innerHTML = `<div class="search-result-item">No companies found</div>`;
    } else {
      companySearchResults.innerHTML = filtered.map(company => `
        <div class="search-result-item" onclick="selectCompany('${company.id}')">
          <div class="search-result-icon"></div>
          <div>
            <div class="search-result-name">${company.name}</div>
            <div class="search-result-role">${company.description || 'No description'}</div>
          </div>
        </div>
      `).join('');
    }

    companySearchResults.style.display = 'block';
  });

  // Character counter
  notesEl.addEventListener('input', () => {
    charCountEl.textContent = notesEl.value.length;
    updateLogVisitStepState();
  });

  contactNameInput?.addEventListener('input', updateLogVisitStepState);
  visitTypeSelect?.addEventListener('change', updateLogVisitStepState);
  travelTimeInput?.addEventListener('input', updateLogVisitStepState);

  // Initialize mention system for notes
  notesEl.addEventListener('input', (e) => {
    const text = e.target.value;
    const cursorPos = e.target.selectionStart;

    // Check if user is typing a mention (@)
    const beforeCursor = text.substring(0, cursorPos);
    const mentionMatch = beforeCursor.match(/@([^@]*)$/);

    if (mentionMatch) {
      mentionStartIndex = cursorPos - mentionMatch[0].length;
      currentMentionQuery = mentionMatch[1];

      // Show suggestions if query is not empty
      if (currentMentionQuery.length > 0) {
        showMentionSuggestions(currentMentionQuery);
      } else {
        hideMentionSuggestions();
      }
    } else {
      hideMentionSuggestions();
      mentionStartIndex = -1;
      currentMentionQuery = '';
    }
  });

  // Handle mention selection
  notesEl.addEventListener('keydown', (e) => {
    if (mentionSuggestions.style.display !== 'none') {
      const items = mentionSuggestions.querySelectorAll('.mention-suggestion');
      let activeIndex = -1;

      // Find active item
      for (let i = 0; i < items.length; i++) {
        if (items[i].classList.contains('active')) {
          activeIndex = i;
          break;
        }
      }

      // Handle navigation
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % items.length;
        updateActiveMention(items, activeIndex);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
        updateActiveMention(items, activeIndex);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (activeIndex >= 0) {
          selectMentionedPerson(items[activeIndex].dataset.personId);
        }
      } else if (e.key === 'Escape') {
        hideMentionSuggestions();
      }
    }
  });

  // Handle click on mention suggestions (before document click handler)
  mentionSuggestions.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const suggestion = e.target.closest('.mention-suggestion');
    if (suggestion && suggestion.dataset.personId) {
      setTimeout(() => {
        window.selectMentionedPerson(suggestion.dataset.personId);
      }, 0);
    }
  }, true); // Use capture phase to ensure this fires first

  // Handle click outside to close suggestions
  document.addEventListener('click', (e) => {
    if (e.target !== notesEl && !mentionSuggestions.contains(e.target)) {
      hideMentionSuggestions();
    }
  });

  function showMentionSuggestions(query) {
    const filteredPeople = state.allPeople.filter(person =>
      matchesTokenizedQuery(query, person.name, person.email, person.job_title, person.companies?.name)
    );

    if (filteredPeople.length === 0) {
      mentionSuggestions.innerHTML = '<div class="mention-suggestion">No people found</div>';
    } else {
      mentionSuggestions.innerHTML = filteredPeople.map(person => `
        <div class="mention-suggestion" data-person-id="${person.id}">
          <div class="mention-avatar">${getInitials(person.name)}</div>
          <div class="mention-info">
            <div class="mention-name">${person.name}</div>
            <div class="mention-details">${person.email || ''} ${person.companies ? `• ${person.companies.name}` : ''}</div>
          </div>
        </div>
      `).join('');
    }

    mentionSuggestions.style.display = 'block';
  }

  function hideMentionSuggestions() {
    mentionSuggestions.style.display = 'none';
  }

  function updateActiveMention(items, activeIndex) {
    items.forEach((item, index) => {
      item.classList.toggle('active', index === activeIndex);
    });
  }

  window.selectMentionedPerson = function (personId) {
    const person = state.allPeople.find(p => p.id === parseInt(personId));
    if (!person) return;

    const text = notesEl.value;
    const beforeMention = text.substring(0, mentionStartIndex);
    const afterMention = text.substring(mentionStartIndex + currentMentionQuery.length + 1);

    // Replace with mention format
    notesEl.value = `${beforeMention}@${person.name} (${person.id})${afterMention}`;

    // Add to mentioned people array
    if (!state.mentionedPeople.find(p => p.id === parseInt(personId))) {
      state.mentionedPeople.push({
        id: parseInt(personId),
        name: person.name
      });
    }

    // Reset mention state
    hideMentionSuggestions();
    mentionStartIndex = -1;
    currentMentionQuery = '';

    // Update cursor position
    const newCursorPos = beforeMention.length + person.name.length + person.id.toString().length + 4;
    notesEl.focus();
    notesEl.setSelectionRange(newCursorPos, newCursorPos);
  };

  // Tags
  state.visitTags = [];
  tagsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && tagsInput.value.trim()) {
      e.preventDefault();
      addTag(tagsInput.value.trim());
      tagsInput.value = '';
    }
  });

  // Photo upload
  photoUploadArea.addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        photoPreview.innerHTML = `<img src="${e.target.result}" alt="Visit photo">`;
        photoUploadArea.style.display = 'none';
      };
      reader.readAsDataURL(file);
    }
  });

  // Verify location
  // In the initLogVisitForm function, update the verifyLocationBtn event listener
  verifyLocationBtn.addEventListener('click', () => {
    if (!window.selectedCompanyData) {
      showToast('Please select a company first', 'error');
      return;
    }

    // Validate selected company data
    if (isNaN(window.selectedCompanyData.latitude) || isNaN(window.selectedCompanyData.longitude)) {
      showToast('Invalid company coordinates. Please update company location.', 'error');
      return;
    }

    if (!navigator.geolocation) {
      showToast('Geolocation not supported', 'error');
      return;
    }

    verifyLocationBtn.disabled = true;
    verifyLocationBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Detecting...';
    locationStatus.style.display = 'flex';
    locationStatus.className = 'location-status';
    locationStatus.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Getting your location...';

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const userLat = position.coords.latitude;
        const userLng = position.coords.longitude;
        const accuracy = position.coords.accuracy;

        // Calculate distance with error handling
        const distance = calculateDistance(
          userLat,
          userLng,
          window.selectedCompanyData.latitude,
          window.selectedCompanyData.longitude
        );

        // Check if distance calculation was successful
        if (isNaN(distance)) {
          locationStatus.className = 'location-status error';
          locationStatus.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> Error calculating distance. Please check company coordinates.`;
          verifyLocationBtn.disabled = false;
          verifyLocationBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg> Verify Location';
          return;
        }

        // Display how far they are, but always allow submission
        locationStatus.className = 'location-status success';
        locationStatus.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg> Location checked! You are ${distance.toFixed(0)}m from ${window.selectedCompanyData.name}`;
        locationVerified = true;
        window.verifiedDistance = distance;
        submitBtn.disabled = false;
        initVerificationMap(userLat, userLng, window.selectedCompanyData);

        updateLogVisitStepState();

        verifyLocationBtn.disabled = false;
        verifyLocationBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg> Verify Location';
      },
      (error) => {
        let errorMsg = 'Unable to get location';
        if (error.code === error.PERMISSION_DENIED) errorMsg = 'Location permission denied';
        if (error.code === error.POSITION_UNAVAILABLE) errorMsg = 'Location unavailable';
        if (error.code === error.TIMEOUT) errorMsg = 'Location request timed out';

        locationStatus.className = 'location-status error';
        locationStatus.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> ${errorMsg}`;
        locationVerified = false;
        submitBtn.disabled = true;
        verifyLocationBtn.disabled = false;
        verifyLocationBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin-icon lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg> Verify Location';
        updateLogVisitStepState();
        showToast(errorMsg, 'error');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });

  function initVerificationMap(userLat, userLng, company) {
    locationMapEl.style.display = 'block';

    if (map) {
      map.remove();
    }

    map = L.map('location-map').setView([userLat, userLng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);

    L.marker([userLat, userLng]).addTo(map).bindPopup('You are here').openPopup();
    L.circle([company.latitude, company.longitude], {
      radius: company.radius,
      color: '#4f46e5',
      fillColor: '#4f46e5',
      fillOpacity: 0.1
    }).addTo(map);
    L.marker([company.latitude, company.longitude]).addTo(map).bindPopup(company.name);
  }

  // Submit visit
  submitBtn.addEventListener('click', async () => {
    if (!locationVerified) {
      showToast('Please verify your location first', 'error');
      return;
    }

    const company = companyNameInput.value.trim();
    const contact = document.getElementById('contact-name').value.trim();
    const visitType = document.getElementById('visit-type').value;
    const notes = notesEl.value.trim();
    const travelTime = document.getElementById('travel-time').value;
    const photoFile = document.getElementById('visit-photo').files[0];

    if (!company || !notes) {
      showToast('Please fill in all required fields', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      let photoUrl = null;

      if (photoFile) {
        const photoPath = `visit-photos/${state.currentUser.id}/${Date.now()}-${photoFile.name}`;
        const { error: uploadError } = await supabaseClient.storage
          .from('safitrack')
          .upload(photoPath, photoFile);

        if (!uploadError) {
          const { data: urlData } = supabaseClient.storage.from('safitrack').getPublicUrl(photoPath);
          photoUrl = urlData.publicUrl;
        }
      }

      const aiSummary = typeof generateConciseVisitSummary === 'function'
        ? await generateConciseVisitSummary(company, contact, notes)
        : null;
      const leadScore = typeof predictLeadScore === 'function'
        ? await predictLeadScore(company, contact, notes, visitType)
        : null;

      const tagsToSave = [...state.visitTags];
      if (typeof window.verifiedDistance !== 'undefined') {
        tagsToSave.push(`__distance:${Math.round(window.verifiedDistance)}`);
      }

      const visitData = {
        user_id: state.currentUser.id,
        company_name: company,
        contact_name: contact || null,
        visit_type: visitType,
        notes: notes,
        ai_summary: aiSummary,
        lead_score: leadScore,
        location_name: window.selectedCompanyData.name,
        location_address: `${window.selectedCompanyData.latitude}, ${window.selectedCompanyData.longitude}`,
        latitude: window.selectedCompanyData.latitude,
        longitude: window.selectedCompanyData.longitude,
        photo_url: photoUrl,
        travel_time: travelTime ? parseInt(travelTime) : null,
        tags: tagsToSave,
        mentioned_people: state.mentionedPeople,
        created_at: new Date().toISOString(),
        organization_id: state.currentOrganization?.id
      };

      const { error } = await supabaseClient.from('visits').insert([visitData]);

      if (error) throw error;

      showToast('Visit logged successfully!', 'success');

      if (leadScore >= 70 || state.visitTags.includes('high-value')) {
        triggerConfetti();
      }

      // Reset mentioned people array for next visit
      state.mentionedPeople = [];

      loadView('my-activity');
    } catch (err) {
      showToast('Failed to save visit: ' + err.message, 'error');
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Save Visit';
    }
  });

  updateLogVisitStepState();
}

async function geocodeAddress(address) {
  try {
    // Using Nominatim OpenStreetMap geocoding API
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`);
    const data = await response.json();

    if ((data && data.length > 0) && data[0]) {
      const { lat, lon } = data[0];
      return {
        latitude: lat,
        longitude: lon,
        displayName: data[0].display_name || address
      };
    } else {
      throw new Error('Location not found');
    }
  } catch (error) {
    console.error('Geocoding error:', error);
    throw new Error('Unable to geocode address');
  }
}

// Replace the existing selectCompany function with this updated version
window.selectCompany = function (companyId) {
  const companies = window.companiesData;
  const company = companies.find(c => c.id === companyId);
  if (!company) return;

  // Update company name input
  document.getElementById('company-name').value = company.name;

  // Show selected company info
  document.getElementById('selected-company').style.display = 'block';
  document.getElementById('selected-company-name').textContent = company.name;
  document.getElementById('selected-company-address').textContent = company.description || 'No description';

  // Hide search results
  document.getElementById('company-search-results').style.display = 'none';

  // Validate and parse coordinates
  const latitude = parseFloat(company.latitude);
  const longitude = parseFloat(company.longitude);

  // Check if coordinates are valid numbers
  if (isNaN(latitude) || isNaN(longitude)) {
    showToast(`"${company.name}" has no address. Please edit the company and add an address before logging a visit.`, 'error');
    document.getElementById('verify-location').disabled = true;
    return;
  }

  // Set selected company data with radius
  const selectedCompany = {
    id: company.id,
    name: company.name,
    latitude: latitude,
    longitude: longitude,
    radius: parseInt(company.radius) || 200 // Include the radius
  };

  // Store it in a way that can be accessed by the event listener
  window.selectedCompanyData = selectedCompany;

  // Enable verify location button
  document.getElementById('verify-location').disabled = false;
  if (typeof window.updateLogVisitStepState === 'function') {
    window.updateLogVisitStepState();
  }
};

// Allow selecting a custom company entered by the user in the Log Visit form
// custom company helper removed for sales rep flow; technicians may use their own helper

// ── Exports ────────────────────────────────────────────────────
export {
  renderLogVisitView,
  initLogVisitForm,
  geocodeAddress,
};
