// modules/features/my-routes.js
// My saved routes view.
import { state, supabaseClient } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml } from '../ui/toast.js';


async function renderMyRoutesView() {
  try {
    const { data: routes, error: routesError } = await supabaseClient
      .from('routes')
      .select('*')
      .eq('assigned_to', state.currentUser.id)
      // Note: we no longer filter by is_active. Sales reps should still see completed
      // routes in their list so they can run them again if needed.
      .order('created_at', { ascending: false });

    if (routesError) throw routesError;

    let html = `

    `;

    let routeIds = [];
    let allRouteLocations = [];
    let companies = [];

    if (routes.length === 0) {
      html += `
        <div class="card">
          <div class="empty-state">
            <h3 class="empty-state-title">No routes assigned</h3>
            <p class="empty-state-description">
              Your manager will assign routes to you here.
            </p>
          </div>
        </div>
      `;
    } else {
      routeIds = routes.map(r => r.id);

      // Get route locations with more flexible approach
      try {
        const { data: routeLocationsData, error: locationsError } =
          await supabaseClient
            .from('route_locations')
            .select('*')
            .in('route_id', routeIds)
            .order('position');

        if (!locationsError) {
          allRouteLocations = routeLocationsData || [];
        }
      } catch (e) {
        console.error('Error fetching route locations:', e);
      }

      // Extract location IDs with more flexible approach
      const locationIds = allRouteLocations
        .map(rl => {
          // Try different possible column names
          return rl.location_id || rl.company_id || rl.stop_id || rl.point_id || rl.company;
        })
        .filter(Boolean); // Filter out null/undefined values

      if (locationIds.length > 0) {
        try {
          const { data: companiesData } = await supabaseClient
            .from('companies')
            .select('*')
            .in('id', locationIds);

          if (companiesData) companies = companiesData;
        } catch (e) {
          console.error('Error fetching companies:', e);
        }
      }

      for (const route of routes) {
        const routeLocations = allRouteLocations
          .filter(rl => rl.route_id === route.id)
          .sort((a, b) => a.position - b.position)
          .map(rl => {
            // Try different possible column names
            const locationId = rl.location_id || rl.company_id || rl.stop_id || rl.point_id || rl.company;

            const company = companies.find(c => c.id === locationId);

            // If no company found, create a placeholder with available data
            return {
              ...rl,
              company: company || {
                id: locationId,
                name: rl.name || 'Unknown Location',
                address: rl.address || 'No address',
                latitude: rl.latitude,
                longitude: rl.longitude
              }
            };
          });

        const completedBadge = route.is_active ? '' : '<span class="badge badge-secondary" style="margin-left:8px;">Completed</span>';
        const startBtnText = route.is_active ? 'Start Route' : 'Run Again';

        html += `
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">${route.name}${completedBadge}</h3>
              <button class="btn btn-primary start-route-btn"
                      data-id="${route.id}">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-navigation2-icon lucide-navigation-2"><polygon points="12 2 19 21 12 17 5 21 12 2"/></svg>
                ${startBtnText}
              </button>
            </div>

            <div class="route-summary">
              <p><strong>Created:</strong> ${formatDate(route.created_at)}</p>
              ${route.estimated_duration
            ? `<p><strong>Est. duration:</strong> ${route.estimated_duration} min</p>`
            : ''
          }
              ${route.total_distance
            ? `<p><strong>Total distance:</strong> ${(route.total_distance / 1000).toFixed(2)} km</p>`
            : ''
          }
            </div>

            <div class="route-map"
                id="route-preview-${route.id}"
                style="height:200px;margin:1rem 0;"></div>

            <h4>Route Stops</h4>
            <ol class="route-stops">
              ${routeLocations
            .map(
              loc => `
                    <li>
                      <strong>${loc.company.name}</strong><br>
                      ${loc.company.address || 'No address'}
                    </li>
                  `
            )
            .join('')}
            </ol>
          </div>
        `;
      }
    }

    viewContainer.innerHTML = html;

    // Initialize map previews for routes with valid locations
    for (const route of routes) {
      const routeLocations = allRouteLocations
        .filter(rl => rl.route_id === route.id)
        .sort((a, b) => a.position - b.position)
        .map(rl => {
          // Try different possible column names
          const locationId = rl.location_id || rl.company_id || rl.stop_id || rl.point_id || rl.company;
          const company = companies.find(c => c.id === locationId);

          return {
            ...rl,
            company: company || {
              id: locationId,
              name: rl.name || 'Unknown Location',
              address: rl.address || 'No address',
              latitude: rl.latitude,
              longitude: rl.longitude
            }
          };
        });

      // Filter for valid locations with coordinates
      const validLocations = routeLocations.filter(loc =>
        loc.company &&
        loc.company.latitude &&
        loc.company.longitude &&
        !isNaN(loc.company.latitude) &&
        !isNaN(loc.company.longitude)
      );

      if (validLocations.length > 0) {
        setTimeout(() => {
          try {
            const map = L.map(`route-preview-${route.id}`).setView(
              [validLocations[0].company.latitude, validLocations[0].company.longitude],
              13
            );

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
              attribution: '© OpenStreetMap'
            }).addTo(map);

            // Add markers for each location
            const markers = validLocations.map((location, index) => {
              return L.marker([location.company.latitude, location.company.longitude])
                .bindPopup(`<b>${index + 1}. ${location.company.name}</b><br>${location.company.address || 'No address'}`)
                .addTo(map);
            });

            // Draw route line
            const latlngs = validLocations.map(loc => [loc.company.latitude, loc.company.longitude]);
            L.polyline(latlngs, { color: '#4f46e5', weight: 4 }).addTo(map);

            // Fit map to show entire route
            const group = new L.featureGroup(markers);
            map.fitBounds(group.getBounds().pad(0.1));
          } catch (e) {
            console.error('Error initializing map for route', route.id, ':', e);
            const mapElement = document.getElementById(`route-preview-${route.id}`);
            if (mapElement) {
              mapElement.innerHTML = '<div class="text-center u-p-xl">Map unavailable</div>';
            }
          }
        }, 100);
      } else {
        const mapElement = document.getElementById(`route-preview-${route.id}`);
        if (mapElement) {
          mapElement.innerHTML = '<div class="text-center u-p-xl">No valid location data</div>';
        }
      }
    }

    document.querySelectorAll('.start-route-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        startRouteNavigation(btn.dataset.id);
      });
    });

  } catch (error) {
    console.error('Error rendering routes:', error);
    viewContainer.innerHTML = renderError(error.message);
  }
}


// ── Exports ────────────────────────────────────────────────────
export {
  renderMyRoutesView,
};
