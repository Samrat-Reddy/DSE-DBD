/**
 * Pure catalog query helpers (search, filter, sort).
 *
 * These live outside components so the same rules can later be replaced by
 * FastAPI query parameters without touching any UI. The service layer calls
 * them; components never do.
 */

/** Fields a catalog search should match against. */
const SEARCHABLE_FIELDS = ['id', 'name', 'type']

const normalise = (value) => String(value ?? '').toLowerCase().trim()

/** Case-insensitive match on product name, product ID, or policy type. */
export const matchesSearch = (product, term) => {
  const query = normalise(term)
  if (!query) return true

  return SEARCHABLE_FIELDS.some((field) => normalise(product[field]).includes(query))
}

export const matchesType = (product, type) =>
  !type || type === 'all' || product.type === type

export const matchesStatus = (product, status) =>
  !status || status === 'all' || product.status === status

const SORT_COMPARATORS = {
  'name-asc': (a, b) => a.name.localeCompare(b.name),
  'name-desc': (a, b) => b.name.localeCompare(a.name),
  'premium-asc': (a, b) => a.premium - b.premium,
  'premium-desc': (a, b) => b.premium - a.premium,
  'coverage-desc': (a, b) => b.coverageAmount - a.coverageAmount,
  'type-asc': (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
}

export const sortProducts = (products, sortKey) => {
  const comparator = SORT_COMPARATORS[sortKey]
  // Copy first — never sort the source array in place.
  return comparator ? [...products].sort(comparator) : [...products]
}

/**
 * Apply search, filters and sorting in one pass.
 *
 * @param {Array} products Source list.
 * @param {{search?: string, type?: string, status?: string, sort?: string}} query
 * @returns {Array} A new, filtered and sorted array.
 */
export const queryPolicyProducts = (products, query = {}) => {
  const { search, type, status, sort } = query

  const filtered = products.filter(
    (product) =>
      matchesSearch(product, search) &&
      matchesType(product, type) &&
      matchesStatus(product, status),
  )

  return sortProducts(filtered, sort)
}

/** Count products per status, used for the catalog summary strip. */
export const summariseProducts = (products) =>
  products.reduce(
    (summary, product) => ({
      ...summary,
      total: summary.total + 1,
      [product.status]: (summary[product.status] ?? 0) + 1,
    }),
    { total: 0 },
  )
