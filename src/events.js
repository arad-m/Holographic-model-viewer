// src/events.js
// Owns: the tiny pub/sub bus that lets modules react to each other without
// importing one another. No DOM access, no Three.js, no state mutation here.
//
// Channel names are plain strings. Two conventions are used by the app:
//   - 'state:changed' with payload { keys: string[] }  (emitted by state.js)
//   - 'domain:event'   for everything later phases add (e.g. 'model:loaded',
//                      'camera:error', 'settings:changed').

/**
 * @typedef {(payload: any) => void} EmitterListener
 */

/**
 * Creates an isolated emitter. The app uses the shared singleton below; tests
 * or isolated subsystems can create their own.
 * @returns {{
 *   on: (eventName: string, listener: EmitterListener) => () => boolean,
 *   off: (eventName: string, listener: EmitterListener) => boolean,
 *   emit: (eventName: string, payload?: any) => number,
 *   clear: (eventName?: string) => void,
 *   listenerCount: (eventName: string) => number,
 * }}
 */
export function createEmitter() {
  /** @type {Map<string, Set<EmitterListener>>} */
  const listenersByEvent = new Map();

  /** Subscribe. Returns an unsubscribe function. */
  function on(eventName, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError(`events.on("${eventName}"): listener must be a function`);
    }
    let listeners = listenersByEvent.get(eventName);
    if (!listeners) {
      listeners = new Set();
      listenersByEvent.set(eventName, listeners);
    }
    listeners.add(listener);
    return () => off(eventName, listener);
  }

  /** Unsubscribe a single listener. Returns true if it was registered. */
  function off(eventName, listener) {
    const listeners = listenersByEvent.get(eventName);
    if (!listeners) return false;
    const removed = listeners.delete(listener);
    if (listeners.size === 0) listenersByEvent.delete(eventName);
    return removed;
  }

  /**
   * Notify every listener for the channel. Iterates over a snapshot so a
   * listener may unsubscribe during dispatch. Returns the number notified.
   * A throwing listener is reported and does not stop the others.
   */
  function emit(eventName, payload) {
    const listeners = listenersByEvent.get(eventName);
    if (!listeners || listeners.size === 0) return 0;
    const snapshot = Array.from(listeners);
    for (const listener of snapshot) {
      try {
        listener(payload);
      } catch (error) {
        console.error(`Error in "${eventName}" listener:`, error);
      }
    }
    return snapshot.length;
  }

  /** Remove listeners for one channel, or every channel when omitted. */
  function clear(eventName) {
    if (eventName === undefined) {
      listenersByEvent.clear();
      return;
    }
    listenersByEvent.delete(eventName);
  }

  function listenerCount(eventName) {
    return listenersByEvent.get(eventName)?.size ?? 0;
  }

  return { on, off, emit, clear, listenerCount };
}

/** The shared application bus. */
export const events = createEmitter();
