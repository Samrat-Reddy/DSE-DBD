/**
 * Static/mock data used by the placeholder screens.
 *
 * All mock and seed data lives under `src/data` so components stay free of
 * embedded fixtures and can be swapped to live API data without edits.
 */

export const projectModules = [
  { id: 'policies', name: 'Policy Catalog & Issuance', status: 'planned' },
  { id: 'premiums', name: 'Premium Schedule & Payments', status: 'planned' },
  { id: 'claims', name: 'Claims', status: 'planned' },
  { id: 'renewals', name: 'Renewals', status: 'planned' },
  { id: 'commission', name: 'Agent Commission', status: 'planned' },
  { id: 'reports', name: 'MIS Reports', status: 'planned' },
]

export const setupChecklist = [
  'React 19 with Vite',
  'React Router for page routing',
  'Plain CSS styling',
  'ESLint flat config',
  'Service layer isolated from UI',
]
