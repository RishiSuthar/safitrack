// modules/features/import-export.js
// CSV import and export for companies.
import { state, supabaseClient } from '../state.js';
import { showToast, escapeHtml } from '../ui/toast.js';


const COMPANY_IMPORT_TYPES = ['Competitor', 'Customer', 'Distributor', 'Investor', 'Partner', 'Reseller', 'Supplier', 'Vendor', 'Other'];

window.openCompaniesImportExportModal = function () {
  if (state.isSalesRep) {
    showToast('Sales representatives are not permitted to import or export companies', 'error');
    return;
  }
  let modal = document.getElementById('companies-transfer-modal');

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'companies-transfer-modal';
    modal.className = 'modal';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="modal-backdrop" onclick="closeModal('companies-transfer-modal')"></div>
      <div class="modal-container companies-transfer-modal-container modal-size-transfer">
        <div class="modal-header">
          <h3><i data-lucide="file-up"></i> Companies Import / Export</h3>
          <button class="modal-close" onclick="closeModal('companies-transfer-modal')">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
              class="lucide lucide-x-icon lucide-x">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <div class="form-section">
            <div class="form-section-header" style="margin-bottom: 0; border-bottom: none; padding-bottom: 0;">
              <div class="form-section-icon"><i data-lucide="shuffle"></i></div>
              <div>
                <div class="form-section-title">Choose Action</div>
                <div class="form-section-description">Import companies from CSV or export all companies to CSV</div>
              </div>
            </div>
            <div class="companies-transfer-switch" style="margin-top: 1rem;">
              <button type="button" class="date-range-btn active" id="companies-mode-import">Import CSV</button>
              <button type="button" class="date-range-btn" id="companies-mode-export">Export CSV</button>
            </div>
          </div>

          <div class="form-section" id="companies-import-panel">
            <div class="form-section-header">
              <div class="form-section-icon"><i data-lucide="file-input"></i></div>
              <div>
                <div class="form-section-title">CSV Format Requirements</div>
                <div class="form-section-description">Use the required columns and correct data types</div>
              </div>
            </div>

            <div class="field-helper" style="margin-top: 0;">
              <span><strong>Required columns:</strong> name, company_type, address, latitude, longitude</span>
            </div>
            <div class="field-helper" style="margin-top: 0.5rem;">
              <span><strong>Optional columns:</strong> description, radius, categories</span>
            </div>
            <div class="field-helper" style="margin-top: 0.5rem;">
              <span><strong>Categories format:</strong> separate multiple values with <code>|</code> (example: Retail|Supermarket)</span>
            </div>
            <div class="field-helper mt-sm">
              <span><strong>Supported company types:</strong> ${COMPANY_IMPORT_TYPES.join(', ')}</span>
            </div>

            <div class="btn-group-inline mt-md">
              <button type="button" class="btn btn-secondary" id="download-companies-sample-btn">
                <i data-lucide="download"></i> Download Sample CSV
              </button>
            </div>

            <div class="form-field mt-md">
              <label for="companies-import-file">Upload CSV File</label>
              <input type="file" id="companies-import-file" accept=".csv,text/csv">
              <div class="field-helper">
                <span>Maximum recommended size: 5MB. Larger files may take longer to process.</span>
              </div>
            </div>

            <div id="companies-import-feedback" class="field-helper" style="display:none;"></div>
            <div id="companies-import-errors" style="display:none;"></div>

            <div class="btn-group-end mt-md">
              <button type="button" class="btn btn-primary" id="run-companies-import-btn">
                <i data-lucide="upload"></i> Import Companies
              </button>
            </div>
          </div>

          <div class="form-section" id="companies-export-panel" style="display:none;">
            <div class="form-section-header">
              <div class="form-section-icon"><i data-lucide="file-output"></i></div>
              <div>
                <div class="form-section-title">Export All Companies</div>
                <div class="form-section-description">Download all company data as CSV, including categories</div>
              </div>
            </div>
            <div class="field-helper">
              <span>This export includes: name, type, description, address, latitude, longitude, radius, categories.</span>
            </div>

            <div class="btn-group-end mt-md">
              <button type="button" class="btn btn-primary" id="run-companies-export-btn">
                <i data-lucide="download"></i> Export Companies CSV
              </button>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal('companies-transfer-modal')">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const importBtn = document.getElementById('companies-mode-import');
    const exportBtn = document.getElementById('companies-mode-export');
    const importPanel = document.getElementById('companies-import-panel');
    const exportPanel = document.getElementById('companies-export-panel');

    importBtn?.addEventListener('click', () => {
      importBtn.classList.add('active');
      exportBtn?.classList.remove('active');
      if (importPanel) importPanel.style.display = 'block';
      if (exportPanel) exportPanel.style.display = 'none';
    });

    exportBtn?.addEventListener('click', () => {
      exportBtn.classList.add('active');
      importBtn?.classList.remove('active');
      if (importPanel) importPanel.style.display = 'none';
      if (exportPanel) exportPanel.style.display = 'block';
    });

    document.getElementById('download-companies-sample-btn')?.addEventListener('click', downloadCompaniesSampleCsv);
    document.getElementById('run-companies-export-btn')?.addEventListener('click', exportAllCompaniesToCsv);
    document.getElementById('run-companies-import-btn')?.addEventListener('click', runCompaniesImportFromCsv);

    document.getElementById('companies-import-file')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      const feedback = document.getElementById('companies-import-feedback');
      if (!feedback) return;

      if (!file) {
        feedback.style.display = 'none';
        return;
      }

      feedback.style.display = 'flex';
      feedback.style.color = 'var(--text-muted)';
      feedback.innerHTML = `<span>Selected file: <strong>${file.name}</strong> (${Math.ceil(file.size / 1024)} KB)</span>`;
    });
  }

  modal.style.display = 'flex';
  if (window.lucide) lucide.createIcons();
};

function escapeCsvValue(value) {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function downloadCsvFile(filename, rows) {
  const csvText = rows.map(row => row.map(escapeCsvValue).join(',')).join('\n');
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadCompaniesSampleCsv() {
  const sampleRows = [
    ['name', 'company_type', 'address', 'description', 'latitude', 'longitude', 'radius', 'categories'],
    ['Acme Corporation', 'Customer', '123 Main Street, Nairobi, Kenya', 'Retail partner account', '-1.286389', '36.817223', '200', 'Retail|Supermarket'],
    ['Northwind Supplies', 'Supplier', '45 Industrial Road, Mombasa, Kenya', 'Primary distributor for region', '-4.043477', '39.668206', '250', 'Distribution|Logistics']
  ];

  downloadCsvFile('companies_import_sample.csv', sampleRows);
  showToast('Sample CSV downloaded', 'success');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value.trim());
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index++;
      row.push(value.trim());
      if (row.some(cell => cell !== '')) {
        rows.push(row);
      }
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value.trim());
    if (row.some(cell => cell !== '')) {
      rows.push(row);
    }
  }

  return rows;
}

function normalizeCompanyCsvHeader(header) {
  const normalized = (header || '').toLowerCase().trim().replace(/\s+/g, '_');
  const map = {
    company_name: 'name',
    type: 'company_type',
    location: 'address',
    location_address: 'address',
    lat: 'latitude',
    lng: 'longitude',
    long: 'longitude'
  };
  return map[normalized] || normalized;
}

function parseCompanyType(value) {
  if (!value) return null;
  const match = COMPANY_IMPORT_TYPES.find(type => type.toLowerCase() === value.toLowerCase().trim());
  return match || null;
}

function parseCategoriesCell(value) {
  if (!value) return [];
  return value
    .split(/\||;/)
    .map(item => item.trim())
    .filter(Boolean)
    .filter((item, idx, arr) => arr.findIndex(v => v.toLowerCase() === item.toLowerCase()) === idx);
}

async function exportAllCompaniesToCsv() {
  const exportBtn = document.getElementById('run-companies-export-btn');
  if (exportBtn) {
    exportBtn.disabled = true;
    exportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';
  }

  try {
    if (window.allCompaniesPromise) await window.allCompaniesPromise;
    const companies = window.allCompaniesData || [];

    const rows = [
      ['name', 'company_type', 'description', 'address', 'latitude', 'longitude', 'radius', 'categories']
    ];

    (companies || []).forEach(company => {
      const categories = (company.company_categories || []).map(item => item.categories?.name).filter(Boolean).join('|');
      rows.push([
        company.name || '',
        company.company_type || '',
        company.description || '',
        company.address || '',
        company.latitude ?? '',
        company.longitude ?? '',
        company.radius ?? '',
        categories
      ]);
    });

    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsvFile(`companies_export_${stamp}.csv`, rows);
    showToast(`Exported ${companies?.length || 0} companies`, 'success');
  } catch (error) {
    showToast('Export failed: ' + error.message, 'error');
  } finally {
    if (exportBtn) {
      exportBtn.disabled = false;
      exportBtn.innerHTML = '<i data-lucide="download"></i> Export Companies CSV';
      if (window.lucide) lucide.createIcons();
    }
  }
}

async function runCompaniesImportFromCsv() {
  const fileInput = document.getElementById('companies-import-file');
  const importBtn = document.getElementById('run-companies-import-btn');
  const feedback = document.getElementById('companies-import-feedback');
  const errorListContainer = document.getElementById('companies-import-errors');
  const file = fileInput?.files?.[0];

  if (!file) {
    showToast('Please choose a CSV file to import', 'error');
    return;
  }

  if (importBtn) {
    importBtn.disabled = true;
    importBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';
  }

  try {
    if (errorListContainer) {
      errorListContainer.style.display = 'none';
      errorListContainer.innerHTML = '';
    }

    const csvText = await file.text();
    const rows = parseCsv(csvText);

    if (rows.length < 2) {
      throw new Error('CSV is empty or missing data rows');
    }

    const rawHeaders = rows[0].map(normalizeCompanyCsvHeader);
    const requiredHeaders = ['name', 'company_type', 'address', 'latitude', 'longitude'];
    const missingHeaders = requiredHeaders.filter(header => !rawHeaders.includes(header));

    if (missingHeaders.length > 0) {
      throw new Error(`Missing required columns: ${missingHeaders.join(', ')}`);
    }

    const hasCategoriesColumn = rawHeaders.includes('categories');

    if (window.allCompaniesPromise) await window.allCompaniesPromise;
    const existingCompanies = window.allCompaniesData || [];

    const existingMap = new Map((existingCompanies || []).map(company => [
      `${(company.name || '').trim().toLowerCase()}::${(company.address || '').trim().toLowerCase()}`,
      company.id
    ]));

    const { data: categoryData, error: categoryReadError } = await supabaseClient
      .from('categories')
      .select('id, name');

    if (categoryReadError) throw categoryReadError;

    const categoryCache = new Map((categoryData || []).map(cat => [cat.name.toLowerCase(), cat.id]));

    const errors = [];
    let created = 0;
    let updated = 0;

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const rowData = {};

      rawHeaders.forEach((header, idx) => {
        rowData[header] = (row[idx] || '').trim();
      });

      const displayRow = rowIndex + 1;
      const companyType = parseCompanyType(rowData.company_type);
      const latitude = Number(rowData.latitude);
      const longitude = Number(rowData.longitude);
      const radius = rowData.radius ? Number(rowData.radius) : 200;

      if (!rowData.name) {
        errors.push({ row: displayRow, reason: 'name is required' });
        continue;
      }
      if (!companyType) {
        errors.push({ row: displayRow, reason: 'invalid company_type' });
        continue;
      }
      if (!rowData.address) {
        errors.push({ row: displayRow, reason: 'address is required' });
        continue;
      }
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        errors.push({ row: displayRow, reason: 'latitude/longitude must be valid numbers' });
        continue;
      }
      if (!Number.isFinite(radius)) {
        errors.push({ row: displayRow, reason: 'radius must be a valid number' });
        continue;
      }

      const companyPayload = {
        name: rowData.name,
        company_type: companyType,
        description: rowData.description || null,
        address: rowData.address,
        latitude,
        longitude,
        radius: Math.min(Math.max(Math.round(radius), 50), 1000)
      };

      const dedupeKey = `${rowData.name.toLowerCase()}::${rowData.address.toLowerCase()}`;
      let companyId = existingMap.get(dedupeKey);

      try {
        if (companyId) {
          const { error: updateError } = await supabaseClient
            .from('companies')
            .update(companyPayload)
            .eq('id', companyId);

          if (updateError) throw updateError;
          updated++;
        } else {
          const { data: inserted, error: insertError } = await supabaseClient
            .from('companies')
            .insert([{ ...companyPayload, created_by: state.currentUser.id, organization_id: state.currentOrganization?.id }])
            .select('id')
            .single();

          if (insertError) throw insertError;
          companyId = inserted.id;
          existingMap.set(dedupeKey, companyId);
          created++;
        }

        if (hasCategoriesColumn) {
          const categories = parseCategoriesCell(rowData.categories || '');

          await supabaseClient
            .from('company_categories')
            .delete()
            .eq('company_id', companyId);

          if (categories.length > 0) {
            const links = [];

            for (const categoryName of categories) {
              let categoryId = categoryCache.get(categoryName.toLowerCase());

              if (!categoryId) {
                const { data: newCategory, error: createCategoryError } = await supabaseClient
                  .from('categories')
                  .insert([{ name: categoryName }])
                  .select('id, name')
                  .single();

                if (createCategoryError) throw createCategoryError;
                categoryId = newCategory.id;
                categoryCache.set((newCategory.name || categoryName).toLowerCase(), categoryId);
              }

              links.push({ company_id: companyId, category_id: categoryId });
            }

            if (links.length > 0) {
              const { error: linkError } = await supabaseClient
                .from('company_categories')
                .insert(links);

              if (linkError) throw linkError;
            }
          }
        }
      } catch (error) {
        errors.push({ row: displayRow, reason: error.message });
      }
    }

    const processed = rows.length - 1;
    const failed = errors.length;

    if (feedback) {
      feedback.style.display = 'flex';
      feedback.style.color = failed > 0 ? 'var(--color-warning)' : 'var(--color-success)';
      feedback.innerHTML = `<span>Processed ${processed} rows • Created: ${created} • Updated: ${updated} • Failed: ${failed}</span>`;
    }

    if (errorListContainer && failed > 0) {
      const errorItemsHtml = errors
        .map(item => `<li><strong>Row ${item.row}:</strong> ${item.reason}</li>`)
        .join('');

      errorListContainer.style.display = 'block';
      errorListContainer.innerHTML = `
        <div class="companies-import-errors-card">
          <div class="companies-import-errors-title">Rows with issues</div>
          <ul class="companies-import-errors-list">${errorItemsHtml}</ul>
        </div>
      `;
    }

    if (failed > 0) {
      showToast(`Import finished with ${failed} issue(s). Check browser console for row details.`, 'error');
    } else {
      showToast(`Import successful. Created ${created}, updated ${updated}.`, 'success');
    }

    await renderCompaniesView();
  } catch (error) {
    showToast('Import failed: ' + error.message, 'error');
    if (feedback) {
      feedback.style.display = 'flex';
      feedback.style.color = 'var(--color-danger)';
      feedback.innerHTML = `<span>${error.message}</span>`;
    }
  } finally {
    if (importBtn) {
      importBtn.disabled = false;
      importBtn.innerHTML = '<i data-lucide="upload"></i> Import Companies';
      if (window.lucide) lucide.createIcons();
    }
  }
}

// setDateRange removed (export modal removed)

// executeExport removed (export modal removed)

// Export-to-PDF/Excel/CSV helpers removed along with export modal


// ── Exports ────────────────────────────────────────────────────
export {
  escapeCsvValue,
  downloadCsvFile,
  downloadCompaniesSampleCsv,
  parseCsv,
  normalizeCompanyCsvHeader,
  parseCompanyType,
  parseCategoriesCell,
  exportAllCompaniesToCsv,
  runCompaniesImportFromCsv,
};
