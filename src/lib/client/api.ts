const ADMIN_TOKEN_KEY = 'acropin-admin-token';

/** Sends owner-dashboard requests with the session's admin token when one is available. */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const isSafeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(method);

  let token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  if (!token && !isSafeMethod) {
    token = window.prompt('Enter the Acropin admin access code to make this change:')?.trim() || null;
  }
  if (!token && !isSafeMethod) throw new Error('This action requires the admin access code.');

  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(input, { ...init, headers });
  if (response.ok && token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  if (response.status === 401) sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  return response;
}

/** Unlocks the owner-only dashboard for this browser session. */
export function requestAdminAccess(): boolean {
  const token = window.prompt('Enter the Acropin admin access code to open the owner dashboard:')?.trim();
  if (!token) return false;
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  return true;
}
