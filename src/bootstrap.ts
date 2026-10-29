const CACHE_REFRESH_PARAMETER = '__acropin_cache_refresh';
let startupFinished = false;
let startupTimer = 0;

function markStartupComplete(): void {
  startupFinished = true;
  window.clearTimeout(startupTimer);
}

function showStartupFailure(error: unknown): void {
  if (startupFinished) return;
  startupFinished = true;
  window.clearTimeout(startupTimer);
  console.error('Acropin failed to start:', error);

  const root = document.getElementById('root');
  if (!root) return;

  const main = document.createElement('main');
  main.setAttribute('role', 'alert');
  main.style.cssText = 'min-height:100vh;display:grid;place-items:center;background:#020617;color:#f8fafc;font:16px system-ui,sans-serif;padding:24px';

  const section = document.createElement('section');
  section.style.cssText = 'max-width:28rem;text-align:center';

  const title = document.createElement('h1');
  title.textContent = 'Acropin could not start';
  title.style.cssText = 'font-size:1.25rem;font-weight:700';

  const message = document.createElement('p');
  message.textContent = 'The app did not finish loading. Reload the page to try again.';
  message.style.cssText = 'margin-top:.75rem;color:#cbd5e1';

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Reload page';
  retry.style.cssText = 'margin-top:1.25rem;border-radius:.5rem;background:#059669;color:white;padding:.65rem 1rem;font-weight:600;cursor:pointer';
  retry.addEventListener('click', () => window.location.reload());

  section.append(title, message, retry);
  main.append(section);
  root.replaceChildren(main);
}

window.addEventListener('acropin-app-started', markStartupComplete, { once: true });
startupTimer = window.setTimeout(() => showStartupFailure(new Error('App startup timed out.')), 15_000);

async function removeLegacyServiceWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  const url = new URL(window.location.href);
  const alreadyRefreshed = url.searchParams.get(CACHE_REFRESH_PARAMETER) === '1';

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const hadLegacyWorker = registrations.length > 0 || Boolean(navigator.serviceWorker.controller);
    await Promise.allSettled(registrations.map((registration) => registration.unregister()));

    // One reload releases a legacy worker that may still control this tab.
    // The query guard prevents a reload loop if a browser keeps reporting it.
    if (hadLegacyWorker && !alreadyRefreshed) {
      url.searchParams.set(CACHE_REFRESH_PARAMETER, '1');
      window.location.replace(url.toString());
      return;
    }

    if (alreadyRefreshed) {
      url.searchParams.delete(CACHE_REFRESH_PARAMETER);
      window.history.replaceState(null, '', url.toString());
    }
  } catch (error) {
    console.warn('Could not remove an old Acropin service worker; continuing with the app.', error);
  }
}

// Start React immediately. Service Worker APIs can be slow or hang in some
// browsers, so stale-worker cleanup must never block the application bundle.
void import('./main.tsx').catch(showStartupFailure);
void removeLegacyServiceWorkers().catch((error: unknown) => {
  console.warn('Could not check for an old Acropin service worker.', error);
});
