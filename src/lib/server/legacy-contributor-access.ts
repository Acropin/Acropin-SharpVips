/**
 * Routes available to contributors using the no-account legacy workflow.
 * Owner mutations and review actions are deliberately excluded.
 */
const LEGACY_READ_ROUTES = new Set([
  '/dataset/targets',
  '/menu-tasks',
  '/canonical-dishes',
]);

const LEGACY_SUBMISSION_ROUTES = new Set([
  '/images/upload/authorize',
  '/images/upload',
  '/images/process-url',
]);

export function isLegacyContributorRoute(method: string, path: string): boolean {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === 'GET') return LEGACY_READ_ROUTES.has(path);
  if (normalizedMethod === 'POST') return LEGACY_SUBMISSION_ROUTES.has(path);
  return false;
}

export function isAuthenticatedContributorRoute(
  method: string,
  path: string,
  requestedCatalogStatus: unknown
): boolean {
  if (isLegacyContributorRoute(method, path)) return true;
  return method.toUpperCase() === 'GET' &&
    path === '/images/catalog' &&
    requestedCatalogStatus === 'approved';
}
