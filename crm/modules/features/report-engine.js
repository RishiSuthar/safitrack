// modules/features/report-engine.js
// ═══════════════════════════════════════════════════════════════════════════════
// SafiTrack Report Engine — Dynamic, composable query builder
// Drives all report generation from a declarative config object.
// ═══════════════════════════════════════════════════════════════════════════════

import { state, supabaseClient } from '../state.js';

const ORG_ID = () => state.currentOrganization?.id;

// ── Data Source Registry ────────────────────────────────────────────────────
// Each data source describes its table, fields, and how it relates to others.
// Adding a new CRM object = adding one entry here. No other changes needed.

const DATA_SOURCES = {
  companies: {
    table: 'companies',
    label: 'Companies',
    icon: 'building',
    fields: [
      { key: 'name',         label: 'Name',         type: 'text' },
      { key: 'company_type', label: 'Type',          type: 'select', options: ['prospect', 'customer', 'partner', 'vendor', 'other'] },
      { key: 'domain',       label: 'Domain',        type: 'text' },
      { key: 'address',      label: 'Address',       type: 'text' },
      { key: 'description',  label: 'Description',   type: 'text' },
      { key: 'created_at',   label: 'Created',       type: 'date' },
      { key: 'updated_at',   label: 'Updated',       type: 'date' },
    ],
    numericFields: [],
    defaultSelect: 'id, name, company_type, domain, address, created_at, updated_at',
    relationships: ['people', 'opportunities', 'visits'],
  },

  people: {
    table: 'people',
    label: 'People',
    icon: 'users',
    fields: [
      { key: 'name',       label: 'Name',      type: 'text' },
      { key: 'email',      label: 'Email',     type: 'text' },
      { key: 'job_title',  label: 'Job Title', type: 'text' },
      { key: 'company_id', label: 'Company',   type: 'relation' },
      { key: 'created_at', label: 'Created',   type: 'date' },
      { key: 'updated_at', label: 'Updated',   type: 'date' },
    ],
    numericFields: [],
    defaultSelect: 'id, name, email, job_title, company_id, created_at, updated_at',
    relationships: ['companies', 'opportunities'],
  },

  opportunities: {
    table: 'opportunities',
    label: 'Deals',
    icon: 'circle-dollar-sign',
    fields: [
      { key: 'name',          label: 'Name',        type: 'text' },
      { key: 'company_name',  label: 'Company',     type: 'text' },
      { key: 'value',         label: 'Value',       type: 'number' },
      { key: 'probability',   label: 'Probability', type: 'number' },
      { key: 'stage',         label: 'Stage',       type: 'select', options: ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed-won', 'closed-lost'] },
      { key: 'user_id',       label: 'Owner',       type: 'relation' },
      { key: 'next_step',     label: 'Next Step',   type: 'text' },
      { key: 'next_step_date', label: 'Next Step Date', type: 'date' },
      { key: 'created_at',    label: 'Created',     type: 'date' },
      { key: 'updated_at',    label: 'Updated',     type: 'date' },
    ],
    numericFields: ['value', 'probability'],
    defaultSelect: 'id, name, company_name, value, probability, stage, user_id, next_step_date, created_at, updated_at',
    relationships: ['companies', 'people', 'visits'],
  },

  visits: {
    table: 'visits',
    label: 'Activities',
    icon: 'map-pin',
    fields: [
      { key: 'company_name',  label: 'Company',    type: 'text' },
      { key: 'contact_name',  label: 'Contact',    type: 'text' },
      { key: 'visit_type',    label: 'Type',        type: 'select', options: ['site_visit', 'survey_visit', 'installation_visit', 'maintenance_visit'] },
      { key: 'lead_score',    label: 'Lead Score', type: 'number' },
      { key: 'user_id',       label: 'Owner',      type: 'relation' },
      { key: 'location_name', label: 'Location',   type: 'text' },
      { key: 'notes',         label: 'Notes',      type: 'text' },
      { key: 'created_at',    label: 'Created',    type: 'date' },
    ],
    numericFields: ['lead_score'],
    defaultSelect: 'id, company_name, contact_name, visit_type, lead_score, user_id, location_name, created_at',
    relationships: ['companies'],
  },

  tasks: {
    table: 'tasks',
    label: 'Tasks',
    icon: 'check-square',
    fields: [
      { key: 'title',       label: 'Title',    type: 'text' },
      { key: 'status',      label: 'Status',   type: 'select', options: ['todo', 'in-progress', 'done'] },
      { key: 'priority',    label: 'Priority', type: 'select', options: ['low', 'medium', 'high', 'urgent'] },
      { key: 'due_date',    label: 'Due Date', type: 'date' },
      { key: 'assigned_to', label: 'Assigned', type: 'relation' },
      { key: 'created_at',  label: 'Created',  type: 'date' },
    ],
    numericFields: [],
    defaultSelect: 'id, title, status, priority, due_date, assigned_to, created_at',
    relationships: [],
  },
};

// ── Filter Operators ────────────────────────────────────────────────────────

const FILTER_OPERATORS = {
  text:   [
    { key: 'eq',       label: 'equals' },
    { key: 'neq',      label: 'not equals' },
    { key: 'ilike',    label: 'contains' },
    { key: 'not_ilike', label: 'does not contain' },
    { key: 'is_null',  label: 'is empty' },
    { key: 'not_null', label: 'is not empty' },
  ],
  number: [
    { key: 'eq',  label: 'equals' },
    { key: 'neq', label: 'not equals' },
    { key: 'gt',  label: 'greater than' },
    { key: 'gte', label: 'greater or equal' },
    { key: 'lt',  label: 'less than' },
    { key: 'lte', label: 'less or equal' },
  ],
  select: [
    { key: 'eq',  label: 'is' },
    { key: 'neq', label: 'is not' },
    { key: 'in',  label: 'is any of' },
  ],
  date:   [
    { key: 'eq',  label: 'on' },
    { key: 'gt',  label: 'after' },
    { key: 'lt',  label: 'before' },
    { key: 'gte', label: 'on or after' },
    { key: 'lte', label: 'on or before' },
    { key: 'is_null',  label: 'is empty' },
    { key: 'not_null', label: 'is not empty' },
  ],
  relation: [
    { key: 'eq',      label: 'is' },
    { key: 'neq',     label: 'is not' },
    { key: 'is_null', label: 'is empty' },
    { key: 'not_null', label: 'is not empty' },
  ],
};

// ── Metric Types ────────────────────────────────────────────────────────────

const METRIC_TYPES = [
  { key: 'count',   label: 'Count',           needsField: false },
  { key: 'sum',     label: 'Sum',             needsField: true, fieldType: 'number' },
  { key: 'avg',     label: 'Average',         needsField: true, fieldType: 'number' },
  { key: 'min',     label: 'Min',             needsField: true, fieldType: 'number' },
  { key: 'max',     label: 'Max',             needsField: true, fieldType: 'number' },
];

// ── Visualization Types ─────────────────────────────────────────────────────

const VIZ_TYPES = [
  { key: 'kpi',    label: 'KPI Card',   icon: 'hash' },
  { key: 'table',  label: 'Table',      icon: 'table' },
  { key: 'bar',    label: 'Bar Chart',  icon: 'bar-chart-2' },
  { key: 'line',   label: 'Line Chart', icon: 'trending-up' },
  { key: 'funnel', label: 'Funnel',     icon: 'filter' },
];

// ── Grouping Intervals ──────────────────────────────────────────────────────

const DATE_INTERVALS = [
  { key: 'day',   label: 'Day' },
  { key: 'week',  label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
];

// ── Query Builder ───────────────────────────────────────────────────────────

function applyFilters(query, filters, source) {
  for (const f of filters) {
    if (!f.field || !f.operator) continue;
    const val = f.value;

    switch (f.operator) {
      case 'eq':        query = query.eq(f.field, val); break;
      case 'neq':       query = query.neq(f.field, val); break;
      case 'gt':        query = query.gt(f.field, val); break;
      case 'gte':       query = query.gte(f.field, val); break;
      case 'lt':        query = query.lt(f.field, val); break;
      case 'lte':       query = query.lte(f.field, val); break;
      case 'ilike':     query = query.ilike(f.field, `%${val}%`); break;
      case 'not_ilike': query = query.not(f.field, 'ilike', `%${val}%`); break;
      case 'is_null':   query = query.is(f.field, null); break;
      case 'not_null':  query = query.not(f.field, 'is', null); break;
      case 'in':        {
        const arr = Array.isArray(val) ? val : String(val).split(',').map(s => s.trim());
        query = query.in(f.field, arr);
        break;
      }
    }
  }
  return query;
}

// Relationship filters: fetch IDs from related table, then filter main query
async function resolveRelationshipIds(relationships, dataSource) {
  if (!relationships?.length) return null;

  const relIdSets = [];
  for (const rel of relationships) {
    if (!rel.target || !rel.condition) continue;

    const targetSource = DATA_SOURCES[rel.target];
    if (!targetSource) continue;

    // Build a query on the related table
    let relQuery = supabaseClient
      .from(targetSource.table)
      .select(getJoinField(dataSource, rel.target))
      .eq('organization_id', ORG_ID());

    // Apply the relationship condition
    if (rel.operator && rel.condition !== '_exists') {
      switch (rel.operator) {
        case 'eq':  relQuery = relQuery.eq(rel.condition, rel.value); break;
        case 'neq': relQuery = relQuery.neq(rel.condition, rel.value); break;
        case 'gt':  relQuery = relQuery.gt(rel.condition, rel.value); break;
        case 'gte': relQuery = relQuery.gte(rel.condition, rel.value); break;
        case 'lt':  relQuery = relQuery.lt(rel.condition, rel.value); break;
        case 'lte': relQuery = relQuery.lte(rel.condition, rel.value); break;
      }
    }

    const { data } = await relQuery;
    if (!data) continue;

    const joinField = getJoinField(dataSource, rel.target);
    const ids = new Set(data.map(r => r[joinField]).filter(Boolean));
    relIdSets.push(ids);
  }

  if (!relIdSets.length) return null;

  // Intersect all relationship ID sets
  let result = relIdSets[0];
  for (let i = 1; i < relIdSets.length; i++) {
    result = new Set([...result].filter(id => relIdSets[i].has(id)));
  }
  return [...result];
}

// Determine the join field between two data sources
function getJoinField(sourceKey, targetKey) {
  const map = {
    'companies→people':        'company_id',
    'companies→opportunities': 'company_name',
    'companies→visits':        'company_name',
    'people→companies':        'company_id',
    'people→opportunities':    'opportunity_id',
    'opportunities→companies': 'company_name',
    'opportunities→people':    'user_id',
    'opportunities→visits':    'company_name',
    'visits→companies':        'company_name',
  };
  return map[`${sourceKey}→${targetKey}`] || 'id';
}

// ── Execute Report ──────────────────────────────────────────────────────────

async function executeReport(config) {
  const source = DATA_SOURCES[config.data_source];
  if (!source) throw new Error(`Unknown data source: ${config.data_source}`);

  const orgId = ORG_ID();
  if (!orgId) throw new Error('No organization loaded');

  // Resolve relationship filters to ID lists
  const relIds = await resolveRelationshipIds(config.relationships, config.data_source);

  // Build main query
  let query = supabaseClient
    .from(source.table)
    .select(source.defaultSelect)
    .eq('organization_id', orgId);

  // Sales reps only see their own data (matches the rest of the app)
  if (state.isSalesRep) {
    const userId = state.currentUser?.id;
    if (userId) {
      if (config.data_source === 'opportunities' || config.data_source === 'visits') {
        query = query.eq('user_id', userId);
      } else if (config.data_source === 'tasks') {
        query = query.or(`assigned_to.eq.${userId},created_by.eq.${userId}`);
      }
    }
  }

  // Apply standard filters
  if (config.filters?.length) {
    query = applyFilters(query, config.filters, source);
  }

  // Apply relationship filter (ID-based)
  if (relIds !== null) {
    if (relIds.length === 0) {
      // No matches — return empty
      return { rows: [], metrics: {}, groups: [] };
    }
    query = query.in('id', relIds.slice(0, 1000)); // Supabase IN limit
  }

  // Order
  query = query.order('created_at', { ascending: false }).limit(5000);

  const { data: rows, error } = await query;
  if (error) throw error;

  // Compute metrics
  const metrics = computeMetrics(rows || [], config.metrics || []);

  // Compute grouping
  const groups = computeGrouping(rows || [], config.grouping, config.metrics);

  return { rows: rows || [], metrics, groups };
}

// ── Compute Metrics (client-side aggregation) ───────────────────────────────

function computeMetrics(rows, metricConfigs) {
  const result = {};
  for (const m of metricConfigs) {
    const key = m.label || `${m.type}_${m.field || 'all'}`;
    switch (m.type) {
      case 'count':
        result[key] = rows.length;
        break;
      case 'sum':
        result[key] = rows.reduce((s, r) => s + (parseFloat(r[m.field]) || 0), 0);
        break;
      case 'avg': {
        const vals = rows.map(r => parseFloat(r[m.field])).filter(v => !isNaN(v));
        result[key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        break;
      }
      case 'min': {
        const vals = rows.map(r => parseFloat(r[m.field])).filter(v => !isNaN(v));
        result[key] = vals.length ? Math.min(...vals) : 0;
        break;
      }
      case 'max': {
        const vals = rows.map(r => parseFloat(r[m.field])).filter(v => !isNaN(v));
        result[key] = vals.length ? Math.max(...vals) : 0;
        break;
      }
    }
  }
  return result;
}

// ── Compute Grouping ────────────────────────────────────────────────────────

function computeGrouping(rows, groupingConfig, metricConfigs) {
  if (!groupingConfig?.field) return [];

  const field = groupingConfig.field;
  const interval = groupingConfig.interval; // day/week/month/quarter for date fields
  const buckets = new Map();

  for (const row of rows) {
    let key = row[field];

    // Date grouping
    if (interval && key) {
      const d = new Date(key);
      if (!isNaN(d.getTime())) {
        switch (interval) {
          case 'day':
            key = d.toISOString().slice(0, 10);
            break;
          case 'week': {
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(d);
            monday.setDate(diff);
            key = monday.toISOString().slice(0, 10);
            break;
          }
          case 'month':
            key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            break;
          case 'quarter':
            key = `${d.getFullYear()}-Q${Math.ceil((d.getMonth() + 1) / 3)}`;
            break;
        }
      }
    }

    key = key ?? '(empty)';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }

  // For each bucket, compute metrics
  const groups = [];
  for (const [label, bucketRows] of buckets) {
    const metrics = computeMetrics(bucketRows, metricConfigs || [{ type: 'count' }]);
    groups.push({ label, count: bucketRows.length, metrics });
  }

  // Sort: dates ascending, others by count descending
  if (interval) {
    groups.sort((a, b) => String(a.label).localeCompare(String(b.label)));
  } else {
    groups.sort((a, b) => b.count - a.count);
  }

  return groups;
}

// ── Saved Reports CRUD ──────────────────────────────────────────────────────

async function saveReport(reportConfig) {
  const orgId = ORG_ID();
  const userId = state.currentUser?.id;
  if (!orgId || !userId) throw new Error('Not authenticated');

  const payload = {
    organization_id: orgId,
    created_by: userId,
    name: reportConfig.name || 'Untitled Report',
    data_source: reportConfig.data_source,
    filters: reportConfig.filters || [],
    relationships: reportConfig.relationships || [],
    metrics: reportConfig.metrics || [],
    grouping: reportConfig.grouping || {},
    visualization: reportConfig.visualization || 'table',
    config: reportConfig.config || {},
    is_favorite: reportConfig.is_favorite || false,
  };

  if (reportConfig.id) {
    // Update
    const { data, error } = await supabaseClient
      .from('saved_reports')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', reportConfig.id)
      .eq('organization_id', orgId)
      .select()
      .single();
    if (error) throw error;
    return data;
  } else {
    // Insert
    const { data, error } = await supabaseClient
      .from('saved_reports')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}

async function loadSavedReports() {
  const orgId = ORG_ID();
  const userId = state.currentUser?.id;
  if (!orgId || !userId) return [];

  const { data, error } = await supabaseClient
    .from('saved_reports')
    .select('*')
    .eq('organization_id', orgId)
    .eq('created_by', userId)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

async function deleteReport(reportId) {
  const orgId = ORG_ID();
  const userId = state.currentUser?.id;
  const { error } = await supabaseClient
    .from('saved_reports')
    .delete()
    .eq('id', reportId)
    .eq('organization_id', orgId)
    .eq('created_by', userId);
  if (error) throw error;
}

// ── Profile loader for owner display ────────────────────────────────────────

let _profileCache = null;
async function getOrgProfiles() {
  if (_profileCache) return _profileCache;
  const orgId = ORG_ID();
  const { data } = await supabaseClient
    .from('profiles')
    .select('id, first_name, last_name, role')
    .eq('organization_id', orgId);
  _profileCache = data || [];
  // Clear cache after 5 minutes
  setTimeout(() => { _profileCache = null; }, 300000);
  return _profileCache;
}

function getProfileName(profiles, userId) {
  const p = profiles.find(pr => pr.id === userId);
  return p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown' : 'Unknown';
}

// ── Exports ─────────────────────────────────────────────────────────────────

export {
  DATA_SOURCES,
  FILTER_OPERATORS,
  METRIC_TYPES,
  VIZ_TYPES,
  DATE_INTERVALS,
  executeReport,
  saveReport,
  loadSavedReports,
  deleteReport,
  getOrgProfiles,
  getProfileName,
  computeMetrics,
  computeGrouping,
};
