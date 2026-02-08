/**
 * SafiFlow Enterprise Module - Complete Rebuild
 * Professional stock tracking and proposal management system
 * 
 * Features:
 * - Manager: Product catalog, MOQ management, proposal review, analytics
 * - Sales Rep: Company search, stock reporting, image upload, draft saving
 * - Premium UI/UX with animations, loading states, and mobile optimization
 */

// ============================================================================
// GLOBAL STATE
// ============================================================================

let safiflowState = {
  products: [],
  categories: [],
  companies: [],
  assignments: [],
  currentProposal: null,
  draftItems: [],
  filters: {
    status: 'all',
    dateRange: 'all',
    searchTerm: ''
  }
};

// ============================================================================
// MANAGER: PRODUCT CATALOG & INVENTORY
// ============================================================================

/**
 * Render main product catalog view (Manager)
 */
async function renderSafiFlowInventoryView() {
  const viewContainer = document.getElementById('view-container');

  viewContainer.innerHTML = `
    <div class="safiflow-inventory-container">
      <!-- Header with Stats -->
      <div class="safiflow-header">
        <div class="safiflow-header-content">
          <div>
            <h2 class="page-title">
              <i class="fas fa-shopping-cart"></i>
              Product Catalog & Inventory
            </h2>
            <p class="page-subtitle">Manage products, categories, and company-specific MOQs</p>
          </div>
          <div class="safiflow-header-actions">
            <button class="btn btn-secondary" onclick="exportSafiFlowProducts()">
              <i class="fas fa-download"></i>
              <span class="btn-text">Export</span>
            </button>
            <button class="btn btn-primary" onclick="openProductModal()">
              <i class="fas fa-plus"></i>
              <span class="btn-text">Add Product</span>
            </button>
          </div>
        </div>

        <!-- Quick Stats Cards -->
        <div class="stats-grid" id="product-stats-grid">
          ${generateSkeletonLoader('card', 4)}
        </div>
      </div>

      <!-- Filters & Search -->
      <div class="safiflow-toolbar card">
        <div class="search-input-wrapper">
          <i class="fas fa-search"></i>
          <input 
            type="text" 
            id="product-search" 
            placeholder="Search products by name or SKU..." 
            class="search-input"
          />
        </div>

        <div class="toolbar-filters">
          <select id="category-filter" class="filter-select">
            <option value="all">All Categories</option>
          </select>

          <select id="status-filter" class="filter-select">
            <option value="all">All Status</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>

          <button class="btn btn-secondary btn-sm" onclick="resetProductFilters()">
            <i class="fas fa-undo"></i> Reset
          </button>
        </div>
      </div>

      <!-- Products Table -->
      <div class="card">
        <div class="table-container" id="products-table-container">
          ${generateSkeletonLoader('table', 8)}
        </div>

        <!-- Pagination -->
        <div class="table-footer" id="products-pagination" style="display:none;">
          <div class="pagination-info">
            Showing <span id="pagination-range"></span> of <span id="pagination-total"></span> products
          </div>
          <div class="pagination-controls" id="pagination-buttons"></div>
        </div>
      </div>
    </div>
  `;

  // Load data
  await Promise.all([
    loadProductStats(),
    loadProductCategories(),
    loadSafiFlowProducts()
  ]);

  // Initialize search with debounce
  const searchInput = document.getElementById('product-search');
  searchInput.addEventListener('input', debounce((e) => {
    safiflowState.filters.searchTerm = e.target.value;
    loadSafiFlowProducts();
  }, 300));

  // Initialize filters
  document.getElementById('category-filter').addEventListener('change', (e) => {
    safiflowState.filters.category = e.target.value;
    loadSafiFlowProducts();
  });

  document.getElementById('status-filter').addEventListener('change', (e) => {
    safiflowState.filters.status = e.target.value;
    loadSafiFlowProducts();
  });
}

/**
 * Load product statistics
 */
async function loadProductStats() {
  try {
    const [productsResult, assignmentsResult] = await Promise.all([
      supabaseClient.from('safiflow_products').select('id, is_active'),
      supabaseClient.from('safiflow_branch_product_moq').select('product_id, company_id')
    ]);

    const products = productsResult.data || [];
    const assignments = assignmentsResult.data || [];

    const activeProducts = products.filter(p => p.is_active).length;
    const inactiveProducts = products.length - activeProducts;
    const totalAssignments = assignments.length;

    // Calculate unique companies with assignments
    const uniqueCompanies = new Set(assignments.map(a => a.company_id)).size;

    // Calculate coverage (products with at least one assignment)
    const productsWithAssignments = new Set(assignments.map(a => a.product_id)).size;
    const coveragePercentage = products.length > 0
      ? Math.round((productsWithAssignments / products.length) * 100)
      : 0;

    const statsHTML = `
      <div class="stat-card">
        <div class="stat-icon stat-icon-primary">
          <i class="fas fa-box"></i>
        </div>
        <div class="stat-content">
          <div class="stat-value">${products.length}</div>
          <div class="stat-label">Total Products</div>
          <div class="stat-meta">${activeProducts} active, ${inactiveProducts} inactive</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon stat-icon-success">
          <i class="fas fa-building"></i>
        </div>
        <div class="stat-content">
          <div class="stat-value">${uniqueCompanies}</div>
          <div class="stat-label">Companies Covered</div>
          <div class="stat-meta">${totalAssignments} total assignments</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon stat-icon-info">
          <i class="fas fa-chart-line"></i>
        </div>
        <div class="stat-content">
          <div class="stat-value">${coveragePercentage}%</div>
          <div class="stat-label">Assignment Coverage</div>
          <div class="stat-meta">${productsWithAssignments}/${products.length} products assigned</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon stat-icon-warning">
          <i class="fas fa-sync"></i>
        </div>
        <div class="stat-content">
          <div class="stat-value">${formatRelativeTime(new Date())}</div>
          <div class="stat-label">Last Updated</div>
          <div class="stat-meta">Real-time data</div>
        </div>
      </div>
    `;

    document.getElementById('product-stats-grid').innerHTML = statsHTML;

  } catch (error) {
    console.error('Error loading product stats:', error);
    showToast('Failed to load statistics', 'error');
  }
}

/**
 * Load product categories for filter
 */
async function loadProductCategories() {
  try {
    const { data: categories, error } = await supabaseClient
      .from('safiflow_product_categories')
      .select('*')
      .order('name');

    if (error) throw error;

    safiflowState.categories = categories || [];

    const categoryFilter = document.getElementById('category-filter');
    if (categoryFilter) {
      const optionsHTML = categories.map(cat =>
        `<option value="${cat.id}">${cat.name}</option>`
      ).join('');
      categoryFilter.innerHTML = '<option value="all">All Categories</option>' + optionsHTML;
    }

  } catch (error) {
    console.error('Error loading categories:', error);
  }
}

/**
 * Load and display products
 */
async function loadSafiFlowProducts(page = 1, perPage = 20) {
  const container = document.getElementById('products-table-container');

  try {
    // Build query
    let query = supabaseClient
      .from('safiflow_products')
      .select('*, category:safiflow_product_categories(name)', { count: 'exact' });

    // Apply filters
    if (safiflowState.filters.searchTerm) {
      query = query.or(`name.ilike.%${safiflowState.filters.searchTerm}%,sku.ilike.%${safiflowState.filters.searchTerm}%`);
    }

    if (safiflowState.filters.category && safiflowState.filters.category !== 'all') {
      query = query.eq('category_id', safiflowState.filters.category);
    }

    if (safiflowState.filters.status && safiflowState.filters.status !== 'all') {
      query = query.eq('is_active', safiflowState.filters.status === 'active');
    }

    // Pagination
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;
    query = query.range(from, to).order('name');

    const { data: products, error, count } = await query;

    if (error) throw error;

    safiflowState.products = products || [];

    // Load assignment counts for each product
    const productIds = products.map(p => p.id);
    const { data: assignments } = await supabaseClient
      .from('safiflow_branch_product_moq')
      .select('product_id')
      .in('product_id', productIds);

    const assignmentCounts = {};
    (assignments || []).forEach(a => {
      assignmentCounts[a.product_id] = (assignmentCounts[a.product_id] || 0) + 1;
    });

    if (products.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-box-open"></i>
          <h3>No products found</h3>
          <p>Start by adding your first product to the catalog</p>
          <button class="btn btn-primary" onclick="openProductModal()">
            <i class="fas fa-plus"></i> Add Product
          </button>
        </div>
      `;
      document.getElementById('products-pagination').style.display = 'none';
      return;
    }

    // Render table
    container.innerHTML = `
      <table class="data-table product-table">
        <thead>
          <tr>
            <th style="width: 60px;"></th>
            <th>Product Details</th>
            <th style="width: 120px;">Category</th>
            <th style="width: 100px; text-align: center;">Global MOQ</th>
            <th style="width: 120px; text-align: center;">Assignments</th>
            <th style="width: 100px; text-align: center;">Status</th>
            <th style="width: 100px; text-align: center;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${products.map(product => `
            <tr class="product-row ${!product.is_active ? 'inactive-row' : ''}" data-product-id="${product.id}">
              <td>
                ${product.image_url
        ? `<img src="${product.image_url}" class="product-thumbnail" alt="${product.name}"/>`
        : `<div class="product-thumbnail-placeholder"><i class="fas fa-box"></i></div>`
      }
              </td>
              <td>
                <div class="product-info">
                  <div class="product-name">${product.name}</div>
                  ${product.sku ? `<div class="product-sku">SKU: ${product.sku}</div>` : ''}
                  ${product.unit ? `<div class="product-unit">${product.unit}</div>` : ''}
                </div>
              </td>
              <td>
                ${product.category?.name
        ? `<span class="category-badge">${product.category.name}</span>`
        : '<span class="text-muted">—</span>'
      }
              </td>
              <td style="text-align: center;">
                <span class="moq-value">${product.global_moq} ${product.unit || 'units'}</span>
              </td>
              <td style="text-align: center;">
                <button class="assignment-badge ${assignmentCounts[product.id] ? 'has-assignments' : 'no-assignments'}" 
                        onclick="openProductModal('${product.id}')">
                  <i class="fas fa-building"></i>
                  ${assignmentCounts[product.id] || 0} companies
                </button>
              </td>
              <td style="text-align: center;">
                <label class="toggle-switch" title="Toggle active status">
                  <input type="checkbox" ${product.is_active ? 'checked' : ''} 
                         onchange="toggleProductStatus('${product.id}', this.checked)">
                  <span class="toggle-slider"></span>
                </label>
              </td>
              <td style="text-align: center;">
                <div class="table-actions">
                  <button class="action-btn" onclick="openProductModal('${product.id}')" title="Edit & Manage MOQs">
                    <i class="fas fa-edit"></i>
                  </button>
                  <button class="action-btn action-btn-danger" onclick="deleteProduct('${product.id}')" title="Delete">
                    <i class="fas fa-trash"></i>
                  </button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    // Update pagination
    updatePagination(count, page, perPage);

  } catch (error) {
    console.error('Error loading products:', error);
    container.innerHTML = `
      <div class="error-state">
        <i class="fas fa-exclamation-triangle"></i>
        <h3>Failed to load products</h3>
        <p>${error.message}</p>
        <button class="btn btn-primary" onclick="loadSafiFlowProducts()">
          <i class="fas fa-refresh"></i> Retry
        </button>
      </div>
    `;
  }
}

/**
 * Update pagination UI
 */
function updatePagination(total, currentPage, perPage) {
  const totalPages = Math.ceil(total / perPage);
  const from = ((currentPage - 1) * perPage) + 1;
  const to = Math.min(currentPage * perPage, total);

  const paginationContainer = document.getElementById('products-pagination');
  const rangeSpan = document.getElementById('pagination-range');
  const totalSpan = document.getElementById('pagination-total');
  const buttonsContainer = document.getElementById('pagination-buttons');

  if (totalPages <= 1) {
    paginationContainer.style.display = 'none';
    return;
  }

  paginationContainer.style.display = 'flex';
  rangeSpan.textContent = `${from}-${to}`;
  totalSpan.textContent = total;

  // Generate pagination buttons
  let buttonsHTML = `
    <button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} 
            onclick="loadSafiFlowProducts(${currentPage - 1})">
      <i class="fas fa-chevron-left"></i>
    </button>
  `;

  // Show max 7 page buttons
  const maxButtons = 7;
  let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);

  if (endPage - startPage < maxButtons - 1) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  if (startPage > 1) {
    buttonsHTML += `<button class="pagination-btn" onclick="loadSafiFlowProducts(1)">1</button>`;
    if (startPage > 2) {
      buttonsHTML += `<span class="pagination-ellipsis">...</span>`;
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    buttonsHTML += `
      <button class="pagination-btn ${i === currentPage ? 'active' : ''}" 
              onclick="loadSafiFlowProducts(${i})">
        ${i}
      </button>
    `;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      buttonsHTML += `<span class="pagination-ellipsis">...</span>`;
    }
    buttonsHTML += `<button class="pagination-btn" onclick="loadSafiFlowProducts(${totalPages})">${totalPages}</button>`;
  }

  buttonsHTML += `
    <button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} 
            onclick="loadSafiFlowProducts(${currentPage + 1})">
      <i class="fas fa-chevron-right"></i>
    </button>
  `;

  buttonsContainer.innerHTML = buttonsHTML;
}

/**
 * Toggle product active status
 */
async function toggleProductStatus(productId, isActive) {
  try {
    const { error } = await supabaseClient
      .from('safiflow_products')
      .update({ is_active: isActive })
      .eq('id', productId);

    if (error) throw error;

    showToast(`Product ${isActive ? 'activated' : 'deactivated'}`, 'success');
    loadProductStats(); // Refresh stats

  } catch (error) {
    console.error('Error toggling product status:', error);
    showToast('Failed to update status', 'error');
    // Revert checkbox
    const checkbox = event.target;
    checkbox.checked = !checkbox.checked;
  }
}

/**
 * Delete product
 */
async function deleteProduct(productId) {
  showConfirmDialog(
    'Delete Product',
    'Are you sure you want to delete this product? This will also remove all MOQ assignments.',
    async () => {
      try {
        const { error } = await supabaseClient
          .from('safiflow_products')
          .delete()
          .eq('id', productId);

        if (error) throw error;

        showToast('Product deleted successfully', 'success');
        await Promise.all([
          loadProductStats(),
          loadSafiFlowProducts()
        ]);

      } catch (error) {
        console.error('Error deleting product:', error);
        showToast('Failed to delete product', 'error');
      }
    }
  );
}

/**
 * Reset product filters
 */
function resetProductFilters() {
  safiflowState.filters = { searchTerm: '', category: 'all', status: 'all' };
  document.getElementById('product-search').value = '';
  document.getElementById('category-filter').value = 'all';
  document.getElementById('status-filter').value = 'all';
  loadSafiFlowProducts();
}

/**
 * Export products to CSV
 */
async function exportSafiFlowProducts() {
  try {
    const { data: products, error } = await supabaseClient
      .from('safiflow_products')
      .select('*, category:safiflow_product_categories(name)')
      .order('name');

    if (error) throw error;

    const exportData = products.map(p => ({
      'Product Name': p.name,
      'SKU': p.sku || '',
      'Category': p.category?.name || '',
      'Global MOQ': p.global_moq,
      'Unit': p.unit || 'units',
      'Status': p.is_active ? 'Active' : 'Inactive',
      'Created': formatDateTime(p.created_at)
    }));

    exportToCSV(exportData, 'safiflow-products');

  } catch (error) {
    console.error('Error exporting products:', error);
    showToast('Failed to export products', 'error');
  }
}

// This is the first part of the safiflow.js file. 
// Continue with Part 2: Product Modal and MOQ Management...

// ============================================================================
// MANAGER: PRODUCT MODAL & MOQ ASSIGNMENT
// ============================================================================

/**
 * Open product modal for creating/editing product and managing MOQ assignments
 */
async function openProductModal(productId = null) {
  let product = {
    name: '',
    sku: '',
    category_id: null,
    global_moq: 0,
    unit: 'units',
    is_active: true,
    image_url: null
  };

  let assignments = [];
  let companies = [];

  try {
    // Load data
    const promises = [
      supabaseClient.from('companies').select('id, name').order('name')
    ];

    if (productId) {
      promises.push(
        supabaseClient.from('safiflow_products').select('*').eq('id', productId).single(),
        supabaseClient.from('safiflow_branch_product_moq').select('*').eq('product_id', productId)
      );
    }

    const results = await Promise.all(promises);

    // Check for errors in companies query
    if (results[0].error) {
      console.error('Error loading companies:', results[0].error);
      showToast('Failed to load companies: ' + results[0].error.message, 'error');
      return;
    }

    companies = results[0].data || [];
    console.log('Loaded companies:', companies.length, companies);

    if (productId) {
      if (results[1].error) {
        console.error('Error loading product:', results[1].error);
        showToast('Failed to load product', 'error');
        return;
      }
      product = results[1].data;
      assignments = results[2].data || [];
    }

    // Check if companies loaded
    if (companies.length === 0) {
      console.warn('No companies found in database');
      showToast('No companies found. Please add companies first.', 'warning');
      return;
    }

    console.log('Building modal with', companies.length, 'companies');

    // Build modal HTML
    const modalHTML = `
      <div id="product-modal" class="modal active safiflow-modal">
        <div class="modal-backdrop" onclick="closeSafiFlowModal('product-modal')"></div>
        <div class="modal-container modal-large">
          <div class="modal-header">
            <div>
              <h3>${productId ? 'Edit Product & MOQ Assignments' : 'Add New Product'}</h3>
              <p class="text-muted">Configure product details and set company-specific MOQs</p>
            </div>
            <button class="modal-close" onclick="closeSafiFlowModal('product-modal')">
              <i class="fas fa-times"></i>
            </button>
          </div>

          <div class="modal-body modal-split">
            <!-- Left Panel: Product Details -->
            <div class="modal-panel">
              <h4 class="panel-title">Product Information</h4>

              <div class="form-field">
                <label>Product Name <span class="required-indicator">*</span></label>
                <input type="text" id="product-name" value="${product.name}" placeholder="e.g., Safi Juice 500ml" required />
              </div>

              <div class="form-grid" style="grid-template-columns: 1fr 1fr;">
                <div class="form-field">
                  <label>SKU Code</label>
                  <input type="text" id="product-sku" value="${product.sku || ''}" placeholder="e.g., SFJ-500" />
                </div>

                <div class="form-field">
                  <label>Unit</label>
                  <input type="text" id="product-unit" value="${product.unit || 'units'}" placeholder="e.g., bottles, boxes" />
                </div>
              </div>

              <div class="form-grid" style="grid-template-columns: 2fr 1fr;">
                <div class="form-field">
                  <label>Category</label>
                  <select id="product-category">
                    <option value="">No Category</option>
                    ${safiflowState.categories.map(cat =>
      `<option value="${cat.id}" ${product.category_id === cat.id ? 'selected' : ''}>${cat.name}</option>`
    ).join('')}
                  </select>
                </div>

                <div class="form-field">
                  <label>Global MOQ</label>
                  <input type="number" id="product-global-moq" value="${product.global_moq}" min="0" />
                </div>
              </div>

              <div class="form-field">
                <label>Product Image</label>
                <div class="image-upload-wrapper">
                  ${product.image_url ? `
                    <div class="current-image">
                      <img src="${product.image_url}" alt="Product" id="product-preview-img" />
                      <button type="button" class="btn-remove-image" onclick="removeProductImage()">
                        <i class="fas fa-times"></i>
                      </button>
                    </div>
                  ` : `
                    <div class="image-upload-placeholder" id="image-placeholder">
                      <i class="fas fa-cloud-upload-alt"></i>
                      <p>Click to upload or drag image here</p>
                      <small>JPEG, PNG, WEBP up to 5MB</small>
                    </div>
                  `}
                  <input type="file" id="product-image-input" accept="image/*" style="display:none;" onchange="handleProductImageUpload(event)" />
                  <input type="hidden" id="product-image-url" value="${product.image_url || ''}" />
                </div>
                <button type="button" class="btn btn-secondary btn-sm mt-2" onclick="document.getElementById('product-image-input').click()">
                  <i class="fas fa-upload"></i> ${product.image_url ? 'Change Image' : 'Upload Image'}
                </button>
              </div>
            </div>

            <!-- Right Panel: MOQ Assignments -->
            <div class="modal-panel">
              <div class="panel-header">
                <h4 class="panel-title">Company MOQ Assignments</h4>
                <div class="search-input-wrapper">
                  <i class="fas fa-search"></i>
                  <input type="text" id="company-search" placeholder="Search companies..." class="search-input-sm" />
                </div>
              </div>

              <div class="assignment-stats">
                <span class="stat-badge">
                  <i class="fas fa-building"></i>
                  <span id="assigned-count">${assignments.length}</span> / ${companies.length} assigned
                </span>
              </div>

              <div class="assignments-container" id="assignments-container">
                ${companies.map(company => {
      const assignment = assignments.find(a => a.company_id === company.id);
      return `
                    <div class="assignment-item" data-company-name="${company.name.toLowerCase()}">
                      <div class="assignment-checkbox">
                        <input type="checkbox" 
                               id="assign-${company.id}" 
                               data-company-id="${company.id}"
                               ${assignment ? 'checked' : ''}
                               onchange="toggleMOQInput(this)" />
                        <label for="assign-${company.id}">
                          <div class="company-details">
                            <span class="company-name">${company.name}</span>
                            ${company.type ? `<span class="company-type">${company.type}</span>` : ''}
                          </div>
                        </label>
                      </div>
                      <div class="moq-input-wrapper">
                        <input type="number" 
                               class="moq-input" 
                               id="moq-${company.id}"
                               value="${assignment ? assignment.moq : product.global_moq}"
                               placeholder="${product.global_moq}"
                               min="0"
                               ${!assignment ? 'disabled' : ''} />
                      </div>
                    </div>
                  `;
    }).join('')}
              </div>

              <div class="bulk-actions">
                <button type="button" class="btn btn-sm btn-secondary" onclick="selectAllCompanies()">
                  <i class="fas fa-check-double"></i> Select All
                </button>
                <button type="button" class="btn btn-sm btn-secondary" onclick="clearAllCompanies()">
                  <i class="fas fa-times"></i> Clear All
                </button>
                <button type="button" class="btn btn-sm btn-secondary" onclick="applyBulkMOQ()">
                  <i class="fas fa-magic"></i> Apply MOQ to Selected
                </button>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeSafiFlowModal('product-modal')">Cancel</button>
            <button class="btn btn-primary" id="save-product-btn" onclick="saveProduct('${productId || ''}')">
              <i class="fas fa-save"></i> ${productId ? 'Update Product' : 'Create Product'}
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Initialize company search
    document.getElementById('company-search').addEventListener('input', debounce((e) => {
      filterCompanyAssignments(e.target.value);
    }, 200));

    // Update assigned count
    updateAssignedCount();

  } catch (error) {
    console.error('Error opening product modal:', error);
    showToast('Failed to load product data', 'error');
  }
}

/**
 * Handle product image upload
 */
async function handleProductImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const validation = validateImageFile(file);
  if (!validation.valid) {
    showToast(validation.error, 'error');
    return;
  }

  // Show upload progress
  const placeholder = document.getElementById('image-placeholder');
  if (placeholder) {
    placeholder.innerHTML = `
      <div class="upload-progress">
        <div class="spinner-small"></div>
        <p>Uploading...</p>
      </div>
    `;
  }

  const result = await uploadImage(file, 'safiflow-products');

  if (result.success) {
    document.getElementById('product-image-url').value = result.url;

    // Show preview
    const container = document.querySelector('.image-upload-wrapper');
    container.innerHTML = `
      <div class="current-image">
        <img src="${result.url}" alt="Product" id="product-preview-img" />
        <button type="button" class="btn-remove-image" onclick="removeProductImage()">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;

    showToast('Image uploaded successfully', 'success');
  } else {
    showToast(result.error || 'Image upload failed', 'error');

    // Reset placeholder
    if (placeholder) {
      placeholder.innerHTML = `
        <i class="fas fa-cloud-upload-alt"></i>
        <p>Click to upload or drag image here</p>
        <small>JPEG, PNG, WEBP up to 5MB</small>
      `;
    }
  }
}

/**
 * Remove product image
 */
function removeProductImage() {
  document.getElementById('product-image-url').value = '';
  const container = document.querySelector('.image-upload-wrapper');
  container.innerHTML = `
    <div class="image-upload-placeholder" id="image-placeholder">
      <i class="fas fa-cloud-upload-alt"></i>
      <p>Click to upload or drag image here</p>
      <small>JPEG, PNG, WEBP up to 5MB</small>
    </div>
  `;
}

/**
 * Toggle MOQ input based on checkbox
 */
function toggleMOQInput(checkbox) {
  const companyId = checkbox.dataset.companyId;
  const moqInput = document.getElementById(`moq-${companyId}`);

  moqInput.disabled = !checkbox.checked;

  if (checkbox.checked && !moqInput.value) {
    const globalMOQ = document.getElementById('product-global-moq').value;
    moqInput.value = globalMOQ || 0;
  }

  updateAssignedCount();
}

/**
 * Update assigned companies count
 */
function updateAssignedCount() {
  const checked = document.querySelectorAll('.assignment-item input[type="checkbox"]:checked').length;
  const countSpan = document.getElementById('assigned-count');
  if (countSpan) countSpan.textContent = checked;
}

/**
 * Filter company assignments by search term
 */
function filterCompanyAssignments(searchTerm) {
  const term = searchTerm.toLowerCase().trim();
  const items = document.querySelectorAll('.assignment-item');

  let visibleCount = 0;

  items.forEach(item => {
    const companyName = item.dataset.companyName;

    if (!term || companyName.includes(term)) {
      item.style.display = 'flex';
      visibleCount++;
    } else {
      item.style.display = 'none';
    }
  });

  // Show/hide no results message
  let noResultsMsg = document.getElementById('no-companies-found');

  if (visibleCount === 0 && term) {
    if (!noResultsMsg) {
      noResultsMsg = document.createElement('div');
      noResultsMsg.id = 'no-companies-found';
      noResultsMsg.className = 'no-results-message';
      noResultsMsg.innerHTML = `
        <i class="fas fa-search"></i>
        <p>No companies found matching "${term}"</p>
      `;
      document.getElementById('assignments-container').appendChild(noResultsMsg);
    }
  } else if (noResultsMsg) {
    noResultsMsg.remove();
  }
}

/**
 * Select all companies
 */
function selectAllCompanies() {
  document.querySelectorAll('.assignment-item input[type="checkbox"]').forEach(checkbox => {
    if (!checkbox.checked) {
      checkbox.checked = true;
      toggleMOQInput(checkbox);
    }
  });
}

/**
 * Clear all company selections
 */
function clearAllCompanies() {
  document.querySelectorAll('.assignment-item input[type="checkbox"]:checked').forEach(checkbox => {
    checkbox.checked = false;
    toggleMOQInput(checkbox);
  });
}

/**
 * Apply bulk MOQ to all selected companies
 */
function applyBulkMOQ() {
  const globalMOQ = document.getElementById('product-global-moq').value;

  if (!globalMOQ || globalMOQ <= 0) {
    showToast('Please set a valid Global MOQ first', 'warning');
    return;
  }

  document.querySelectorAll('.assignment-item input[type="checkbox"]:checked').forEach(checkbox => {
    const companyId = checkbox.dataset.companyId;
    const moqInput = document.getElementById(`moq-${companyId}`);
    moqInput.value = globalMOQ;
  });

  showToast(`Applied MOQ of ${globalMOQ} to all selected companies`, 'success');
}

/**
 * Save product and MOQ assignments
 */
async function saveProduct(productId) {
  const saveBtn = document.getElementById('save-product-btn');
  setButtonLoading(saveBtn, true);

  try {
    // Validate
    const name = document.getElementById('product-name').value.trim();
    if (!name) {
      showToast('Product name is required', 'warning');
      setButtonLoading(saveBtn, false);
      return;
    }

    // Gather product data
    const productData = {
      name,
      sku: document.getElementById('product-sku').value.trim() || null,
      unit: document.getElementById('product-unit').value.trim() || 'units',
      category_id: document.getElementById('product-category').value || null,
      global_moq: parseInt(document.getElementById('product-global-moq').value) || 0,
      image_url: document.getElementById('product-image-url').value || null,
      is_active: true
    };

    // Save or update product
    let finalProductId = productId;

    if (productId) {
      const { error } = await supabaseClient
        .from('safiflow_products')
        .update(productData)
        .eq('id', productId);

      if (error) throw error;
    } else {
      const { data, error } = await supabaseClient
        .from('safiflow_products')
        .insert([productData])
        .select()
        .single();

      if (error) throw error;
      finalProductId = data.id;
    }

    // Gather MOQ assignments
    const assignments = [];
    document.querySelectorAll('.assignment-item input[type="checkbox"]:checked').forEach(checkbox => {
      const companyId = checkbox.dataset.companyId;
      const moqInput = document.getElementById(`moq-${companyId}`);
      const moq = parseInt(moqInput.value) || productData.global_moq;

      assignments.push({
        product_id: finalProductId,
        company_id: companyId,
        moq: moq
      });
    });

    // Delete existing assignments and insert new ones (atomic update)
    await supabaseClient
      .from('safiflow_branch_product_moq')
      .delete()
      .eq('product_id', finalProductId);

    if (assignments.length > 0) {
      const { error } = await supabaseClient
        .from('safiflow_branch_product_moq')
        .insert(assignments);

      if (error) throw error;
    }

    showToast(`Product ${productId ? 'updated' : 'created'} successfully`, 'success');
    closeSafiFlowModal('product-modal');

    // Refresh product list
    await Promise.all([
      loadProductStats(),
      loadSafiFlowProducts()
    ]);

  } catch (error) {
    console.error('Error saving product:', error);
    showToast(error.message || 'Failed to save product', 'error');
    setButtonLoading(saveBtn, false);
  }
}

/**
 * Close SafiFlow modal
 */
function closeSafiFlowModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
    setTimeout(() => modal.remove(), 300);
  }
}


// ============================================================================
// MANAGER & SALES REP: PROPOSALS VIEW
// ============================================================================

/**
 * Render proposals view (both manager and sales rep)
 */
async function renderSafiFlowProposalsView() {
  const viewContainer = document.getElementById('view-container');

  viewContainer.innerHTML = `
    <div class="safiflow-proposals-container">
      <!-- Header -->
      <div class="safiflow-header">
        <div class="safiflow-header-content">
          <div>
            <h2 class="page-title">
              <i class="fas fa-flask-conical"></i>
              ${isManager ? 'Proposal Management' : 'My Proposals'}
            </h2>
            <p class="page-subtitle">${isManager ? 'Review and approve stock proposals from sales reps' : 'View and create stock reports'}</p>
          </div>
          ${!isManager ? `
            <button class="btn btn-primary" onclick="startNewProposal()">
              <i class="fas fa-plus"></i>
              <span class="btn-text">New Proposal</span>
            </button>
          ` : ''}
        </div>

        <!-- Stats Cards -->
        <div class="stats-grid" id="proposal-stats-grid">
          ${generateSkeletonLoader('card', 4)}
        </div>
      </div>

      <!-- Filters -->
      <div class="safiflow-toolbar card">
        <div class="search-input-wrapper">
          <i class="fas fa-search"></i>
          <input 
            type="text" 
            id="proposal-search" 
            placeholder="Search by company name..." 
            class="search-input"
          />
        </div>

        <div class="toolbar-filters">
          <select id="proposal-status-filter" class="filter-select">
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="complete">Complete</option>
            <option value="rejected">Rejected</option>
          </select>

          ${isManager ? `
            <select id="proposal-rep-filter" class="filter-select">
              <option value="all">All Sales Reps</option>
            </select>
          ` : ''}

          <select id="proposal-date-filter" class="filter-select">
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
          </select>

          <button class="btn btn-secondary btn-sm" onclick="resetProposalFilters()">
            <i class="fas fa-undo"></i> Reset
          </button>
        </div>
      </div>

      <!-- Proposals Table -->
      <div class="card">
        <div class="table-container" id="proposals-table-container">
          ${generateSkeletonLoader('table', 8)}
        </div>
      </div>
    </div>
  `;

  // Load data
  await Promise.all([
    loadProposalStats(),
    isManager ? loadSalesRepsFilter() : null,
    loadProposals()
  ].filter(Boolean));

  // Initialize search
  document.getElementById('proposal-search').addEventListener('input', debounce((e) => {
    safiflowState.filters.searchTerm = e.target.value;
    loadProposals();
  }, 300));

  // Initialize filters
  document.getElementById('proposal-status-filter').addEventListener('change', (e) => {
    safiflowState.filters.status = e.target.value;
    loadProposals();
  });

  document.getElementById('proposal-date-filter').addEventListener('change', (e) => {
    safiflowState.filters.dateRange = e.target.value;
    loadProposals();
  });

  if (isManager) {
    document.getElementById('proposal-rep-filter')?.addEventListener('change', (e) => {
      safiflowState.filters.salesRep = e.target.value;
      loadProposals();
    });
  }
}

/**
 * Load proposal statistics
 */
async function loadProposalStats() {
  try {
    let query = supabaseClient.from('safiflow_proposed_orders').select('id, status, created_at');

    if (!isManager) {
      query = query.eq('sales_rep_id', currentUser.id);
    }

    const { data: proposals, error } = await query;
    if (error) throw error;

    const pending = proposals.filter(p => p.status === 'pending').length;
    const approved = proposals.filter(p => p.status === 'approved' || p.status === 'complete').length;
    const rejected = proposals.filter(p => p.status === 'rejected').length;

    // Calculate this week's proposals
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const thisWeek = proposals.filter(p => new Date(p.created_at) >= weekAgo).length;

    const statsHTML = `
      <div class="stat-card stat-card-clickable" onclick="filterByStatus('pending')">
        <div class="stat-icon stat-icon-warning">
          <i class="fas fa-clock"></i>
        </div>
        <div class="stat-content">
          <div class="stat-value">${pending}</div>
          <div class="stat-label">Pending</div>
          <div class="stat-meta">Awaiting review</div>
        </div>
      </div>

      <div class="stat-card stat-card-clickable" onclick="filterByStatus('approved')">
        <div class="stat-icon stat-icon-success">
          <i class="fas fa-check-circle"></i>
        </div>
        <div class="stat-content">
          <div class="stat-value">${approved}</div>
          <div class="stat-label">Approved</div>
          <div class="stat-meta">Completed proposals</div>
        </div>
      </div>

      <div class="stat-card stat-card-clickable" onclick="filterByStatus('rejected')">
        <div class="stat-icon stat-icon-danger">
          <i class="fas fa-times-circle"></i>
        </div>
        <div class="stat-content">
          <div class="stat-value">${rejected}</div>
          <div class="stat-label">Rejected</div>
          <div class="stat-meta">Flagged for review</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon stat-icon-info">
          <i class="fas fa-calendar-week"></i>
        </div>
        <div class="stat-content">
          <div class="stat-value">${thisWeek}</div>
          <div class="stat-label">This Week</div>
          <div class="stat-meta">${proposals.length} total</div>
        </div>
      </div>
    `;

    document.getElementById('proposal-stats-grid').innerHTML = statsHTML;

  } catch (error) {
    console.error('Error loading proposal stats:', error);
  }
}

/**
 * Load sales reps for filter (manager only)
 */
async function loadSalesRepsFilter() {
  try {
    const { data: profiles } = await supabaseClient
      .from('profiles')
      .select('id, first_name, last_name')
      .eq('role', 'sales_rep')
      .order('first_name');

    const select = document.getElementById('proposal-rep-filter');
    if (select && profiles) {
      const optionsHTML = profiles.map(p =>
        `<option value="${p.id}">${p.first_name} ${p.last_name || ''}</option>`
      ).join('');
      select.innerHTML = '<option value="all">All Sales Reps</option>' + optionsHTML;
    }
  } catch (error) {
    console.error('Error loading sales reps:', error);
  }
}

/**
 * Load proposals
 */
async function loadProposals() {
  const container = document.getElementById('proposals-table-container');

  try {
    // Build query
    let query = supabaseClient
      .from('safiflow_proposed_orders')
      .select('*, companies(name, address)');

    // Apply user filter
    if (!isManager) {
      query = query.eq('sales_rep_id', currentUser.id);
    }

    // Apply status filter
    if (safiflowState.filters.status && safiflowState.filters.status !== 'all') {
      query = query.eq('status', safiflowState.filters.status);
    }

    // Apply sales rep filter (manager only)
    if (isManager && safiflowState.filters.salesRep && safiflowState.filters.salesRep !== 'all') {
      query = query.eq('sales_rep_id', safiflowState.filters.salesRep);
    }

    // Apply date range filter
    if (safiflowState.filters.dateRange && safiflowState.filters.dateRange !== 'all') {
      const now = new Date();
      let startDate;

      switch (safiflowState.filters.dateRange) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
      }

      if (startDate) {
        query = query.gte('created_at', startDate.toISOString());
      }
    }

    query = query.order('created_at', { ascending: false });

    const { data: proposals, error } = await query;
    if (error) throw error;

    // Fetch sales rep profiles separately if manager
    if (isManager && proposals && proposals.length > 0) {
      const repIds = [...new Set(proposals.map(p => p.sales_rep_id).filter(Boolean))];

      if (repIds.length > 0) {
        const { data: profiles } = await supabaseClient
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', repIds);

        const repProfiles = {};
        if (profiles) {
          profiles.forEach(p => {
            repProfiles[p.id] = p;
          });
        }

        // Attach profiles to proposals
        proposals.forEach(proposal => {
          proposal.rep_profile = repProfiles[proposal.sales_rep_id] || null;
        });
      }
    }

    // Apply search filter (client-side for company name)
    let filteredProposals = proposals;
    if (safiflowState.filters.searchTerm) {
      const term = safiflowState.filters.searchTerm.toLowerCase();
      filteredProposals = proposals.filter(p =>
        p.companies?.name?.toLowerCase().includes(term)
      );
    }

    if (filteredProposals.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-clipboard-list"></i>
          <h3>No proposals found</h3>
          <p>${safiflowState.filters.searchTerm || safiflowState.filters.status !== 'all'
          ? 'Try adjusting your filters'
          : isManager
            ? 'No proposals have been submitted yet'
            : 'Create your first proposal to get started'
        }</p>
          ${!isManager ? `
            <button class="btn btn-primary" onclick="startNewProposal()">
              <i class="fas fa-plus"></i> Create Proposal
            </button>
          ` : ''}
        </div>
      `;
      return;
    }

    // Render table
    container.innerHTML = `
      <table class="data-table proposals-table">
        <thead>
          <tr>
            <th>Company</th>
            ${isManager ? '<th style="width: 150px;">Sales Rep</th>' : ''}
            <th style="width: 120px;">Visit Date</th>
            <th style="width: 100px; text-align: center;">Items</th>
            <th style="width: 100px; text-align: center;">Status</th>
            <th style="width: 120px; text-align: center;">GPS</th>
            <th style="width: 80px;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filteredProposals.map(proposal => `
            <tr class="proposal-row" onclick="viewProposalDetails('${proposal.id}')">
              <td>
                <div class="company-info">
                  <div class="company-name-bold">${proposal.companies?.name || 'Unknown'}</div>
                  <div class="company-address-small">${proposal.companies?.address || 'No address'}</div>
                </div>
              </td>
              ${isManager ? `
                <td>
                  <div class="rep-info">
                    ${proposal.rep_profile?.first_name || ''} ${proposal.rep_profile?.last_name || ''}
                  </div>
                </td>
              ` : ''}
              <td>
                <div class="date-info">
                  <div>${formatDateTime(proposal.visit_timestamp, { dateStyle: 'short', timeStyle: undefined })}</div>
                  <div class="time-small">${formatDateTime(proposal.visit_timestamp, { dateStyle: undefined, timeStyle: 'short' })}</div>
                </div>
              </td>
              <td style="text-align: center;">
                <span class="items-badge">
                  ${proposal.total_items_count || 0} items
                  ${proposal.items_below_moq_count > 0 ? `<span class="moq-warning">${proposal.items_below_moq_count} below MOQ</span>` : ''}
                </span>
              </td>
              <td style="text-align: center;">
                ${generateStatusBadge(proposal.status || 'pending')}
              </td>
              <td style="text-align: center;">
                ${proposal.latitude && proposal.longitude
        ? '<span class="gps-verified"><i class="fas fa-map-marker-alt"></i> Verified</span>'
        : '<span class="gps-manual"><i class="fas fa-map-marker"></i> Manual</span>'
      }
              </td>
              <td style="text-align: center;">
                <div class="table-actions">
                  <button class="action-btn" onclick="event.stopPropagation(); viewProposalDetails('${proposal.id}')" title="View Details">
                    <i class="fas fa-eye"></i>
                  </button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

  } catch (error) {
    console.error('Error loading proposals:', error);
    container.innerHTML = `
      <div class="error-state">
        <i class="fas fa-exclamation-triangle"></i>
        <h3>Failed to load proposals</h3>
        <p>${error.message}</p>
        <button class="btn btn-primary" onclick="loadProposals()">
          <i class="fas fa-redo"></i> Retry
        </button>
      </div>
    `;
  }
}

/**
 * Filter by status (from stats card click)
 */
function filterByStatus(status) {
  safiflowState.filters.status = status;
  document.getElementById('proposal-status-filter').value = status;
  loadProposals();
}

/**
 * Reset proposal filters
 */
function resetProposalFilters() {
  safiflowState.filters = { status: 'all', dateRange: 'all', salesRep: 'all', searchTerm: '' };
  document.getElementById('proposal-search').value = '';
  document.getElementById('proposal-status-filter').value = 'all';
  document.getElementById('proposal-date-filter').value = 'all';
  if (isManager) {
    document.getElementById('proposal-rep-filter').value = 'all';
  }
  loadProposals();
}


// ============================================================================
// PROPOSAL DETAIL VIEW (Manager & Sales Rep)
// ============================================================================

/**
 * View proposal details
 */
async function viewProposalDetails(proposalId) {
  try {
    // Load proposal with all related data
    const { data: proposal, error } = await supabaseClient
      .from('safiflow_proposed_orders')
      .select(`
        *,
        companies(name, address),
        items:safiflow_proposed_order_items(
          *,
          product:safiflow_products(name, unit)
        )
      `)
      .eq('id', proposalId)
      .single();

    if (error) throw error;

    // Fetch sales rep profile
    if (proposal.sales_rep_id) {
      const { data: repProfile } = await supabaseClient
        .from('profiles')
        .select('first_name, last_name, email')
        .eq('id', proposal.sales_rep_id)
        .single();

      proposal.rep_profile = repProfile;
    }

    const isOwnProposal = proposal.sales_rep_id === currentUser.id;
    const canManage = isManager && proposal.status === 'pending';

    const modalHTML = `
      <div id="proposal-detail-modal" class="modal active safiflow-modal">
        <div class="modal-backdrop" onclick="closeSafiFlowModal('proposal-detail-modal')"></div>
        <div class="modal-container modal-large">
          <div class="modal-header">
            <div>
              <h3>Proposal #${proposal.id.slice(0, 8).toUpperCase()}</h3>
              <p class="text-muted">${proposal.companies?.name || 'Unknown Company'} • ${formatDateTime(proposal.visit_timestamp)}</p>
            </div>
            <button class="modal-close" onclick="closeSafiFlowModal('proposal-detail-modal')">
              <i class="fas fa-times"></i>
            </button>
          </div>

          <div class="modal-body">
            <!-- Proposal Summary Cards -->
            <div class="proposal-summary-grid">
              <div class="summary-card">
                <div class="summary-icon summary-icon-primary">
                  <i class="fas fa-building"></i>
                </div>
                <div class="summary-content">
                  <div class="summary-label">Location</div>
                  <div class="summary-value">${proposal.companies?.name}</div>
                  <div class="summary-meta">${proposal.companies?.address || 'No address'}</div>
                </div>
              </div>

              <div class="summary-card">
                <div class="summary-icon ${proposal.latitude ? 'summary-icon-success' : 'summary-icon-warning'}">
                  <i class="fas fa-${proposal.latitude ? 'map-marker-alt' : 'map-marker'}"></i>
                </div>
                <div class="summary-content">
                  <div class="summary-label">GPS Verification</div>
                  <div class="summary-value">${proposal.latitude ? 'Verified' : 'Manual Entry'}</div>
                  ${proposal.latitude ? `<div class="summary-meta">${proposal.latitude.toFixed(6)}, ${proposal.longitude.toFixed(6)}</div>` : ''}
                </div>
              </div>

              <div class="summary-card">
                <div class="summary-icon summary-icon-info">
                  <i class="fas fa-box"></i>
                </div>
                <div class="summary-content">
                  <div class="summary-label">Products</div>
                  <div class="summary-value">${proposal.items.length} items</div>
                  ${proposal.items_below_moq_count > 0 ? `<div class="summary-meta moq-warning-text">${proposal.items_below_moq_count} below MOQ</div>` : ''}
                </div>
              </div>

              <div class="summary-card">
                <div class="summary-icon summary-icon-${proposal.status === 'pending' ? 'warning' : proposal.status === 'approved' || proposal.status === 'complete' ? 'success' : 'danger'}">
                  <i class="fas fa-${proposal.status === 'pending' ? 'clock' : proposal.status === 'approved' || proposal.status === 'complete' ? 'check-circle' : 'times-circle'}"></i>
                </div>
                <div class="summary-content">
                  <div class="summary-label">Status</div>
                  <div class="summary-value">${proposal.status?.toUpperCase() || 'PENDING'}</div>
                  ${proposal.manager_reviewed_at ? `<div class="summary-meta">Reviewed ${formatRelativeTime(proposal.manager_reviewed_at)}</div>` : ''}
                </div>
              </div>
            </div>

            ${isManager ? `
              <div class="rep-info-banner">
                <div class="rep-avatar">${(proposal.rep_profile?.first_name?.[0] || 'U')}${(proposal.rep_profile?.last_name?.[0] || '')}</div>
                <div>
                  <div class="rep-name-strong">${proposal.rep_profile?.first_name} ${proposal.rep_profile?.last_name || ''}</div>
                  <div class="rep-email-small">${proposal.rep_profile?.email}</div>
                </div>
              </div>
            ` : ''}

            ${proposal.rep_notes ? `
              <div class="notes-section">
                <h4><i class="fas fa-sticky-note"></i> Sales Rep Notes</h4>
                <div class="notes-content">${proposal.rep_notes}</div>
              </div>
            ` : ''}

            <!-- Products Table -->
            <div class="products-section">
              <h4><i class="fas fa-list"></i> Stock Report Details</h4>
              <div class="table-container">
                <table class="data-table proposal-items-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th style="width: 100px; text-align: center;">Target MOQ</th>
                      <th style="width: 100px; text-align: center;">Stock Found</th>
                      <th style="width: 150px; text-align: center;">Compliance</th>
                      <th>Comments</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${proposal.items.map(item => {
      const compliance = calculateMOQCompliance(item.quantity, item.moq_at_creation);
      return `
                        <tr class="${item.quantity < item.moq_at_creation ? 'below-moq-row' : ''}">
                          <td>
                            <div class="product-name-bold">${item.product?.name || 'Unknown Product'}</div>
                          </td>
                          <td style="text-align: center;">
                            <span class="moq-value">${item.moq_at_creation} ${item.product?.unit || 'units'}</span>
                          </td>
                          <td style="text-align: center;">
                            <span class="stock-value ${item.quantity < item.moq_at_creation ? 'stock-below' : 'stock-ok'}">
                              ${item.quantity} ${item.product?.unit || 'units'}
                            </span>
                          </td>
                          <td style="text-align: center;">
                            ${generateProgressBar(compliance, false)}
                            <span class="compliance-percentage">${compliance}%</span>
                          </td>
                          <td>
                            <div class="item-comments">${item.rep_comments || '<span class="text-muted">—</span>'}</div>
                          </td>
                        </tr>
                      `;
    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Manager Actions Section -->
            ${canManage ? `
              <div class="manager-actions-section">
                <h4><i class="fas fa-shield-alt"></i> Manager Review</h4>
                <div class="form-field">
                  <label>Manager Notes (Internal)</label>
                  <textarea id="manager-notes" rows="3" placeholder="Add notes about this proposal..." style="background: var(--bg-secondary);">${proposal.manager_notes || ''}</textarea>
                </div>
              </div>
            ` : proposal.manager_notes ? `
              <div class="manager-notes-display">
                <h4><i class="fas fa-user-shield"></i> Manager Notes</h4>
                <div class="notes-content">${proposal.manager_notes}</div>
              </div>
            ` : ''}
          </div>

          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeSafiFlowModal('proposal-detail-modal')">Close</button>
            ${canManage ? `
              <button class="btn btn-danger" onclick="updateProposalStatus('${proposal.id}', 'rejected')">
                <i class="fas fa-times"></i> Reject
              </button>
              <button class="btn btn-success" onclick="updateProposalStatus('${proposal.id}', 'complete')">
                <i class="fas fa-check"></i> Approve
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

  } catch (error) {
    console.error('Error loading proposal details:', error);
    showToast('Failed to load proposal', 'error');
  }
}

/**
 * Update proposal status (Manager)
 */
async function updateProposalStatus(proposalId, newStatus) {
  const managerNotes = document.getElementById('manager-notes')?.value || '';

  try {
    const { error } = await supabaseClient
      .from('safiflow_proposed_orders')
      .update({
        status: newStatus,
        manager_notes: managerNotes,
        manager_reviewed_at: new Date().toISOString()
      })
      .eq('id', proposalId);

    if (error) throw error;

    showToast(`Proposal ${newStatus === 'complete' ? 'approved' : 'rejected'} successfully`, 'success');
    closeSafiFlowModal('proposal-detail-modal');

    // Refresh proposals list
    await Promise.all([
      loadProposalStats(),
      loadProposals()
    ]);

  } catch (error) {
    console.error('Error updating proposal:', error);
    showToast('Failed to update proposal', 'error');
  }
}

// ============================================================================
// SALES REP: NEW PROPOSAL WORKFLOW
// ============================================================================

/**
 * Start new proposal workflow
 */
async function startNewProposal() {
  const viewContainer = document.getElementById('view-container');

  // Load companies if not already loaded
  if (!window.allCompaniesData || window.allCompaniesData.length === 0) {
    const { data: companies, error } = await supabaseClient
      .from('companies')
      .select('*')
      .order('name');

    if (error) {
      showToast('Failed to load companies', 'error');
      return;
    }

    window.allCompaniesData = companies;
  }

  viewContainer.innerHTML = `
    <div class="safiflow-create-proposal">
      <div class="card proposal-wizard-card">
        <div class="wizard-header">
          <h2 class="wizard-title">
            <i class="fas fa-clipboard-list"></i>
            New Stock Proposal
          </h2>
          <p class="wizard-subtitle">Select a company and verify your location to begin</p>
        </div>

        <div class="wizard-body">
          <!-- Step 1: Company Selection -->
          <div class="wizard-step active" id="step-company-select">
            <div class="step-header">
              <span class="step-number">1</span>
              <h3>Select Company</h3>
            </div>

            <div class="form-field">
              <label>Search for Company</label>
              <div class="searchable-select-container">
                <div class="search-input-wrapper">
                  <i class="fas fa-search"></i>
                  <input 
                    type="text" 
                    id="company-search-input" 
                    placeholder="Type company name..." 
                    autocomplete="off"
                  />
                </div>
                <input type="hidden" id="selected-company-id" />
                <div id="company-search-results" class="search-results-overlay"></div>
              </div>
            </div>

            <div id="location-verification-status" style="display:none;" class="location-check-box">
              <div class="spinner-small"></div>
              <span>Verifying location...</span>
            </div>

            <div class="wizard-actions">
              <button class="btn btn-secondary" onclick="renderSafiFlowProposalsView()">Cancel</button>
              <button class="btn btn-primary" id="continue-to-products-btn" disabled onclick="continueToProducts()">
                Continue to Products <i class="fas fa-arrow-right"></i>
              </button>
            </div>
          </div>

          <!-- Step 2: Product Selection (Hidden initially) -->
          <div class="wizard-step" id="step-product-selection" style="display:none;">
            <!-- Will be populated dynamically -->
          </div>
        </div>
      </div>
    </div>
  `;

  // Initialize company search
  const searchInput = document.getElementById('company-search-input');
  const resultsOverlay = document.getElementById('company-search-results');
  const companyIdField = document.getElementById('selected-company-id');
  const continueBtn = document.getElementById('continue-to-products-btn');
  const locationStatus = document.getElementById('location-verification-status');

  searchInput.addEventListener('input', debounce((e) => {
    const val = e.target.value.toLowerCase();
    companyIdField.value = '';
    continueBtn.disabled = true;
    locationStatus.style.display = 'none';

    if (!val) {
      resultsOverlay.classList.remove('active');
      return;
    }

    const matches = (window.allCompaniesData || [])
      .filter(c => c.name.toLowerCase().includes(val))
      .slice(0, 8);

    if (matches.length > 0) {
      resultsOverlay.innerHTML = matches.map(m => `
        <div class="search-result-item" data-id="${m.id}" data-name="${m.name}">
          <div class="result-main">
            <i class="fas fa-building"></i>
            <span class="result-name">${m.name}</span>
          </div>
          <div class="result-meta">${m.address || 'No address'}</div>
        </div>
      `).join('');
      resultsOverlay.classList.add('active');
    } else {
      resultsOverlay.innerHTML = `
        <div class="search-result-item empty">
          <i class="fas fa-search"></i>
          <span>No companies found matching "${val}"</span>
        </div>
      `;
      resultsOverlay.classList.add('active');
    }
  }, 300));

  resultsOverlay.addEventListener('click', (e) => {
    const item = e.target.closest('.search-result-item');
    if (!item || item.classList.contains('empty')) return;

    companyIdField.value = item.dataset.id;
    searchInput.value = item.dataset.name;
    resultsOverlay.classList.remove('active');

    // Trigger location verification
    verifyLocation(item.dataset.id);
  });
}

/**
 * Verify location for selected company
 */
async function verifyLocation(companyId) {
  const locationStatus = document.getElementById('location-verification-status');
  const continueBtn = document.getElementById('continue-to-products-btn');

  locationStatus.style.display = 'flex';
  locationStatus.innerHTML = '<div class="spinner-small"></div><span>Acquiring GPS position...</span>';
  continueBtn.disabled = true;

  if (!navigator.geolocation) {
    locationStatus.innerHTML = '<i class="fas fa-exclamation-triangle warning-text"></i><span>GPS not available. Proceeding with manual entry.</span>';
    continueBtn.disabled = false;
    continueBtn.dataset.lat = '';
    continueBtn.dataset.lng = '';
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude } = position.coords;
      const company = window.allCompaniesData.find(c => c.id === companyId);

      if (company && company.latitude && company.longitude) {
        const distance = calculateDistance(latitude, longitude, company.latitude, company.longitude);
        const radius = company.radius || 200;

        if (distance <= radius) {
          locationStatus.innerHTML = `<i class="fas fa-check-circle success-text"></i><span>Location verified (${Math.round(distance)}m from site)</span>`;
          continueBtn.disabled = false;
        } else {
          locationStatus.innerHTML = `<i class="fas fa-times-circle error-text"></i><span>Out of range (${Math.round(distance)}m away). Move within ${radius}m of the site.</span>`;
        }
      } else {
        locationStatus.innerHTML = '<i class="fas fa-info-circle info-text"></i><span>No GPS coordinates on file. Proceeding without verification.</span>';
        continueBtn.disabled = false;
      }

      continueBtn.dataset.lat = latitude;
      continueBtn.dataset.lng = longitude;
    },
    (error) => {
      locationStatus.innerHTML = `<i class="fas fa-times-circle error-text"></i><span>GPS error: ${error.message}. Proceeding with manual entry.</span>`;
      continueBtn.disabled = false;
      continueBtn.dataset.lat = '';
      continueBtn.dataset.lng = '';
    }
  );
}

/**
 * Continue to products step
 */
async function continueToProducts() {
  const companyId = document.getElementById('selected-company-id').value;
  const continueBtn = document.getElementById('continue-to-products-btn');
  const lat = continueBtn.dataset.lat;
  const lng = continueBtn.dataset.lng;

  // Store in state
  safiflowState.currentProposal = {
    company_id: companyId,
    latitude: lat ? parseFloat(lat) : null,
    longitude: lng ? parseFloat(lng) : null,
    items: []
  };

  // Load assigned products for this company
  const { data: assignments, error } = await supabaseClient
    .from('safiflow_branch_product_moq')
    .select('*, product:safiflow_products(*)')
    .eq('company_id', companyId);

  if (error) {
    showToast('Failed to load products', 'error');
    return;
  }

  const assignedProducts = (assignments || []).map(a => ({
    id: a.product.id,
    name: a.product.name,
    unit: a.product.unit || 'units',
    moq: a.moq,
    image_url: a.product.image_url
  }));

  // Hide step 1, show step 2
  document.getElementById('step-company-select').style.display = 'none';
  const step2 = document.getElementById('step-product-selection');
  step2.style.display = 'block';
  step2.classList.add('active');

  step2.innerHTML = `
    <div class="step-header">
      <span class="step-number">2</span>
      <h3>Add Products</h3>
    </div>

    <div class="form-field">
      <label>Search & Add Products</label>
      <div class="searchable-select-container">
        <div class="search-input-wrapper">
          <i class="fas fa-plus-circle"></i>
          <input 
            type="text" 
            id="product-search-input" 
            placeholder="Search product to add..." 
            autocomplete="off"
          />
        </div>
        <div id="product-search-results" class="search-results-overlay"></div>
      </div>
    </div>

    <div id="proposal-items-list" class="proposal-items-wrapper">
      <div class="empty-state-small">
        <i class="fas fa-box-open"></i>
        <p>Search and add products above to start your stock report</p>
      </div>
    </div>

    <div class="wizard-actions">
      <button class="btn btn-secondary" onclick="backToCompanySelection()">Back</button>
      <button class="btn btn-primary" id="submit-proposal-btn" disabled onclick="submitProposal()">
        <i class="fas fa-paper-plane"></i> Submit Proposal
      </button>
    </div>
  `;

  // Initialize product search
  initializeProductSearch(assignedProducts);
}

/**
 * Initialize product search functionality
 */
function initializeProductSearch(products) {
  const searchInput = document.getElementById('product-search-input');
  const resultsOverlay = document.getElementById('product-search-results');

  searchInput.addEventListener('input', debounce((e) => {
    const val = e.target.value.toLowerCase();

    if (!val) {
      resultsOverlay.classList.remove('active');
      return;
    }

    // Filter out already added products
    const availableProducts = products.filter(p =>
      !safiflowState.currentProposal.items.some(item => item.id === p.id)
    );

    const matches = availableProducts
      .filter(p => p.name.toLowerCase().includes(val))
      .slice(0, 6);

    if (matches.length > 0) {
      resultsOverlay.innerHTML = matches.map(p => `
        <div class="search-result-item" data-product='${JSON.stringify(p)}'>
          <div class="result-main">
            ${p.image_url ? `<img src="${p.image_url}" class="result-thumbnail" />` : '<i class="fas fa-box"></i>'}
            <span class="result-name">${p.name}</span>
          </div>
          <div class="result-meta">MOQ: ${p.moq} ${p.unit}</div>
        </div>
      `).join('');
      resultsOverlay.classList.add('active');
    } else {
      resultsOverlay.innerHTML = `
        <div class="search-result-item empty">
          <i class="fas fa-info-circle"></i>
          <span>No products found or all assigned products already added</span>
        </div>
      `;
      resultsOverlay.classList.add('active');
    }
  }, 200));

  resultsOverlay.addEventListener('click', (e) => {
    const item = e.target.closest('.search-result-item');
    if (!item || item.classList.contains('empty')) return;

    const product = JSON.parse(item.dataset.product);
    addProductToProposal(product);

    searchInput.value = '';
    resultsOverlay.classList.remove('active');
  });
}

/**
 * Add product to proposal
 */
function addProductToProposal(product) {
  safiflowState.currentProposal.items.push({
    id: product.id,
    name: product.name,
    unit: product.unit,
    moq: product.moq,
    quantity: 0,
    comments: '',
    image_url: product.image_url
  });

  renderProposalItems();
  updateSubmitButtonState();
}

/**
 * Render proposal items list
 */
function renderProposalItems() {
  const container = document.getElementById('proposal-items-list');
  const items = safiflowState.currentProposal.items;

  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-state-small">
        <i class="fas fa-box-open"></i>
        <p>Search and add products above to start your stock report</p>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map((item, index) => {
    const compliance = calculateMOQCompliance(item.quantity, item.moq);
    return `
      <div class="proposal-item-card">
        <button class="remove-item-btn" onclick="removeProposalItem(${index})" title="Remove">
          <i class="fas fa-times"></i>
        </button>

        <div class="item-header">
          ${item.image_url ? `<img src="${item.image_url}" class="item-thumbnail" />` : '<div class="item-thumbnail-placeholder"><i class="fas fa-box"></i></div>'}
          <div class="item-info">
            <div class="item-name">${item.name}</div>
            <div class="item-moq">Target MOQ: ${item.moq} ${item.unit}</div>
          </div>
          <span class="compliance-badge ${compliance >= 100 ? 'badge-success' : 'badge-warning'}">
            ${compliance}%
          </span>
        </div>

        <div class="item-inputs">
          <div class="form-field mb-0">
            <label>Stock Found</label>
            <div class="quantity-input-group">
              <button type="button" class="qty-btn" onclick="adjustQuantity(${index}, -1)">
                <i class="fas fa-minus"></i>
              </button>
              <input 
                type="number" 
                class="qty-input" 
                value="${item.quantity}" 
                min="0"
                onchange="updateQuantity(${index}, this.value)"
              />
              <button type="button" class="qty-btn" onclick="adjustQuantity(${index}, 1)">
                <i class="fas fa-plus"></i>
              </button>
            </div>
          </div>

          <div class="form-field mb-0">
            <label>Comments ${item.quantity < item.moq ? '<span class="required-indicator">*</span>' : ''}</label>
            <input 
              type="text" 
              value="${item.comments}" 
              placeholder="${item.quantity < item.moq ? 'Explain low stock...' : 'Optional notes...'}"
              onchange="updateComments(${index}, this.value)"
            />
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Remove item from proposal
 */
function removeProposalItem(index) {
  safiflowState.currentProposal.items.splice(index, 1);
  renderProposalItems();
  updateSubmitButtonState();
}

/**
 * Adjust quantity with +/- buttons
 */
function adjustQuantity(index, delta) {
  const item = safiflowState.currentProposal.items[index];
  item.quantity = Math.max(0, item.quantity + delta);
  renderProposalItems();
  updateSubmitButtonState();
}

/**
 * Update quantity value
 */
function updateQuantity(index, value) {
  safiflowState.currentProposal.items[index].quantity = parseInt(value) || 0;
  renderProposalItems();
  updateSubmitButtonState();
}

/**
 * Update comments
 */
function updateComments(index, value) {
  safiflowState.currentProposal.items[index].comments = value;
  updateSubmitButtonState();
}

/**
 * Update submit button state based on validation
 */
function updateSubmitButtonState() {
  const submitBtn = document.getElementById('submit-proposal-btn');
  if (!submitBtn) return;

  const items = safiflowState.currentProposal.items;
  const hasItems = items.length > 0;

  // Check if all items below MOQ have comments
  const allBelowMOQHaveComments = items
    .filter(item => item.quantity < item.moq)
    .every(item => item.comments && item.comments.trim().length > 0);

  submitBtn.disabled = !(hasItems && allBelowMOQHaveComments);
}

/**
 * Back to company selection
 */
function backToCompanySelection() {
  document.getElementById('step-product-selection').style.display = 'none';
  document.getElementById('step-company-select').style.display = 'block';
}

/**
 * Submit proposal
 */
async function submitProposal() {
  const submitBtn = document.getElementById('submit-proposal-btn');
  setButtonLoading(submitBtn, true, 'Submit Proposal');

  try {
    const proposal = safiflowState.currentProposal;

    // Calculate stats
    const totalItems = proposal.items.length;
    const belowMOQCount = proposal.items.filter(item => item.quantity < item.moq).length;

    // Create proposal
    const { data: order, error: orderError } = await supabaseClient
      .from('safiflow_proposed_orders')
      .insert([{
        company_id: proposal.company_id,
        sales_rep_id: currentUser.id,
        latitude: proposal.latitude,
        longitude: proposal.longitude,
        visit_timestamp: new Date().toISOString(),
        status: 'pending',
        total_items_count: totalItems,
        items_below_moq_count: belowMOQCount
      }])
      .select()
      .single();

    if (orderError) throw orderError;

    // Create proposal items
    const itemRecords = proposal.items.map(item => ({
      proposed_order_id: order.id,
      product_id: item.id,
      quantity: item.quantity,
      moq_at_creation: item.moq,
      rep_comments: item.comments || null
    }));

    const { error: itemsError } = await supabaseClient
      .from('safiflow_proposed_order_items')
      .insert(itemRecords);

    if (itemsError) throw itemsError;

    showToast('Proposal submitted successfully!', 'success');

    // Reset state
    safiflowState.currentProposal = null;

    // Return to proposals view
    renderSafiFlowProposalsView();

  } catch (error) {
    console.error('Error submitting proposal:', error);
    showToast('Failed to submit proposal: ' + error.message, 'error');
    setButtonLoading(submitBtn, false);
  }
}


// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate distance between two GPS coords (Haversine formula)
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

/**
 * Initialize SafiFlow module
 */
function initSafiFlow() {
  // Check if running on older Safari versions and polyfill if needed
  if (!window.requestIdleCallback) {
    window.requestIdleCallback = function (handler) {
      let startTime = Date.now();
      return setTimeout(function () {
        handler({
          didTimeout: false,
          timeRemaining: function () {
            return Math.max(0, 50.0 - (Date.now() - startTime));
          }
        });
      }, 1);
    };
  }

  // Pre-load categories and common data
  if (isManager) {
    loadProductCategories();
  }

  console.log('SafiFlow initialized successfully');
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSafiFlow);
} else {
  initSafiFlow();
}

// Updated to remove 'type' column check for companies
