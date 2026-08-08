/**
 * A small back stack shared by the Android hardware/gesture back button and
 * the Escape key.
 *
 * Views push a handler while they are on screen; the topmost handler that
 * returns `true` consumes the press. When nothing consumes it the app exits,
 * which is what Android users expect from the home screen of an app.
 */

const handlers = [];

/**
 * Register a handler. Return `true` from it when it handled the press.
 * @param {() => boolean} handler
 * @returns {() => void} unregister
 */
export function pushBackHandler(handler) {
  handlers.push(handler);
  return () => {
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}

/** Run the stack from the top. @returns {boolean} whether it was handled */
export function runBack() {
  for (let index = handlers.length - 1; index >= 0; index--) {
    try {
      if (handlers[index]()) return true;
    } catch (error) {
      console.warn('[maktabate] back handler failed', error);
    }
  }
  return false;
}

/** Wire the Android back button (no-op in a plain browser). */
export async function installBackButton() {
  try {
    const { App } = await import('@capacitor/app');
    await App.addListener('backButton', () => {
      if (!runBack()) App.exitApp();
    });
  } catch {
    /* not running inside Capacitor — the Escape key covers the browser */
  }
}
