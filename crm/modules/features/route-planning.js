// modules/features/route-planning.js
// Route planning, AI SAFI plan, route list.
import { state, supabaseClient, loadPersistedState as _loadPersistedState } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials } from '../ui/toast.js';
import { renderSkeletonCards, renderError } from '../utils/helpers.js';

function groupRoutesByLocations(routes, routeLocations) {
  // Create a map of route_id to its location signature (sorted company IDs)
  const routeSignatures = {};

  routes.forEach(route => {
    const locations = routeLocations
      .filter(loc => loc.route_id === route.id)
      .sort((a, b) => a.position - b.position)
      .map(loc => loc.company_id);

    // Create a signature from the company IDs in order
    routeSignatures[route.id] = locations.join(',');
  });

  // Group routes by name AND location signature
  const groups = {};

  routes.forEach(route => {
    const signature = routeSignatures[route.id];
    // Use route name + location signature as key to group identical routes
    const groupKey = `${route.name}|${signature}`;

    if (!groups[groupKey]) {
      groups[groupKey] = {
        name: route.name,
        routeIds: [],
        assignees: [],
        created_at: route.created_at,
        estimated_duration: route.estimated_duration,
        total_distance: route.total_distance,
        stopsCount: signature ? signature.split(',').filter(Boolean).length : 0
      };
    }

    groups[groupKey].routeIds.push(route.id);

    if (route.assigned_to) {
      // Avoid duplicates
      const existing = groups[groupKey].assignees.find(a => a.id === route.assigned_to.id);
      if (!existing) {
        groups[groupKey].assignees.push(route.assigned_to);
      }
    }
  });

  // Convert to array and sort by created date
  return Object.values(groups).sort((a, b) =>
    new Date(b.created_at) - new Date(a.created_at)
  );
}

async function renderRoutePlanningView() {
  // Fetch companies, sales reps, and existing routes
  const orgId = state.currentOrganization?.id;
  let companiesQ = supabaseClient.from('companies').select('*').order('name', { ascending: true });
  let profilesQ = supabaseClient.from('profiles').select('*').eq('role', 'sales_rep').order('first_name', { ascending: true });
  if (orgId) {
    companiesQ = companiesQ.eq('organization_id', orgId);
    profilesQ = profilesQ.eq('organization_id', orgId);
  }
  const [companiesResult, profilesResult, routesResult, routeLocationsResult] = await Promise.all([
    companiesQ,
    profilesQ,
    supabaseClient
      .from('routes')
      .select(`*, assigned_to:profiles!routes_assigned_to_fkey(id, first_name, last_name)`)
      .eq('created_by', state.currentUser.id)
      .order('created_at', { ascending: false }),
    supabaseClient
      .from('route_locations')
      .select('route_id, company_id, position')
      .order('position', { ascending: true })
  ]);

  const { data: companies, error: companiesError } = companiesResult;
  const { data: salesReps, error: profilesError } = profilesResult;
  const { data: routes, error: routesError } = routesResult;
  const { data: routeLocations, error: routeLocationsError } = routeLocationsResult;

  if (companiesError || profilesError || routesError || routeLocationsError) {
    viewContainer.innerHTML = renderError('Error loading data');
    return;
  }

  // Group routes by their locations (same stops = same route)
  const groupedRoutes = groupRoutesByLocations(routes, routeLocations);

  // Filter companies with valid coordinates
  const validCompanies = companies.filter(c => c.latitude && c.longitude);

  let html = `
    <div class="page-header" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
      <button class="btn btn-primary ai-safi-plan-btn" id="open-ai-safi-plan">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/></svg>
        A.I SAFI PLAN
      </button>
    </div>

    <div class="route-planning-container">
      <!-- Left Panel: Company Selection -->
      <div class="company-selection-panel">
        <div class="panel-header">
          <div class="panel-title">Available Companies</div>
          <div class="panel-subtitle">${validCompanies.length} locations</div>
        </div>
        
        <div class="panel-search">
          <i data-lucide="search"></i>
          <input type="text" id="company-search-input" placeholder="Search companies...">
        </div>
        
        <div class="panel-body" id="companies-list">
          ${validCompanies.length === 0 ? `
            <div class="panel-empty">
              <div class="panel-empty-icon">📍</div>
              <div class="panel-empty-text">No companies with coordinates</div>
            </div>
          ` : validCompanies.map(company => `
            <div class="company-quick-card" data-company-id="${company.id}" data-lat="${company.latitude}" data-lng="${company.longitude}">
              <div class="company-card-name">
                ${company.name}
              </div>
              <div class="company-card-address">${company.address || 'No address'}</div>
              <div class="company-card-footer">
                <div class="company-card-distance"></div>
                <button class="company-card-add-btn">+ Add</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Center Panel: Route Builder -->
      <div class="route-builder-panel">
        <div class="route-stats-card">
          <div class="route-stats-grid">
            <div class="route-stat-item">
              <span class="route-stat-value" id="route-stops-count">0</span>
              <span class="route-stat-label">Stops</span>
            </div>
            <div class="route-stat-item">
              <span class="route-stat-value" id="route-distance">0 km</span>
              <span class="route-stat-label">Distance</span>
            </div>
            <div class="route-stat-item">
              <span class="route-stat-value" id="route-duration">0 min</span>
              <span class="route-stat-label">Est. Time</span>
            </div>
          </div>
          
          <div class="route-assignment">
            <input type="text" id="route-name-input" placeholder="Route name (e.g., Downtown Route)">
            <select id="route-rep-select">
              <option value="">Assign to...</option>
              ${salesReps.map(rep => `
                <option value="${rep.id}">${rep.first_name} ${rep.last_name}</option>
              `).join('')}
            </select>
          </div>
        </div>
        
        <div class="route-stops-container" id="route-stops-container">
          <div class="route-stops-empty">
            <div class="route-stops-empty-icon">🗺️</div>
            <div class="route-stops-empty-text">No stops added yet</div>
            <div class="route-stops-empty-hint">Click "+ Add" on companies to build your route</div>
          </div>
        </div>
        
        <div class="route-actions">
          <button class="btn btn-secondary" id="optimize-route-btn" style="display: none;">
            Optimize
          </button>
          <button class="btn btn-primary" id="save-route-btn" style="display: none;">
            Save Route
          </button>
        </div>
      </div>

      <!-- Right Panel: Map Preview -->
      <div class="map-preview-panel">
        <div class="panel-header">
          <div class="panel-title">Route Preview</div>
          <div class="panel-subtitle">Live map view</div>
        </div>
        
        <div class="route-map-container">
          <div id="route-planning-map" style="display: none;"></div>
          <div class="map-empty-state" id="map-empty-state">
            <div class="map-empty-icon">🗺️</div>
            <div>Add stops to see route on map</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Existing Routes Section -->
    <div class="card mt-3">
      <div class="card-header">
        <h3 class="card-title">Existing Routes</h3>
      </div>
      <div class="routes-list">
        ${groupedRoutes.length === 0 ?
      '<p class="text-muted text-center u-p-xl">No routes created yet</p>' :
      groupedRoutes.map(group => `
            <div class="route-item" data-id="${group.routeIds[0]}" data-route-ids="${group.routeIds.join(',')}">
              <div class="route-info">
                <h4>${group.name}</h4>
                <div class="route-assignees">
                  <span class="route-assignees-label">Assigned to:</span>
                  <div class="route-assignees-list">
                    ${group.assignees.length === 0 ? '<span class="text-muted">Unassigned</span>' :
          group.assignees.map(assignee => `
                        <span class="route-assignee-tag">
                          <span class="assignee-avatar">${assignee.first_name.charAt(0)}${assignee.last_name.charAt(0)}</span>
                          ${assignee.first_name} ${assignee.last_name}
                        </span>
                      `).join('')}
                  </div>
                </div>
                <p class="route-meta-info">
                  <span>Created: ${formatDate(group.created_at)}</span>
                  ${group.estimated_duration ? `<span>• Est. duration: ${group.estimated_duration} min</span>` : ''}
                  ${group.stopsCount ? `<span>• ${group.stopsCount} stops</span>` : ''}
                </p>
              </div>
              <div class="route-actions">
                <button class="btn btn-sm btn-ghost view-route-btn" data-id="${group.routeIds[0]}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
                <button class="btn btn-sm btn-ghost edit-route-btn" data-id="${group.routeIds[0]}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-pen-icon lucide-square-pen"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>
                </button>
                <button class="btn btn-sm btn-ghost delete-route-btn" data-id="${group.routeIds.join(',')}" data-route-name="${group.name}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
          `).join('')
    }
      </div>
    </div>
  `;

  viewContainer.innerHTML = html;

  // Initialize route planning functionality
  initRoutePlanning(validCompanies, salesReps);

  // Initialize route list functionality
  initRouteList();

  // Initialize AI SAFI PLAN
  initAISafiPlan(companies, salesReps);
}

function initRoutePlanning(companies, salesReps) {
  let routeStops = [];
  let map = null;
  let markers = [];
  let routeLine = null;
  let sortable = null;

  const searchInput = document.getElementById('company-search-input');
  const companiesList = document.getElementById('companies-list');
  const stopsContainer = document.getElementById('route-stops-container');
  const optimizeBtn = document.getElementById('optimize-route-btn');
  const saveBtn = document.getElementById('save-route-btn');
  const routeNameInput = document.getElementById('route-name-input');
  const routeRepSelect = document.getElementById('route-rep-select');
  const mapContainer = document.getElementById('route-planning-map');
  const mapEmptyState = document.getElementById('map-empty-state');

  // Restore active route builder state
  const savedState = _loadPersistedState().routePlan || {};
  if (savedState.stops && savedState.stops.length > 0) {
    routeStops = savedState.stops;
  }
  if (savedState.name && routeNameInput) routeNameInput.value = savedState.name;
  if (savedState.rep && routeRepSelect) routeRepSelect.value = savedState.rep;

  function saveRouteBuilderState() {
    const currentSearch = _loadPersistedState().routePlan?.search || '';
    saveViewState({
      routePlan: {
        search: currentSearch,
        stops: routeStops,
        name: routeNameInput ? routeNameInput.value : '',
        rep: routeRepSelect ? routeRepSelect.value : ''
      }
    });
  }

  if (routeNameInput) routeNameInput.addEventListener('input', saveRouteBuilderState);
  if (routeRepSelect) routeRepSelect.addEventListener('change', saveRouteBuilderState);

  // Restore visual added state on company cards 
  if (routeStops.length > 0) {
    setTimeout(() => {
      routeStops.forEach(stop => {
        const card = companiesList.querySelector(`[data-company-id="${stop.id}"]`);
        if (card) {
          card.classList.add('added');
          const addBtn = card.querySelector('.company-card-add-btn');
          if (addBtn) addBtn.textContent = '✓ Added';
        }
      });
      updateRouteDisplay();
    }, 50);
  }

  // Search functionality
  if (searchInput) {
    const savedSearch = _loadPersistedState().routePlan?.search || '';
    if (savedSearch) {
      searchInput.value = savedSearch;
      setTimeout(() => searchInput.dispatchEvent(new Event('input')), 50);
    }

    searchInput.addEventListener('input', (e) => {
      const searchTerm = e.target.value.toLowerCase();
      saveViewState({ routePlan: { search: e.target.value } });
      const companyCards = companiesList.querySelectorAll('.company-quick-card');

      companyCards.forEach(card => {
        const name = card.querySelector('.company-card-name').textContent.toLowerCase();
        const address = card.querySelector('.company-card-address').textContent.toLowerCase();

        if (name.includes(searchTerm) || address.includes(searchTerm)) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
      });
    });
  }

  // Add company to route
  companiesList.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.company-card-add-btn');
    if (!addBtn) return;

    const card = addBtn.closest('.company-quick-card');
    const companyId = card.dataset.companyId;

    // Check if already added
    if (routeStops.find(stop => stop.id === companyId)) {
      showToast('Company already added to route', 'warning');
      return;
    }

    const company = companies.find(c => c.id === companyId);
    if (!company) return;

    // Add to route
    routeStops.push({
      id: company.id,
      name: company.name,
      address: company.address,
      latitude: parseFloat(company.latitude),
      longitude: parseFloat(company.longitude)
    });

    // Mark as added
    card.classList.add('added');
    addBtn.textContent = '✓ Added';

    updateRouteDisplay();
  });

  function updateRouteDisplay() {
    // Update stats
    document.getElementById('route-stops-count').textContent = routeStops.length;

    if (routeStops.length === 0) {
      stopsContainer.innerHTML = `
        <div class="route-stops-empty">
          <div class="route-stops-empty-icon">🗺️</div>
          <div class="route-stops-empty-text">No stops added yet</div>
          <div class="route-stops-empty-hint">Click "+ Add" on companies to build your route</div>
        </div>
      `;
      optimizeBtn.style.display = 'none';
      saveBtn.style.display = 'none';

      // Hide map
      if (map) {
        mapContainer.style.display = 'none';
        mapEmptyState.style.display = 'flex';
      }

      return;
    }

    // Show action buttons
    if (routeStops.length >= 2) {
      optimizeBtn.style.display = 'block';
    }
    saveBtn.style.display = 'block';

    // Render stops
    stopsContainer.innerHTML = routeStops.map((stop, index) => `
      <div class="route-stop-item" data-stop-id="${stop.id}">
        <div class="route-stop-number">${index + 1}</div>
        <div class="route-stop-info">
          <div class="route-stop-name">${stop.name}</div>
          <div class="route-stop-address">${stop.address || 'No address'}</div>
        </div>
        <button class="route-stop-remove" data-stop-id="${stop.id}">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
          </svg>
        </button>
      </div>
    `).join('');

    // Initialize sortable
    if (sortable) {
      sortable.destroy();
    }

    sortable = new Sortable(stopsContainer, {
      animation: 120,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      delayOnTouchOnly: true,
      touchStartThreshold: 4,
      handle: '.route-stop-item',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onStart: function () {
        document.body.classList.add('is-dragging');
      },
      onEnd: function () {
        document.body.classList.remove('is-dragging');
        // Update routeStops array based on new order
        const newOrder = [];
        stopsContainer.querySelectorAll('.route-stop-item').forEach(item => {
          const stopId = item.dataset.stopId;
          const stop = routeStops.find(s => s.id === stopId);
          if (stop) newOrder.push(stop);
        });
        routeStops = newOrder;
        updateRouteDisplay();
      }
    });

    // Add remove button listeners
    stopsContainer.querySelectorAll('.route-stop-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const stopId = btn.dataset.stopId;
        removeStop(stopId);
      });
    });

    // Calculate and update distance/time
    updateRouteMetrics();

    // Update map
    updateMap();
    saveRouteBuilderState();
  }

  function removeStop(stopId) {
    routeStops = routeStops.filter(stop => stop.id !== stopId);

    // Unmark company card
    const card = companiesList.querySelector(`[data-company-id="${stopId}"]`);
    if (card) {
      card.classList.remove('added');
      const btn = card.querySelector('.company-card-add-btn');
      if (btn) btn.textContent = '+ Add';
    }

    updateRouteDisplay();
  }

  function updateRouteMetrics() {
    if (routeStops.length < 2) {
      document.getElementById('route-distance').textContent = '0 km';
      document.getElementById('route-duration').textContent = '0 min';
      return;
    }

    let totalDistance = 0;
    for (let i = 0; i < routeStops.length - 1; i++) {
      const dist = calculateDistance(
        routeStops[i].latitude,
        routeStops[i].longitude,
        routeStops[i + 1].latitude,
        routeStops[i + 1].longitude
      );
      totalDistance += dist;
    }

    const avgSpeed = 40; // km/h average speed
    const estimatedTime = Math.round((totalDistance / avgSpeed) * 60);

    document.getElementById('route-distance').textContent = totalDistance.toFixed(1) + ' km';
    document.getElementById('route-duration').textContent = estimatedTime + ' min';
  }

  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function updateMap() {
    if (routeStops.length === 0) return;

    // Initialize map if needed
    if (!map) {
      mapEmptyState.style.display = 'none';
      mapContainer.style.display = 'block';

      map = L.map('route-planning-map').setView([routeStops[0].latitude, routeStops[0].longitude], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);
    }

    // Clear existing markers and lines
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];
    if (routeLine) {
      map.removeLayer(routeLine);
    }

    // Add markers for each stop
    const bounds = [];
    routeStops.forEach((stop, index) => {
      const marker = L.marker([stop.latitude, stop.longitude], {
        icon: L.divIcon({
          className: 'custom-marker',
          html: `<div style="background: #2f5fd0; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${index + 1}</div>`,
          iconSize: [32, 32]
        })
      }).addTo(map);

      marker.bindPopup(`<strong>${stop.name}</strong><br>${stop.address || ''}`);
      markers.push(marker);
      bounds.push([stop.latitude, stop.longitude]);
    });

    // Draw route line
    if (routeStops.length >= 2) {
      const latlngs = routeStops.map(stop => [stop.latitude, stop.longitude]);
      routeLine = L.polyline(latlngs, {
        color: '#2f5fd0',
        weight: 3,
        opacity: 0.7
      }).addTo(map);
    }

    // Fit map to bounds
    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }

  // Optimize route (nearest neighbor algorithm)
  optimizeBtn.addEventListener('click', () => {
    if (routeStops.length < 2) return;

    const optimized = [routeStops[0]]; // Start with first stop
    let remaining = routeStops.slice(1);

    while (remaining.length > 0) {
      const current = optimized[optimized.length - 1];
      let nearestIndex = 0;
      let nearestDistance = Infinity;

      remaining.forEach((stop, index) => {
        const dist = calculateDistance(
          current.latitude,
          current.longitude,
          stop.latitude,
          stop.longitude
        );
        if (dist < nearestDistance) {
          nearestDistance = dist;
          nearestIndex = index;
        }
      });

      optimized.push(remaining[nearestIndex]);
      remaining.splice(nearestIndex, 1);
    }

    routeStops = optimized;
    updateRouteDisplay();
    showToast('Route optimized!', 'success');
  });

  // Save route
  saveBtn.addEventListener('click', async () => {
    const routeName = routeNameInput.value.trim();
    const assignedTo = routeRepSelect.value;

    if (!routeName) {
      showToast('Please enter a route name', 'error');
      return;
    }

    if (routeStops.length === 0) {
      showToast('Please add at least one stop', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      // Calculate total distance
      let totalDistance = 0;
      for (let i = 0; i < routeStops.length - 1; i++) {
        totalDistance += calculateDistance(
          routeStops[i].latitude,
          routeStops[i].longitude,
          routeStops[i + 1].latitude,
          routeStops[i + 1].longitude
        );
      }

      // Create route in database
      const routeData = {
        name: routeName,
        assigned_to: assignedTo || null,
        estimated_duration: parseInt(document.getElementById('route-duration').textContent),
        total_distance: Math.round(totalDistance * 1000), // Convert to meters
        created_by: state.currentUser.id,
        organization_id: state.currentOrganization?.id
      };

      const { data: route, error: routeError } = await supabaseClient
        .from('routes')
        .insert([routeData])
        .select();

      if (routeError) throw routeError;

      if (!route || route.length === 0) {
        throw new Error('Route was created but no data was returned');
      }

      const newRouteId = route[0].id;

      // Create route locations
      const routeLocationsData = routeStops.map((stop, index) => ({
        route_id: newRouteId,
        company_id: stop.id,
        position: index + 1
      }));

      const { error: locationsError } = await supabaseClient
        .from('route_locations')
        .insert(routeLocationsData);

      if (locationsError) throw locationsError;

      showToast('Route saved successfully!', 'success');

      // Reset form
      routeStops = [];
      routeNameInput.value = '';
      routeRepSelect.value = '';

      // Unmark all company cards
      companiesList.querySelectorAll('.company-quick-card.added').forEach(card => {
        card.classList.remove('added');
        const btn = card.querySelector('.company-card-add-btn');
        if (btn) btn.textContent = '+ Add';
      });

      // Clear stats
      document.getElementById('route-stops-count').textContent = '0';
      document.getElementById('route-distance').textContent = '0 km';
      document.getElementById('route-duration').textContent = '0 min';

      updateRouteDisplay();

      // Refresh the entire view to show new route in the list
      setTimeout(() => {
        renderRoutePlanningView();
      }, 500);

    } catch (error) {
      console.error('Error saving route:', error);
      showToast('Error saving route: ' + error.message, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save Route';
    }
  });

  // AI Nearest Location Recommendation
  function showNearestLocationRecommendation() {
    if (routeStops.length === 0) return;

    const lastStop = routeStops[routeStops.length - 1];
    let nearestCompany = null;
    let shortestDistance = Infinity;

    // Find nearest company that's not already in route
    companies.forEach(company => {
      // Skip if already in route
      if (routeStops.find(stop => stop.id === company.id)) return;

      const dist = calculateDistance(
        lastStop.latitude,
        lastStop.longitude,
        parseFloat(company.latitude),
        parseFloat(company.longitude)
      );

      if (dist < shortestDistance) {
        shortestDistance = dist;
        nearestCompany = company;
      }
    });

    if (nearestCompany && shortestDistance < 50) { // Only show if within 50km
      // Highlight the nearest company card
      const nearestCard = companiesList.querySelector(`[data-company-id="${nearestCompany.id}"]`);
      if (nearestCard && !nearestCard.classList.contains('added')) {
        // Remove previous highlights
        companiesList.querySelectorAll('.company-quick-card').forEach(card => {
          card.style.boxShadow = '';
          card.style.border = '';
        });

        // Highlight nearest
        nearestCard.style.boxShadow = '0 0 0 2px var(--color-primary)';
        nearestCard.style.border = '1.5px solid var(--color-primary)';

        // Scroll into view
        nearestCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        // Show toast with AI suggestion
        showToast(`💡 AI Suggestion: ${nearestCompany.name} is ${shortestDistance.toFixed(1)}km away`, 'info', 5000);
      }
    }
  }

  // Call AI recommendation after adding a stop
  const originalUpdateRouteDisplay = updateRouteDisplay;
  updateRouteDisplay = function () {
    originalUpdateRouteDisplay();
    if (routeStops.length > 0) {
      setTimeout(() => showNearestLocationRecommendation(), 300);
    }
  };
}


// Global function to select recommended location
window.selectRecommendedLocation = function (locationId) {
  const checkbox = document.querySelector(`#loc-${locationId}`);
  if (checkbox && !checkbox.checked) {
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
  }
};

function initRouteList() {
  // View route details
  document.querySelectorAll('.view-route-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const routeId = btn.dataset.id;
      await viewRouteDetails(routeId);
    });
  });

  // Edit route
  document.querySelectorAll('.edit-route-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const routeId = btn.dataset.id;
      await editRoute(routeId);
    });
  });

  // Delete route
  document.querySelectorAll('.delete-route-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const routeIds = btn.dataset.id.split(','); // Can be multiple IDs
      const routeItem = btn.closest('.route-item');
      const routeName = btn.dataset.routeName || routeItem.querySelector('h4').textContent;
      const assigneeCount = routeIds.length;

      const confirmMessage = assigneeCount > 1
        ? `Are you sure you want to delete route "${routeName}"? This will remove it for all ${assigneeCount} assigned reps.`
        : `Are you sure you want to delete route "${routeName}"?`;

      const confirmed = await showConfirmDialog('Delete Route', confirmMessage);

      if (!confirmed) return;

      try {
        // Delete all route records with these IDs
        const { error } = await supabaseClient
          .from('routes')
          .delete()
          .in('id', routeIds);

        if (error) throw error;

        showToast('Route deleted successfully', 'success');
        routeItem.remove();
      } catch (error) {
        showToast('Error deleting route: ' + error.message, 'error');
      }
    });
  });
}

// ======================
// A.I SAFI PLAN - Intelligent Route Planning
// ======================

function initAISafiPlan(companies, salesReps) {
  const openBtn = document.getElementById('open-ai-safi-plan');
  if (!openBtn) return;

  openBtn.addEventListener('click', () => {
    openAISafiPlanModal(companies, salesReps);
  });
}

function openAISafiPlanModal(companies, salesReps) {
  // Remove existing modal if present
  const existingModal = document.getElementById('ai-safi-plan-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'ai-safi-plan-modal';
  modal.style.display = 'flex';

  modal.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal('ai-safi-plan-modal')"></div>
    <div class="modal-container ai-safi-modal">
      <div class="modal-header ai-safi-header">
        <div class="ai-safi-header-content">
          <div class="ai-safi-logo">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/></svg>
          </div>
          <div>
            <h3>A.I SAFI PLAN</h3>
            <p class="ai-safi-subtitle">Intelligent Route Distribution</p>
          </div>
        </div>
        <button class="modal-close" onclick="closeModal('ai-safi-plan-modal')">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>

      <!-- Wizard Steps Indicator -->
      <div class="ai-safi-steps">
        <div class="ai-safi-step active" data-step="1">
          <div class="step-number">1</div>
          <div class="step-label">Select Reps</div>
        </div>
        <div class="ai-safi-step-line"></div>
        <div class="ai-safi-step" data-step="2">
          <div class="step-number">2</div>
          <div class="step-label">Select Companies</div>
        </div>
        <div class="ai-safi-step-line"></div>
        <div class="ai-safi-step" data-step="3">
          <div class="step-number">3</div>
          <div class="step-label">Generate Routes</div>
        </div>
        <div class="ai-safi-step-line"></div>
        <div class="ai-safi-step" data-step="4">
          <div class="step-number">4</div>
          <div class="step-label">Review & Assign</div>
        </div>
      </div>

      <div class="modal-body ai-safi-body">
        <!-- Step 1: Select Sales Reps -->
        <div class="ai-safi-step-content active" id="ai-safi-step-1">
          <div class="step-intro">
            <h4>Select Sales Representatives</h4>
            <p>Choose the reps you want to assign routes to. The companies will be intelligently distributed based on geographic proximity.</p>
          </div>

          <div class="ai-safi-stats-preview">
            <div class="stat-card">
              <div class="stat-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              </div>
              <div class="stat-info">
                <span class="stat-value">${companies.length}</span>
                <span class="stat-label">Companies</span>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <div class="stat-info">
                <span class="stat-value">${salesReps.length}</span>
                <span class="stat-label">Available Reps</span>
              </div>
            </div>
            <div class="stat-card highlight">
              <div class="stat-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </div>
              <div class="stat-info">
                <span class="stat-value" id="routes-to-create">0</span>
                <span class="stat-label">Routes to Create</span>
              </div>
            </div>
          </div>

          <div class="rep-selection-container">
            <div class="rep-selection-header">
              <span class="selection-count"><span id="selected-reps-count">0</span> reps selected</span>
              <button class="btn btn-ghost btn-sm" id="select-all-reps">Select All</button>
            </div>
            <div class="rep-grid" id="rep-selection-grid">
              ${salesReps.map(rep => `
                <div class="rep-selection-card" data-rep-id="${rep.id}">
                  <div class="rep-checkbox">
                    <input type="checkbox" id="rep-${rep.id}" value="${rep.id}">
                    <label for="rep-${rep.id}"></label>
                  </div>
                  <div class="rep-avatar">${rep.first_name.charAt(0)}${rep.last_name.charAt(0)}</div>
                  <div class="rep-details">
                    <div class="rep-name">${rep.first_name} ${rep.last_name}</div>
                    <div class="rep-email">${rep.email || 'No email'}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Step 2: Select Companies -->
        <div class="ai-safi-step-content" id="ai-safi-step-2">
          <div class="step-intro">
            <h4>Select Companies to Include</h4>
            <p>All companies are selected by default. Uncheck any companies you want to exclude from route planning.</p>
          </div>

          <div class="selection-summary-bar" id="company-selection-summary">
            <span class="selection-summary-text"><strong id="selected-companies-count">${companies.length}</strong> of ${companies.length} companies selected</span>
            <div class="company-selection-actions">
              <button class="btn btn-ghost btn-sm" id="select-all-companies">Select All</button>
              <button class="btn btn-ghost btn-sm" id="deselect-all-companies">Deselect All</button>
            </div>
          </div>

          <div class="company-selection-step">
            <div class="company-selection-header">
              <div class="company-selection-search">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                <input type="text" id="company-search" placeholder="Search companies...">
              </div>
            </div>
            <div class="company-grid-container">
              <div class="company-grid" id="company-selection-grid">
                ${companies.map(company => `
                  <div class="company-select-card selected" data-company-id="${company.id}">
                    <div class="company-select-checkbox">
                      <input type="checkbox" id="company-${company.id}" value="${company.id}" checked>
                      <label for="company-${company.id}"></label>
                    </div>
                    <div class="company-select-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                    </div>
                    <div class="company-select-info">
                      <div class="company-select-name">${company.name}</div>
                      <div class="company-select-address">${company.address || 'No address'}</div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>

        <!-- Step 3: Generating Routes (Processing) -->
        <div class="ai-safi-step-content" id="ai-safi-step-3">
          <div class="ai-processing-container">
            <div class="ai-data-stream">
              <div class="data-particle"></div>
              <div class="data-particle"></div>
              <div class="data-particle"></div>
              <div class="data-particle"></div>
              <div class="data-particle"></div>
              <div class="data-particle"></div>
            </div>
            <div class="ai-processing-animation">
              <div class="ai-brain">
                <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M19.938 10.5a4 4 0 0 1 .585.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M19.967 17.484A4 4 0 0 1 18 18"/></svg>
              </div>
              <div class="ai-pulse-rings">
                <div class="pulse-ring"></div>
                <div class="pulse-ring"></div>
                <div class="pulse-ring"></div>
              </div>
            </div>
            <div class="ai-processing-text">
              <h4>🧠 SAFI Neural Engine Active</h4>
              <p id="ai-processing-status">Initializing route optimization matrix</p>
            </div>
            <div class="ai-progress-bar">
              <div class="ai-progress-fill" id="ai-progress-fill"></div>
            </div>
            <div class="ai-processing-steps">
              <div class="processing-step" id="proc-step-1">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
                <span>Parsing geospatial coordinates</span>
              </div>
              <div class="processing-step" id="proc-step-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
                <span>Running anomaly detection</span>
              </div>
              <div class="processing-step" id="proc-step-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
                <span>Computing spatial clusters</span>
              </div>
              <div class="processing-step" id="proc-step-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
                <span>Optimizing traveling salesman</span>
              </div>
              <div class="processing-step" id="proc-step-5">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
                <span>Finalizing route assignments</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Step 4: Review & Assign Routes -->
        <div class="ai-safi-step-content" id="ai-safi-step-4">
          <div class="step-intro">
            <h4>Review Generated Routes</h4>
            <p>Here are the optimized routes. You can reassign reps or add additional reps to any route.</p>
          </div>

          <!-- Outlier Warning will be inserted here dynamically -->
          <div id="outlier-warning-container"></div>

          <div class="ai-routes-overview" id="ai-routes-overview">
            <!-- Routes will be rendered here -->
          </div>
        </div>
      </div>

      <div class="modal-footer ai-safi-footer">
        <button class="btn btn-secondary" id="ai-safi-back" style="display: none;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          Back
        </button>
        <div class="footer-spacer"></div>
        <button class="btn btn-secondary" onclick="closeModal('ai-safi-plan-modal')">Cancel</button>
        <button class="btn btn-primary" id="ai-safi-next" disabled>
          Continue
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        </button>
        <button class="btn btn-primary btn-success" id="ai-safi-save" style="display: none;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          Save All Routes
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  initAISafiPlanLogic(modal, companies, salesReps);
}

function initAISafiPlanLogic(modal, companies, salesReps) {
  let currentStep = 1;
  let selectedReps = [];
  let selectedCompanies = companies.map(c => c.id); // All companies selected by default
  let generatedRoutes = [];
  let outlierCompanies = []; // Companies that are too far (>100km from centroid)
  const OUTLIER_THRESHOLD_KM = 100; // Distance threshold for outliers

  const nextBtn = modal.querySelector('#ai-safi-next');
  const backBtn = modal.querySelector('#ai-safi-back');
  const saveBtn = modal.querySelector('#ai-safi-save');
  const repGrid = modal.querySelector('#rep-selection-grid');
  const selectAllBtn = modal.querySelector('#select-all-reps');
  const selectedCountEl = modal.querySelector('#selected-reps-count');
  const routesToCreateEl = modal.querySelector('#routes-to-create');

  // Company selection elements
  const companyGrid = modal.querySelector('#company-selection-grid');
  const companySearch = modal.querySelector('#company-search');
  const selectedCompaniesCountEl = modal.querySelector('#selected-companies-count');
  const selectAllCompaniesBtn = modal.querySelector('#select-all-companies');
  const deselectAllCompaniesBtn = modal.querySelector('#deselect-all-companies');

  // Rep selection logic
  repGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.rep-selection-card');
    if (!card) return;

    const checkbox = card.querySelector('input[type="checkbox"]');
    const repId = card.dataset.repId;

    // Only toggle if not clicking directly on checkbox (checkbox handles itself)
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'LABEL') {
      checkbox.checked = !checkbox.checked;
    }

    // Sync state with checkbox
    if (checkbox.checked) {
      card.classList.add('selected');
      if (!selectedReps.includes(repId)) {
        selectedReps.push(repId);
      }
    } else {
      card.classList.remove('selected');
      selectedReps = selectedReps.filter(id => id !== repId);
    }

    updateSelectionUI();
  });

  // Also handle direct checkbox changes
  repGrid.addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    const card = e.target.closest('.rep-selection-card');
    if (!card) return;

    const repId = card.dataset.repId;

    if (e.target.checked) {
      card.classList.add('selected');
      if (!selectedReps.includes(repId)) {
        selectedReps.push(repId);
      }
    } else {
      card.classList.remove('selected');
      selectedReps = selectedReps.filter(id => id !== repId);
    }

    updateSelectionUI();
  });

  selectAllBtn.addEventListener('click', () => {
    const allSelected = selectedReps.length === salesReps.length;

    repGrid.querySelectorAll('.rep-selection-card').forEach(card => {
      const checkbox = card.querySelector('input[type="checkbox"]');
      checkbox.checked = !allSelected;
      card.classList.toggle('selected', !allSelected);
    });

    selectedReps = allSelected ? [] : salesReps.map(r => r.id);
    selectAllBtn.textContent = allSelected ? 'Select All' : 'Deselect All';
    updateSelectionUI();
  });

  // Company selection logic
  companyGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.company-select-card');
    if (!card) return;

    const checkbox = card.querySelector('input[type="checkbox"]');
    const companyId = card.dataset.companyId;

    // Only toggle if not clicking directly on checkbox (checkbox handles itself)
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'LABEL') {
      checkbox.checked = !checkbox.checked;
    }

    // Sync state with checkbox
    if (checkbox.checked) {
      card.classList.add('selected');
      if (!selectedCompanies.includes(companyId)) {
        selectedCompanies.push(companyId);
      }
    } else {
      card.classList.remove('selected');
      selectedCompanies = selectedCompanies.filter(id => id !== companyId);
    }

    updateCompanySelectionUI();
  });

  // Also handle direct checkbox changes
  companyGrid.addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    const card = e.target.closest('.company-select-card');
    if (!card) return;

    const companyId = card.dataset.companyId;

    if (e.target.checked) {
      card.classList.add('selected');
      if (!selectedCompanies.includes(companyId)) {
        selectedCompanies.push(companyId);
      }
    } else {
      card.classList.remove('selected');
      selectedCompanies = selectedCompanies.filter(id => id !== companyId);
    }

    updateCompanySelectionUI();
  });

  selectAllCompaniesBtn.addEventListener('click', () => {
    companyGrid.querySelectorAll('.company-select-card').forEach(card => {
      const checkbox = card.querySelector('input[type="checkbox"]');
      checkbox.checked = true;
      card.classList.add('selected');
    });
    selectedCompanies = companies.map(c => c.id);
    updateCompanySelectionUI();
  });

  deselectAllCompaniesBtn.addEventListener('click', () => {
    companyGrid.querySelectorAll('.company-select-card').forEach(card => {
      const checkbox = card.querySelector('input[type="checkbox"]');
      checkbox.checked = false;
      card.classList.remove('selected');
    });
    selectedCompanies = [];
    updateCompanySelectionUI();
  });

  // Company search
  companySearch.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    companyGrid.querySelectorAll('.company-select-card').forEach(card => {
      const companyId = card.dataset.companyId;
      const company = companies.find(c => c.id === companyId);
      const match = !query || (company && matchesTokenizedQuery(query, company.name, company.description, company.address));
      card.style.display = match ? '' : 'none';
    });
  });

  function updateCompanySelectionUI() {
    selectedCompaniesCountEl.textContent = selectedCompanies.length;
    nextBtn.disabled = selectedCompanies.length === 0;
  }

  function updateSelectionUI() {
    selectedCountEl.textContent = selectedReps.length;
    routesToCreateEl.textContent = selectedReps.length;
    nextBtn.disabled = selectedReps.length === 0;

    // Animate the routes count
    routesToCreateEl.classList.add('animate-pop');
    setTimeout(() => routesToCreateEl.classList.remove('animate-pop'), 300);
  }

  // Navigation
  nextBtn.addEventListener('click', async () => {
    if (currentStep === 1) {
      goToStep(2);
    } else if (currentStep === 2) {
      goToStep(3);
      await generateRoutes();
    }
  });

  backBtn.addEventListener('click', () => {
    if (currentStep === 2) {
      goToStep(1);
    } else if (currentStep === 4) {
      goToStep(2);
    }
  });

  saveBtn.addEventListener('click', async () => {
    await saveAllRoutes();
  });

  function goToStep(step) {
    currentStep = step;

    // Update step indicators
    modal.querySelectorAll('.ai-safi-step').forEach(s => {
      const stepNum = parseInt(s.dataset.step);
      s.classList.remove('active', 'completed');
      if (stepNum === step) s.classList.add('active');
      if (stepNum < step) s.classList.add('completed');
    });

    // Update step content visibility
    modal.querySelectorAll('.ai-safi-step-content').forEach(c => c.classList.remove('active'));
    modal.querySelector(`#ai-safi-step-${step}`).classList.add('active');

    // Update buttons based on step
    if (step === 1) {
      backBtn.style.display = 'none';
      nextBtn.style.display = 'flex';
      saveBtn.style.display = 'none';
      nextBtn.disabled = selectedReps.length === 0;
    } else if (step === 2) {
      backBtn.style.display = 'flex';
      nextBtn.style.display = 'flex';
      saveBtn.style.display = 'none';
      nextBtn.disabled = selectedCompanies.length === 0;
    } else if (step === 3) {
      backBtn.style.display = 'none';
      nextBtn.style.display = 'none';
      saveBtn.style.display = 'none';
    } else if (step === 4) {
      backBtn.style.display = 'flex';
      nextBtn.style.display = 'none';
      saveBtn.style.display = 'flex';
    }
  }

  async function generateRoutes() {
    const progressFill = modal.querySelector('#ai-progress-fill');
    const statusText = modal.querySelector('#ai-processing-status');

    // AI-like status messages for each step
    const aiMessages = {
      step1: [
        'Parsing geospatial input vectors',
        'Loading coordinate matrices',
        'Indexing location data points'
      ],
      step2: [
        'Running K-means anomaly detection',
        'Calculating distance thresholds',
        'Flagging outlier coordinates'
      ],
      step3: [
        'Applying DBSCAN clustering',
        'Computing cluster centroids',
        'Building proximity graphs'
      ],
      step4: [
        'Solving TSP with nearest neighbor',
        'Minimizing total travel distance',
        'Reordering waypoints'
      ],
      step5: [
        'Mapping clusters to agents',
        'Balancing workload distribution',
        'Finalizing allocations'
      ]
    };

    // Animate processing steps with tech-y messages
    const animateStep = async (stepId, stepKey, progress) => {
      const stepEl = modal.querySelector(`#${stepId}`);
      stepEl.classList.add('active');
      stepEl.querySelector('svg').innerHTML = '<circle cx="12" cy="12" r="10" class="spinner-circle"/>';

      const messages = aiMessages[stepKey];
      for (let i = 0; i < messages.length; i++) {
        statusText.textContent = messages[i] + '...';
        await delay(200);
      }

      progressFill.style.width = `${progress}%`;
      stepEl.classList.remove('active');
      stepEl.classList.add('completed');
      stepEl.querySelector('svg').innerHTML = '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>';
    };

    await animateStep('proc-step-1', 'step1', 20);
    await animateStep('proc-step-2', 'step2', 40);
    await animateStep('proc-step-3', 'step3', 60);
    await animateStep('proc-step-4', 'step4', 80);
    await animateStep('proc-step-5', 'step5', 100);

    // Get selected companies
    const selectedCompanyObjects = companies.filter(c => selectedCompanies.includes(c.id));

    // Detect outliers and generate routes
    const result = distributeCompaniesToRoutes(selectedCompanyObjects, selectedReps, salesReps);
    generatedRoutes = result.routes;
    outlierCompanies = result.outliers;

    statusText.textContent = '✓ Optimization complete';
    const titleEl = modal.querySelector('.ai-processing-text h4');
    if (titleEl) titleEl.textContent = '✨ Routes optimized successfully';
    await delay(600);

    // Render routes preview with outlier warning
    renderRoutesPreview(modal, generatedRoutes, salesReps, outlierCompanies);

    goToStep(4);
  }

  function distributeCompaniesToRoutes(companiesForRoutes, selectedRepIds, allReps) {
    const numRoutes = selectedRepIds.length;
    if (numRoutes === 0 || companiesForRoutes.length === 0) return { routes: [], outliers: [] };

    // Get centroid of all companies for initial distribution
    const centroid = {
      lat: companiesForRoutes.reduce((sum, c) => sum + parseFloat(c.latitude), 0) / companiesForRoutes.length,
      lng: companiesForRoutes.reduce((sum, c) => sum + parseFloat(c.longitude), 0) / companiesForRoutes.length
    };

    // Add angle from centroid for initial clustering
    const companiesWithAngle = companiesForRoutes.map(c => ({
      ...c,
      angle: Math.atan2(
        parseFloat(c.longitude) - centroid.lng,
        parseFloat(c.latitude) - centroid.lat
      )
    })).sort((a, b) => a.angle - b.angle);

    // Initial distribution by angle
    const initialRoutes = [];
    const companiesPerRoute = Math.ceil(companiesWithAngle.length / numRoutes);

    for (let i = 0; i < numRoutes; i++) {
      const startIdx = i * companiesPerRoute;
      const endIdx = Math.min(startIdx + companiesPerRoute, companiesWithAngle.length);
      const routeCompanies = companiesWithAngle.slice(startIdx, endIdx);
      if (routeCompanies.length > 0) {
        initialRoutes.push(routeCompanies);
      }
    }

    // Now optimize each route and exclude locations > 100km apart
    const routes = [];
    const outliers = [];

    initialRoutes.forEach((routeCompanies, i) => {
      if (routeCompanies.length === 0) return;

      // Build optimized route excluding far locations
      const { optimized, excluded } = optimizeRouteWithDistanceLimit(routeCompanies, OUTLIER_THRESHOLD_KM);

      // Add excluded to outliers
      excluded.forEach(company => {
        outliers.push({
          ...company,
          reason: 'distance',
          nearestRouteDistance: company.excludedDistance
        });
      });

      if (optimized.length === 0) return;

      // Calculate route metrics
      let totalDistance = 0;
      for (let j = 0; j < optimized.length - 1; j++) {
        totalDistance += calculateDistanceBetween(
          optimized[j].latitude,
          optimized[j].longitude,
          optimized[j + 1].latitude,
          optimized[j + 1].longitude
        );
      }

      const avgSpeed = 40; // km/h
      const estimatedDuration = Math.round((totalDistance / avgSpeed) * 60);

      routes.push({
        id: `route-${routes.length + 1}`,
        name: `Route ${String.fromCharCode(65 + routes.length)}`,
        companies: optimized,
        assignedReps: [selectedRepIds[i]],
        totalDistance: totalDistance,
        estimatedDuration: estimatedDuration,
        color: getRouteColor(routes.length)
      });
    });

    return { routes, outliers };
  }

  // Optimize route order while excluding locations that are > maxDistance km from any other location in the route
  function optimizeRouteWithDistanceLimit(companies, maxDistance) {
    if (companies.length === 0) return { optimized: [], excluded: [] };
    if (companies.length === 1) return { optimized: companies, excluded: [] };

    const optimized = [companies[0]];
    let remaining = companies.slice(1);
    const excluded = [];

    while (remaining.length > 0) {
      const current = optimized[optimized.length - 1];
      let nearestIndex = 0;
      let nearestDistance = Infinity;

      // Find nearest company
      remaining.forEach((company, index) => {
        const dist = calculateDistanceBetween(
          current.latitude, current.longitude,
          company.latitude, company.longitude
        );
        if (dist < nearestDistance) {
          nearestDistance = dist;
          nearestIndex = index;
        }
      });

      // If nearest is within limit, add to route
      if (nearestDistance <= maxDistance) {
        optimized.push(remaining[nearestIndex]);
        remaining.splice(nearestIndex, 1);
      } else {
        // All remaining companies are too far - exclude them
        remaining.forEach(company => {
          // Calculate nearest distance to any company in optimized route
          let minDist = Infinity;
          optimized.forEach(opt => {
            const dist = calculateDistanceBetween(
              company.latitude, company.longitude,
              opt.latitude, opt.longitude
            );
            if (dist < minDist) minDist = dist;
          });
          excluded.push({
            ...company,
            excludedDistance: Math.round(minDist)
          });
        });
        break;
      }
    }

    return { optimized, excluded };
  }

  function optimizeRouteOrder(companies) {
    if (companies.length <= 2) return companies;

    const optimized = [companies[0]];
    let remaining = companies.slice(1);

    while (remaining.length > 0) {
      const current = optimized[optimized.length - 1];
      let nearestIndex = 0;
      let nearestDistance = Infinity;

      remaining.forEach((company, index) => {
        const dist = calculateDistanceBetween(
          current.latitude, current.longitude,
          company.latitude, company.longitude
        );
        if (dist < nearestDistance) {
          nearestDistance = dist;
          nearestIndex = index;
        }
      });

      optimized.push(remaining[nearestIndex]);
      remaining.splice(nearestIndex, 1);
    }

    return optimized;
  }

  function calculateDistanceBetween(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function getRouteColor(index) {
    const colors = ['#2f5fd0', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
    return colors[index % colors.length];
  }

  function renderRoutesPreview(modal, routes, allReps, outliers = []) {
    const container = modal.querySelector('#ai-routes-overview');
    const outlierContainer = modal.querySelector('#outlier-warning-container');

    // Render outlier warning if any
    if (outliers.length > 0) {
      outlierContainer.innerHTML = `
        <div class="outlier-warning">
          <div class="outlier-warning-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
          </div>
          <div class="outlier-warning-content">
            <div class="outlier-warning-title">Locations Left Out</div>
            <div class="outlier-warning-text">
              The following ${outliers.length} location${outliers.length > 1 ? 's were' : ' was'} left out because ${outliers.length > 1 ? 'they are' : 'it is'} more than 100km from any nearby location in the assigned routes. <strong>There are not enough reps to cover all areas.</strong> Consider adding more reps to include these locations.
            </div>
            <div class="outlier-locations">
              ${outliers.map(company => `
                <div class="outlier-location-tag">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                  <span class="outlier-name">${company.name}</span>
                  <span class="outlier-distance">${company.nearestRouteDistance || Math.round(company.excludedDistance)} km to nearest stop</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    } else {
      outlierContainer.innerHTML = '';
    }

    if (routes.length === 0) {
      container.innerHTML = '<p class="text-muted text-center">No routes generated</p>';
      return;
    }

    let html = `
      <div class="routes-summary-bar">
        <div class="summary-item">
          <strong>${routes.length}</strong> Routes Created
        </div>
        <div class="summary-item">
          <strong>${routes.reduce((sum, r) => sum + r.companies.length, 0)}</strong> Companies Distributed
        </div>
        <div class="summary-item">
          <strong>${routes.reduce((sum, r) => sum + r.totalDistance, 0).toFixed(1)} km</strong> Total Distance
        </div>
      </div>

      <div class="routes-preview-grid">
        ${routes.map((route, routeIndex) => `
          <div class="route-preview-card" data-route-index="${routeIndex}">
            <div class="route-preview-header" style="border-left: 4px solid ${route.color}">
              <div class="route-header-info">
                <input type="text" class="route-name-input" value="${route.name}" data-route-index="${routeIndex}">
                <div class="route-meta">
                  <span><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg> ${route.companies.length} stops</span>
                  <span><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${route.estimatedDuration} min</span>
                  <span><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> ${route.totalDistance.toFixed(1)} km</span>
                </div>
              </div>
              <button class="btn btn-ghost btn-sm toggle-route-details">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
              </button>
            </div>

            <div class="route-preview-reps">
              <label>Assigned to:</label>
              <div class="assigned-reps-container" data-route-index="${routeIndex}">
                ${route.assignedReps.map(repId => {
      const rep = allReps.find(r => r.id === repId);
      return rep ? `
                    <div class="assigned-rep-tag switchable" data-rep-id="${repId}" data-route-index="${routeIndex}" title="Click to switch rep">
                      <span class="rep-avatar-sm">${rep.first_name.charAt(0)}${rep.last_name.charAt(0)}</span>
                      <span>${rep.first_name} ${rep.last_name}</span>
                      <svg class="switch-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>
                      ${route.assignedReps.length > 1 ? `<button class="remove-rep-btn" data-rep-id="${repId}">×</button>` : ''}
                    </div>
                  ` : '';
    }).join('')}
                <button class="add-rep-btn" data-route-index="${routeIndex}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>
                  Add Rep
                </button>
              </div>
            </div>

            <div class="route-preview-companies collapsed">
              <div class="companies-list-header">Companies in this route:</div>
              <div class="route-companies-list">
                ${route.companies.map((company, idx) => `
                  <div class="route-company-item">
                    <div class="company-order" style="background: ${route.color}">${idx + 1}</div>
                    <div class="company-info">
                      <div class="company-name">${company.name}</div>
                      <div class="company-address">${company.address || 'No address'}</div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>

            <div class="route-preview-map" id="route-preview-map-${routeIndex}"></div>
          </div>
        `).join('')}
      </div>
    `;

    container.innerHTML = html;

    // Initialize route maps
    setTimeout(() => {
      routes.forEach((route, index) => {
        initRoutePreviewMap(`route-preview-map-${index}`, route);
      });
    }, 100);

    // Toggle route details
    container.querySelectorAll('.toggle-route-details').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.route-preview-card');
        const companies = card.querySelector('.route-preview-companies');
        companies.classList.toggle('collapsed');
        btn.querySelector('svg').style.transform = companies.classList.contains('collapsed') ? '' : 'rotate(180deg)';
      });
    });

    // Route name editing
    container.querySelectorAll('.route-name-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const routeIndex = parseInt(e.target.dataset.routeIndex);
        generatedRoutes[routeIndex].name = e.target.value;
      });
    });

    // Switch rep - click on rep tag to change
    container.querySelectorAll('.assigned-rep-tag.switchable').forEach(tag => {
      tag.addEventListener('click', (e) => {
        // Don't trigger if clicking remove button
        if (e.target.closest('.remove-rep-btn')) return;

        const routeIndex = parseInt(tag.dataset.routeIndex);
        const currentRepId = tag.dataset.repId;
        showSwitchRepDropdown(tag, routeIndex, currentRepId, allReps, generatedRoutes, container, outliers);
      });
    });

    // Add rep button
    container.querySelectorAll('.add-rep-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const routeIndex = parseInt(btn.dataset.routeIndex);
        showAddRepDropdown(btn, routeIndex, allReps, generatedRoutes, container, outliers);
      });
    });

    // Remove rep button
    container.querySelectorAll('.remove-rep-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const repId = btn.dataset.repId;
        const card = btn.closest('.route-preview-card');
        const routeIndex = parseInt(card.dataset.routeIndex);
        generatedRoutes[routeIndex].assignedReps = generatedRoutes[routeIndex].assignedReps.filter(id => id !== repId);
        renderRoutesPreview(modal, generatedRoutes, allReps, outliers);
      });
    });
  }

  // Dropdown for switching a rep on a route
  function showSwitchRepDropdown(tag, routeIndex, currentRepId, allReps, routes, container, outliers) {
    // Remove existing dropdowns
    document.querySelectorAll('.add-rep-dropdown').forEach(d => d.remove());

    const route = routes[routeIndex];
    // Get reps not already on this route (excluding current)
    const availableReps = allReps.filter(r => r.id !== currentRepId && !route.assignedReps.includes(r.id));

    if (availableReps.length === 0) {
      showToast('No other reps available to switch to', 'info');
      return;
    }

    const dropdown = document.createElement('div');
    dropdown.className = 'add-rep-dropdown switch-dropdown';
    dropdown.innerHTML = `
      <div class="dropdown-header">Switch to:</div>
      ${availableReps.map(rep => `
        <div class="dropdown-rep-option" data-rep-id="${rep.id}">
          <span class="rep-avatar-sm">${rep.first_name.charAt(0)}${rep.last_name.charAt(0)}</span>
          <span>${rep.first_name} ${rep.last_name}</span>
        </div>
      `).join('')}
    `;

    tag.style.position = 'relative';
    tag.appendChild(dropdown);

    dropdown.querySelectorAll('.dropdown-rep-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const newRepId = opt.dataset.repId;
        // Replace the current rep with new one
        const repIndex = routes[routeIndex].assignedReps.indexOf(currentRepId);
        if (repIndex > -1) {
          routes[routeIndex].assignedReps[repIndex] = newRepId;
        }
        dropdown.remove();
        renderRoutesPreview(modal, routes, allReps, outliers);
      });
    });

    // Close dropdown on outside click
    setTimeout(() => {
      document.addEventListener('click', function closeDropdown(e) {
        if (!dropdown.contains(e.target) && !tag.contains(e.target)) {
          dropdown.remove();
          document.removeEventListener('click', closeDropdown);
        }
      });
    }, 10);
  }

  function initRoutePreviewMap(containerId, route) {
    const container = document.getElementById(containerId);
    if (!container || route.companies.length === 0) return;

    const map = L.map(containerId, {
      zoomControl: false,
      attributionControl: false
    }).setView([route.companies[0].latitude, route.companies[0].longitude], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    // Add markers
    const bounds = [];
    route.companies.forEach((company, idx) => {
      const marker = L.marker([company.latitude, company.longitude], {
        icon: L.divIcon({
          className: 'custom-marker',
          html: `<div style="background: ${route.color}; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">${idx + 1}</div>`,
          iconSize: [24, 24]
        })
      }).addTo(map);
      bounds.push([company.latitude, company.longitude]);
    });

    // Draw route line
    if (route.companies.length >= 2) {
      const latlngs = route.companies.map(c => [c.latitude, c.longitude]);
      L.polyline(latlngs, { color: route.color, weight: 3, opacity: 0.8 }).addTo(map);
    }

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [20, 20] });
    }
  }

  function showAddRepDropdown(btn, routeIndex, allReps, routes, container, outliers) {
    // Remove existing dropdown
    document.querySelectorAll('.add-rep-dropdown').forEach(d => d.remove());

    const route = routes[routeIndex];
    const availableReps = allReps.filter(r => !route.assignedReps.includes(r.id));

    if (availableReps.length === 0) {
      showToast('All reps are already assigned to this route', 'info');
      return;
    }

    const dropdown = document.createElement('div');
    dropdown.className = 'add-rep-dropdown';
    dropdown.innerHTML = `
      <div class="dropdown-header">Add rep:</div>
      ${availableReps.map(rep => `
        <div class="dropdown-rep-option" data-rep-id="${rep.id}">
          <span class="rep-avatar-sm">${rep.first_name.charAt(0)}${rep.last_name.charAt(0)}</span>
          <span>${rep.first_name} ${rep.last_name}</span>
        </div>
      `).join('')}
    `;

    btn.style.position = 'relative';
    btn.appendChild(dropdown);

    dropdown.querySelectorAll('.dropdown-rep-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const repId = opt.dataset.repId;
        routes[routeIndex].assignedReps.push(repId);
        dropdown.remove();
        renderRoutesPreview(modal, routes, allReps, outliers);
      });
    });

    // Close dropdown on outside click
    setTimeout(() => {
      document.addEventListener('click', function closeDropdown(e) {
        if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
          dropdown.remove();
          document.removeEventListener('click', closeDropdown);
        }
      });
    }, 10);
  }

  async function saveAllRoutes() {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<svg class="spinner" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="60" stroke-dashoffset="20"/></svg> Saving...';

    try {
      for (const route of generatedRoutes) {
        // Create route for each assigned rep
        for (const repId of route.assignedReps) {
          const routeData = {
            name: route.name,
            assigned_to: repId,
            estimated_duration: route.estimatedDuration,
            total_distance: Math.round(route.totalDistance * 1000),
            created_by: state.currentUser.id,
            organization_id: state.currentOrganization?.id
          };

          const { data: savedRoute, error: routeError } = await supabaseClient
            .from('routes')
            .insert([routeData])
            .select();

          if (routeError) throw routeError;

          // Create route locations
          const routeLocations = route.companies.map((company, idx) => ({
            route_id: savedRoute[0].id,
            company_id: company.id,
            position: idx + 1
          }));

          const { error: locationsError } = await supabaseClient
            .from('route_locations')
            .insert(routeLocations);

          if (locationsError) throw locationsError;
        }
      }

      showToast(`Successfully created ${generatedRoutes.length} routes!`, 'success');
      closeModal('ai-safi-plan-modal');

      // Refresh the route planning view
      setTimeout(() => {
        renderRoutePlanningView();
      }, 500);

    } catch (error) {
      console.error('Error saving routes:', error);
      showToast('Error saving routes: ' + error.message, 'error');
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save All Routes';
    }
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Updated viewRouteDetails function
// Replace the existing viewRouteDetails function with this updated version
async function viewRouteDetails(routeId) {
  const oldModal = document.getElementById('route-details-modal');
  if (oldModal) {
    oldModal.remove();
  }

  try {
    // Use the correct table name 'routes' instead of 'route_details'
    const { data: route, error: routeError } = await supabaseClient
      .from('routes')
      .select(`
        *,
        assigned_to_profile:profiles!routes_assigned_to_fkey(first_name, last_name),
        created_by_profile:profiles!routes_created_by_fkey(first_name, last_name)
      `)
      .eq('id', routeId)
      .single();

    if (routeError) throw routeError;

    // Use the correct table name 'route_locations' with a join to companies
    const { data: routeLocations, error: locationsError } = await supabaseClient
      .from('route_locations')
      .select(`
        *,
        companies(id, name, address, latitude, longitude)
      `)
      .eq('route_id', routeId)
      .order('position');

    if (locationsError) throw locationsError;

    // Create modal to show route details
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.id = 'route-details-modal';
    modal.innerHTML = `
      <div class="modal-backdrop" onclick="closeModal('route-details-modal')"></div>
      <div class="modal-container modal-size-lg">
        <div class="modal-header">
          <h3>${route.name}</h3>
          <button class="modal-close" onclick="closeModal('route-details-modal')">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="route-details">
            <div class="route-info">
              <p><strong>Assigned to:</strong> ${route.assigned_to_profile ? `${route.assigned_to_profile.first_name} ${route.assigned_to_profile.last_name}` : 'Unassigned'}</p>
              <p><strong>Created by:</strong> ${route.created_by_profile ? `${route.created_by_profile.first_name} ${route.created_by_profile.last_name}` : 'Unknown'}</p>
              <p><strong>Created:</strong> ${formatDate(route.created_at)}</p>
              ${route.estimated_duration ? `<p><strong>Est. duration:</strong> ${route.estimated_duration} min</p>` : ''}
              ${route.total_distance ? `<p><strong>Total distance:</strong> ${(route.total_distance / 1000).toFixed(2)} km</p>` : ''}
            </div>
            
            <div class="route-map u-map-md u-my-md" id="route-details-map"></div>
            
            <h4>Route Stops</h4>
            <ol class="route-stops">
              ${routeLocations.map((stop, index) => `
                <li>
                  <strong>${stop.companies.name}</strong><br>
                  ${stop.companies.address || 'No address'}
                </li>
              `).join('')}
            </ol>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Initialize map with a delay to ensure DOM is ready
    setTimeout(() => {
      // Filter for valid locations with coordinates
      const validStops = routeLocations.filter(stop =>
        stop.companies &&
        stop.companies.latitude &&
        stop.companies.longitude &&
        !isNaN(stop.companies.latitude) &&
        !isNaN(stop.companies.longitude)
      );

      if (validStops.length > 0) {
        const map = L.map('route-details-map').setView(
          [validStops[0].companies.latitude, validStops[0].companies.longitude],
          13
        );

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap'
        }).addTo(map);

        // Add markers for each location
        const markers = validStops.map((stop, index) => {
          return L.marker([stop.companies.latitude, stop.companies.longitude])
            .bindPopup(`<b>${index + 1}. ${stop.companies.name}</b><br>${stop.companies.address || 'No address'}`)
            .addTo(map);
        });

        // Draw route line
        const latlngs = validStops.map(stop => [stop.companies.latitude, stop.companies.longitude]);
        L.polyline(latlngs, { color: '#4f46e5', weight: 4 }).addTo(map);

        // Fit map to show entire route
        const group = new L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.1));
      } else {
        const mapElement = document.getElementById('route-details-map');
        if (mapElement) {
          mapElement.innerHTML = '<div class="text-center u-p-xl">No valid location data available for this route</div>';
        }
      }
    }, 100);
  } catch (error) {
    console.error('Error loading route details:', error);
    showToast('Error loading route details: ' + error.message, 'error');
  }
}

async function editRoute(routeId) {
  // Similar to viewRouteDetails but with editing capabilities
  // This would allow managers to modify route order or locations
  showToast('Edit route functionality to be implemented', 'info');
}

// ======================
// MY ROUTES VIEW
// ======================



// ── Exports ────────────────────────────────────────────────────
export {
  groupRoutesByLocations,
  renderRoutePlanningView,
  initRoutePlanning,
  initRouteList,
  initAISafiPlan,
  openAISafiPlanModal,
  initAISafiPlanLogic,
  viewRouteDetails,
  editRoute,
};
