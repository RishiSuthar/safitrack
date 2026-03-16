// modules/utils/geo.js
// Geocoding, distance calculation, Overpass nearby search.

async function geocodeAddressWithOSM(address) {
  try {
    // URL encode the address to handle spaces and special characters
    const encodedAddress = encodeURIComponent(address);

    // Nominatim Search Endpoint
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SafiTrack-CRM/1.0' // User-Agent is recommended to avoid blocking
      }
    });

    if (!response.ok) {
      // Handle rate limits (HTTP 429)
      if (response.status === 429) {
        throw new Error('Too many requests. Please wait a moment.');
      }
      throw new Error('Geocoding service unavailable. Please enter coordinates manually.');
    }

    const data = await response.json();

    // Check if we got results back
    if (!data || !Array.isArray(data) || data.length === 0) {
      throw new Error('Address not found. Please try a more specific address or enter coordinates manually.');
    }

    // Extract the first (most relevant) result
    const result = data[0];

    return {
      latitude: parseFloat(result.lat),
      longitude: parseFloat(result.lon),
      displayName: result.display_name || address
    };

  } catch (error) {
    console.error('Geocoding error:', error);
    throw new Error(error.message || 'Geocoding failed. Please enter coordinates manually.');
  }
}




// Replace the existing calculateDistance function with this improved version
function calculateDistance(lat1, lon1, lat2, lon2) {
  // Validate input parameters
  if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) {
    console.error('Invalid coordinates for distance calculation', { lat1, lon1, lat2, lon2 });
    return NaN;
  }

  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function buildOverpassQuery(lat, lon, radiusMeters, types = ['shop', 'office']) {
  const categoryMap = {
    'shop': ['shop'],
    'office': ['office'],
    'industrial': ['industrial', 'man_made=works', 'craft'],
    'medical': ['amenity=hospital', 'amenity=doctors', 'amenity=clinic', 'amenity=pharmacy', 'amenity=dentist'],
    'food': ['amenity=restaurant', 'amenity=cafe', 'amenity=fast_food', 'amenity=pub', 'amenity=bar'],
    'education': ['amenity=school', 'amenity=university', 'amenity=college', 'amenity=kindergarten'],
    'both': ['shop', 'office', 'industrial', 'amenity']
  };

  const tagClauses = [];
  const typeKey = Array.isArray(types) ? types[0] : (types || 'both');
  const mapped = categoryMap[typeKey] || categoryMap['both'];

  mapped.forEach(tag => {
    if (tag.includes('=')) {
      const [k, v] = tag.split('=');
      tagClauses.push(`node["${k}"="${v}"]["name"](around:${radiusMeters},${lat},${lon});`);
      tagClauses.push(`way["${k}"="${v}"]["name"](around:${radiusMeters},${lat},${lon});`);
    } else {
      tagClauses.push(`node["${tag}"]["name"](around:${radiusMeters},${lat},${lon});`);
      tagClauses.push(`way["${tag}"]["name"](around:${radiusMeters},${lat},${lon});`);
    }
  });

  return `[out:json][timeout:30];
(
  ${tagClauses.join('\n  ')}
);
out center;`;
}

/**
 * Query Overpass API for nearby POIs and return parsed results
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusMeters
 * @returns {Promise<Array>} array of { id, name, lat, lon, tags, distance, displayName }
 */
async function searchNearbyOverpass(lat, lon, radiusMeters = 2000, types = ['shop', 'office']) {
  const query = buildOverpassQuery(lat, lon, radiusMeters, types);
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter'
  ];

  let lastError = null;
  let data = null;

  for (const url of endpoints) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
          'User-Agent': 'SafiTrack-CRM/1.0'
        },
        body: query
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        lastError = new Error(`Overpass endpoint ${url} responded ${resp.status}: ${text}`);
        console.warn('Overpass non-ok response', { url, status: resp.status, body: text });
        // try the next endpoint
        continue;
      }

      data = await resp.json();
      break;
    } catch (err) {
      lastError = err;
      console.warn('Overpass fetch failed for', url, err);
      // try next endpoint
    }
  }

  if (!data || !Array.isArray(data.elements)) {
    throw lastError || new Error('Overpass API error');
  }

  const results = data.elements.map(el => {
    const tags = el.tags || {};
    const name = tags.name || null;
    let rLat = el.lat, rLon = el.lon;
    if ((!rLat || !rLon) && el.center) {
      rLat = el.center.lat;
      rLon = el.center.lon;
    }

    const distance = (typeof rLat === 'number' && typeof rLon === 'number') ? calculateDistance(lat, lon, rLat, rLon) : NaN;

    return {
      id: el.id,
      type: el.type,
      name,
      lat: rLat,
      lon: rLon,
      tags,
      distance,
      displayName: tags['addr:full'] || tags['addr:street'] || tags['addr:housenumber'] || tags['addr:city'] || name || ''
    };
  }).filter(r => r.name);

  // Sort by distance ascending
  results.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
  return results;
}

/**
 * Render nearby suggestions into the company modal
 * Creates or updates a container with id 'nearby-suggestions'
 */
function renderNearbySuggestions(items = [], targetModalId = 'company-modal') {
  const modal = document.getElementById(targetModalId);
  if (!modal) return;
  const body = modal.querySelector('.modal-body');
  if (!body) return;

  // Container id scoped per modal
  let container = document.getElementById(targetModalId + '-nearby-suggestions');
  if (!container) {
    container = document.createElement('div');
    container.id = targetModalId + '-nearby-suggestions';
    container.className = 'form-section';
    container.style.marginTop = '12px';
    body.appendChild(container);
  }

  if (!items || items.length === 0) {
    container.innerHTML = `
      <div class="form-section-header">
        <div class="form-section-icon"><i data-lucide="search"></i></div>
        <div><div class="form-section-title">Nearby Suggestions</div><div class="form-section-description">No suggestions found</div></div>
      </div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  const listHtml = items.map(it => `
    <div class="nearby-item" style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(it.name)}</div>
        <div style="font-size:12px;color:var(--text-muted);">${it.displayName || ''} • ${(isNaN(it.distance) ? '-' : Math.round(it.distance))} m</div>
      </div>
      <div style="margin-left:12px;display:flex;gap:8px;align-items:center;">
        <button class="btn btn-sm btn-ghost" data-nearby-action="view" data-id="${it.id}" data-type="${it.type}">View</button>
        <button class="btn btn-sm btn-primary" data-nearby-action="add" data-lat="${it.lat}" data-lon="${it.lon}" data-name="${escapeHtml(it.name)}">Add to CRM</button>
      </div>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="form-section-header">
      <div class="form-section-icon"><i data-lucide="search"></i></div>
      <div><div class="form-section-title">Nearby Suggestions</div><div class="form-section-description">Potential companies within chosen radius</div></div>
    </div>
    <div class="form-field" style="padding-top:8px;">${listHtml}</div>
  `;

  // Wire buttons
  container.querySelectorAll('[data-nearby-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const action = btn.dataset.nearbyAction;
      if (action === 'view') {
        // Open element in OpenStreetMap (new tab) using type/node/way/relation
        const elId = btn.dataset.id;
        const elType = (btn.dataset.type || 'node');
        const typePath = (elType === 'way' || elType === 'relation' || elType === 'node') ? elType : 'node';
        if (elId) {
          const osmUrl = `https://www.openstreetmap.org/${typePath}/${elId}`;
          window.open(osmUrl, '_blank');
        } else {
          showToast('Unable to open place in OpenStreetMap', 'error');
        }
        return;
      }

      if (action === 'add') {
        const name = btn.dataset.name || '';
        const lat = btn.dataset.lat;
        const lon = btn.dataset.lon;

        // Close the SafiFind modal (if open) so the edit modal appears on top
        try { closeModal('safifind-modal'); } catch (e) { /* ignore */ }
        // Close the current company view modal as a fallback so the edit modal appears on top
        try { closeModal('company-view-modal'); } catch (e) { /* ignore */ }
        // Open the edit modal pre-filled for creating a new company from suggestion
        openCompanyModal();
        // small timeout to ensure modal inputs exist
        setTimeout(() => {
          const nameEl = document.getElementById('company-name-input');
          const latEl = document.getElementById('company-latitude');
          const lonEl = document.getElementById('company-longitude');
          const addrEl = document.getElementById('company-address');
          if (nameEl) nameEl.value = name;
          if (latEl && lonEl && lat && lon) {
            latEl.value = parseFloat(lat).toFixed(6);
            lonEl.value = parseFloat(lon).toFixed(6);
          }
          if (addrEl) addrEl.value = '';
        }, 80);
        showToast(`Prepared new company: ${name}. Check details and Save.`, 'success');
      }
    });
  });

  if (window.lucide) lucide.createIcons();
}


// ── Exports ────────────────────────────────────────────────────
export {
  geocodeAddressWithOSM,
  calculateDistance,
  buildOverpassQuery,
  searchNearbyOverpass,
  renderNearbySuggestions,
};
