// Org login ids ("TF-GREEN-VALLEY"). Stored lowercase, shown uppercase.
//
// The TF- prefix adds no uniqueness — every org carries it. It exists so the id
// is self-identifying when someone pastes it into a support email, and so the
// login form reads as "org code", not "email".

export const SLUG_PREFIX = 'tf';

// Longest name-derived part of the id. "Green Valley International Public
// School" would otherwise become a login id nobody is willing to type.
const ROOT_MAX = 12;

// Roots that would collide with hostnames/paths if we ever move orgs onto
// subdomains, plus the ones users guess when phishing for another org's portal.
const RESERVED_ROOTS = new Set(['admin', 'api', 'www', 'app', 'super', 'org', 'portal', 'login']);

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// Users type "TF-INTERVAL" from their welcome email; the db holds "tf-interval".
export const normalizeSlug = (s) => slugify(String(s));

// Uppercase for display only — never store this form.
export const displaySlug = (s) => String(s).toUpperCase();

// Name -> the part after "tf-", capped at ROOT_MAX.
//
// The cap cuts on a word boundary, never mid-word: "Metro University" gives
// "metro", not "metro-univer". A single word longer than the cap has no
// boundary to fall back to, so it is truncated ("internationalschool" ->
// "internationa").
export function slugRoot(name) {
  const full = slugify(name);
  if (full.length <= ROOT_MAX) return full || 'org';

  const cut = full.slice(0, ROOT_MAX);
  if (full[ROOT_MAX] === '-') return cut; // cut landed exactly on a boundary

  const trimmed = cut.replace(/-[^-]*$/, ''); // drop the half-eaten last word
  return (trimmed || cut).replace(/-+$/, '') || 'org';
}

// True when `root` may be used bare, i.e. as "tf-<root>".
export const rootIsReserved = (root) => RESERVED_ROOTS.has(root);

// Strips a leading "tf-" so an explicitly supplied id can't become "tf-tf-x".
export const buildSlug = (root) => `${SLUG_PREFIX}-${String(root).replace(/^tf-/, '')}`;
