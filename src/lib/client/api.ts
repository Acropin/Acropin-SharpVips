const ADMIN_TOKEN_KEY = 'acropin-admin-token';

/** Sends write requests with the session's admin token; public GETs need no token. */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return fetch(input, init);

  let token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  if (!token) {
    token = window.prompt('Enter the Acropin admin access code to make this change:')?.trim() || null;
  }
  if (!token) throw new Error('This action requires the admin access code.');

  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(input, { ...init, headers });
  if (response.ok) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  if (response.status === 401) sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  return response;
}
