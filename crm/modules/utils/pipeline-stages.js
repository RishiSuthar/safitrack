// modules/utils/pipeline-stages.js
// Canonical sales pipeline stage taxonomy shared across CRM views.

export const DEFAULT_SALES_STAGES = [
  { id: 'prospecting', title: 'Lead', color: '#3b82f6' },
  { id: 'qualification', title: 'In Progress', color: '#ec4899' },
  { id: 'closed-won', title: 'Won 🎉', color: '#10b981' },
  { id: 'closed-lost', title: 'Lost', color: '#ef4444' },
];

export const LEGACY_STAGE_TO_CANONICAL = {
  prospecting: 'prospecting',
  lead: 'prospecting',
  qualification: 'qualification',
  'in-progress': 'qualification',
  proposal: 'qualification',
  negotiation: 'qualification',
  'closed-won': 'closed-won',
  won: 'closed-won',
  'closed-lost': 'closed-lost',
  lost: 'closed-lost',
};

export function getDefaultSalesStages() {
  return DEFAULT_SALES_STAGES.map((stage) => ({ ...stage }));
}

export function normalizeOpportunityStage(stage) {
  const key = String(stage || '').trim().toLowerCase().replace(/_/g, '-');
  return LEGACY_STAGE_TO_CANONICAL[key] || 'prospecting';
}
