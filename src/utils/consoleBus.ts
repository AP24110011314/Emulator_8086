// ─── External console-window transport ──────────────────────────────────────
// The emulator core stays in the main window. Console text is forwarded to a
// genuinely separate OS window (Tauri WebviewWindow, or a window.open() popup
// in a plain browser) via an event bus — never by touching another window's
// DOM from the emulator code.
//
// Two transports, same message shape:
//  - Tauri:   emit()/listen() from @tauri-apps/api/event  (decoupled windows)
//  - Browser: BroadcastChannel('emulator8086-console') between the main page
//             and the popup (which loads this same app with ?window=console)

export const CONSOLE_WINDOW_LABEL = 'emulator-console';
export const CONSOLE_WINDOW_PARAM = 'window';
export const CONSOLE_WINDOW_VALUE = 'console';

/** URL of the console window (same app, console route). Lazy so Node imports never touch `window`. */
export function getConsoleUrl(): string {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  return `${path}?${CONSOLE_WINDOW_PARAM}=${CONSOLE_WINDOW_VALUE}`;
}

export const CONSOLE_EVENT_APPEND = 'emulator-console-append';
export const CONSOLE_EVENT_SYNC = 'emulator-console-sync';
export const CONSOLE_EVENT_CLEAR = 'emulator-console-clear';
export const CONSOLE_EVENT_REQUEST_SYNC = 'emulator-console-request-sync';
export const CONSOLE_EVENT_CLOSED = 'emulator-console-closed';
// Interactive-input channel (console window ⇄ main window):
// main → console announces which keyboard read the CPU is parked on,
// console → main delivers keystrokes typed directly into the console.
export const CONSOLE_EVENT_INPUT_MODE = 'emulator-console-input-mode';
export const CONSOLE_EVENT_INPUT_DATA = 'emulator-console-input-data';
export const CONSOLE_EVENT_REQUEST_INPUT_MODE = 'emulator-console-request-input-mode';

const BC_NAME = 'emulator8086-console';

export type ConsoleBusMessage =
  // `seq` is a per-sender monotonic counter. The console window applies only
  // messages newer than the last one seen, so duplicate delivery (dual
  // transports, re-subscription, StrictMode remounts) can never duplicate
  // output like "0112233...". Stamped by consoleBroadcast; request-sync and
  // closed carry no ordering meaning.
  | { type: 'append'; chunk: string; seq?: number }
  | { type: 'sync'; full: string; seq?: number }
  | { type: 'clear'; seq?: number }
  | { type: 'request-sync' }
  | { type: 'closed' }
  // Main → console: which blocking keyboard read the CPU is parked on
  // (null = not waiting). `max` is the DOS max-length byte for AH=0Ah
  // line input. Last-writer-wins state snapshot — carries no seq.
  | { type: 'input-mode'; mode: 'char' | 'line' | null; max?: number }
  // Console → main: keystrokes typed directly into the console window.
  // Char mode sends one character per message; line mode sends the whole
  // submitted line with a trailing '\r' terminator on Enter.
  // `id` is stamped by consoleBroadcast so the main window can drop the
  // second copy that arrives over the dual transports (Tauri event +
  // BroadcastChannel) — without it every keystroke would queue twice.
  | { type: 'input-data'; text: string; id?: string }
  // Console → main: "what input are you waiting for?" (asked on open, so
  // a console opened mid-wait learns the current mode immediately).
  | { type: 'request-input-mode' };

/** Monotonic counter stamped onto every ordered message by consoleBroadcast. */
let consoleSeq = 0;

/** Pure view-state reducer for the console window — unit-tested in Node. */
export interface ConsoleViewState {
  text: string;
  lastSeq: number;
}

export const EMPTY_CONSOLE_VIEW: ConsoleViewState = { text: '', lastSeq: 0 };

export function applyConsoleMessage(state: ConsoleViewState, msg: ConsoleBusMessage): ConsoleViewState {
  switch (msg.type) {
    case 'append': {
      const seq = msg.seq ?? 0;
      if (seq <= state.lastSeq) return state;
      return { text: state.text + msg.chunk, lastSeq: seq };
    }
    case 'sync': {
      const seq = msg.seq ?? 0;
      if (seq < state.lastSeq) return state;
      return { text: msg.full, lastSeq: seq };
    }
    case 'clear': {
      const seq = msg.seq ?? 0;
      if (seq < state.lastSeq) return state;
      return { text: '', lastSeq: seq };
    }
    default:
      return state;
  }
}

function eventToMessage(event: string, payload?: unknown): ConsoleBusMessage | null {
  if (event === CONSOLE_EVENT_APPEND) {
    const p = payload as { chunk: string; seq: number } | undefined;
    return { type: 'append', chunk: p?.chunk ?? '', seq: p?.seq ?? 0 };
  }
  if (event === CONSOLE_EVENT_SYNC) {
    const p = payload as { full: string; seq: number } | undefined;
    return { type: 'sync', full: p?.full ?? '', seq: p?.seq ?? 0 };
  }
  if (event === CONSOLE_EVENT_CLEAR) {
    const p = payload as { seq: number } | undefined;
    return { type: 'clear', seq: p?.seq ?? 0 };
  }
  if (event === CONSOLE_EVENT_REQUEST_SYNC) return { type: 'request-sync' };
  if (event === CONSOLE_EVENT_CLOSED) return { type: 'closed' };
  if (event === CONSOLE_EVENT_INPUT_MODE) {
    const p = payload as { mode: 'char' | 'line' | null; max?: number } | undefined;
    return { type: 'input-mode', mode: p?.mode ?? null, max: p?.max };
  }
  if (event === CONSOLE_EVENT_INPUT_DATA) {
    const p = payload as { text: string; id?: string } | undefined;
    return { type: 'input-data', text: p?.text ?? '', id: p?.id };
  }
  if (event === CONSOLE_EVENT_REQUEST_INPUT_MODE) return { type: 'request-input-mode' };
  return null;
}

function messageToEvent(msg: ConsoleBusMessage): { event: string; payload: unknown } {
  switch (msg.type) {
    case 'append': return { event: CONSOLE_EVENT_APPEND, payload: { chunk: msg.chunk, seq: msg.seq } };
    case 'sync': return { event: CONSOLE_EVENT_SYNC, payload: { full: msg.full, seq: msg.seq } };
    case 'clear': return { event: CONSOLE_EVENT_CLEAR, payload: { seq: msg.seq } };
    case 'request-sync': return { event: CONSOLE_EVENT_REQUEST_SYNC, payload: {} };
    case 'closed': return { event: CONSOLE_EVENT_CLOSED, payload: {} };
    case 'input-mode': return { event: CONSOLE_EVENT_INPUT_MODE, payload: { mode: msg.mode, max: msg.max } };
    case 'input-data': return { event: CONSOLE_EVENT_INPUT_DATA, payload: { text: msg.text, id: msg.id } };
    case 'request-input-mode': return { event: CONSOLE_EVENT_REQUEST_INPUT_MODE, payload: {} };
  }
}

/** True when running inside a Tauri window (v2 exposes __TAURI_INTERNALS__). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** True when this page IS the console window (loaded with ?window=console). */
export function isConsoleWindow(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get(CONSOLE_WINDOW_PARAM) === CONSOLE_WINDOW_VALUE;
  } catch {
    return false;
  }
}

/**
 * Async version that also recognises the Tauri console window by its window
 * label — no URL query involved, so it works with the pre-declared
 * `emulator-console` window (plain `index.html`) in production builds.
 * `getCurrentWindow()` reads local webview metadata: synchronous, no IPC,
 * no extra capability needed.
 */
export async function isCurrentWindowConsole(): Promise<boolean> {
  if (isConsoleWindow()) return true;
  if (!isTauri()) return false;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return getCurrentWindow().label === CONSOLE_WINDOW_LABEL;
  } catch {
    return false;
  }
}

// ── Emit: main window → console window ───────────────────────────────────────

let tauriEmitCache: ((event: string, payload?: unknown) => Promise<void>) | null = null;
let tauriEmitFailed = false;

async function tauriEmit(event: string, payload?: unknown): Promise<void> {
  if (tauriEmitFailed) return;
  try {
    if (!tauriEmitCache) {
      const mod = await import('@tauri-apps/api/event');
      tauriEmitCache = mod.emit;
    }
    await tauriEmitCache(event, payload);
  } catch {
    // Not in Tauri (plain browser / tests): BroadcastChannel below covers it.
    tauriEmitFailed = true;
  }
}

let bcSender: BroadcastChannel | null = null;

function bcSend(msg: ConsoleBusMessage): void {
  try {
    if (typeof BroadcastChannel === 'undefined') return;
    if (!bcSender) bcSender = new BroadcastChannel(BC_NAME);
    bcSender.postMessage(msg);
  } catch {
    // BroadcastChannel unavailable (very old browser): popup fallback writes
    // directly via its document (see ensureBrowserPopup below).
    bcSender = null;
  }
}

/** Forward a console message on every available transport. Fire-and-forget. */
export function consoleBroadcast(msg: ConsoleBusMessage): void {
  // Stamp ordered messages so the console window can drop duplicates that
  // arrive twice (Tauri event + BroadcastChannel, or a leaked subscription
  // from a StrictMode remount). request-sync/closed are unstamped signals.
  if (msg.type === 'append' || msg.type === 'sync' || msg.type === 'clear') {
    (msg as { seq: number }).seq = ++consoleSeq;
  }
  // Console keystrokes get a unique id (not a per-sender counter: several
  // console windows may be open, so ids must be unique across senders) so
  // the main window queues each keystroke exactly once.
  if (msg.type === 'input-data' && !msg.id) {
    msg.id = `${++consoleSeq}-${Math.random().toString(36).slice(2)}`;
  }
  const { event, payload } = messageToEvent(msg);
  void tauriEmit(event, payload);
  bcSend(msg);
}

// ── Listen: console window side (subscribes to both transports) ─────────────

/** Subscribe to console messages. Returns an unsubscribe function. */
export function subscribeConsoleMessages(handler: (msg: ConsoleBusMessage) => void): () => void {
  const cleanups: Array<() => void> = [];
  // Set synchronously on unsubscribe so a late-resolving Tauri import (e.g.
  // after a StrictMode remount unmounted us first) never leaves live
  // listeners behind — those duplicates each re-applied every append.
  let unsubscribed = false;

  // 1) Tauri events
  (async () => {
    try {
      const mod = await import('@tauri-apps/api/event');
      if (unsubscribed) return;
      const unlisteners = await Promise.all([
        mod.listen<{ chunk: string; seq: number }>(CONSOLE_EVENT_APPEND, e => handler({ type: 'append', chunk: e.payload.chunk, seq: e.payload.seq ?? 0 })),
        mod.listen<{ full: string; seq: number }>(CONSOLE_EVENT_SYNC, e => handler({ type: 'sync', full: e.payload.full, seq: e.payload.seq ?? 0 })),
        mod.listen<{ seq: number }>(CONSOLE_EVENT_CLEAR, e => handler({ type: 'clear', seq: (e.payload as { seq: number } | undefined)?.seq ?? 0 })),
        mod.listen(CONSOLE_EVENT_REQUEST_SYNC, () => handler({ type: 'request-sync' })),
        mod.listen(CONSOLE_EVENT_CLOSED, () => handler({ type: 'closed' })),
        mod.listen<{ mode: 'char' | 'line' | null; max?: number }>(CONSOLE_EVENT_INPUT_MODE, e => handler({ type: 'input-mode', mode: e.payload.mode ?? null, max: e.payload.max })),
        mod.listen<{ text: string; id?: string }>(CONSOLE_EVENT_INPUT_DATA, e => handler({ type: 'input-data', text: e.payload.text ?? '', id: e.payload.id })),
        mod.listen(CONSOLE_EVENT_REQUEST_INPUT_MODE, () => handler({ type: 'request-input-mode' })),
      ]);
      if (unsubscribed) {
        // Unmounted while the import was in flight: tear down immediately.
        unlisteners.forEach(u => u());
        return;
      }
      cleanups.push(() => unlisteners.forEach(u => u()));
    } catch {
      // Not in Tauri — BroadcastChannel below covers the browser case.
    }
  })();

  // 2) BroadcastChannel (browser popup, and also works Tauri-to-Tauri)
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(BC_NAME);
      bc.onmessage = (e: MessageEvent<ConsoleBusMessage>) => {
        if (e.data && typeof e.data === 'object' && 'type' in e.data) handler(e.data);
      };
      cleanups.push(() => bc.close());
    }
  } catch {
    // ignore
  }

  // 3) postMessage fallback: the browser-popup path posts stringified messages
  //    directly when BroadcastChannel is missing.
  const onMessage = (e: MessageEvent) => {
    try {
      const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (data && data.__emulator8086Console && data.msg) handler(data.msg as ConsoleBusMessage);
    } catch {
      // ignore malformed messages
    }
  };
  window.addEventListener('message', onMessage);
  cleanups.push(() => window.removeEventListener('message', onMessage));

  return () => {
    unsubscribed = true;
    cleanups.forEach(fn => fn());
  };
}

// ── Window lifecycle: open/focus the external console window ────────────────

let browserPopupRef: Window | null = null;

function ensureBrowserPopup(): Window | null {
  // Reuse the existing popup if it is still open.
  if (browserPopupRef && !browserPopupRef.closed) {
    browserPopupRef.focus();
    return browserPopupRef;
  }
  try {
    const popup = window.open(getConsoleUrl(), CONSOLE_WINDOW_LABEL, 'width=600,height=440,menubar=no,toolbar=no');
    if (popup) browserPopupRef = popup;
    return popup;
  } catch {
    return null;
  }
}

let tauriOpenInFlight: Promise<unknown> | null = null;

async function ensureTauriWindow(): Promise<boolean> {
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const existing = await WebviewWindow.getByLabel(CONSOLE_WINDOW_LABEL);
    if (existing) {
      await existing.show().catch(() => undefined);
      await existing.setFocus().catch(() => undefined);
      return true;
    }
    if (!tauriOpenInFlight) {
      tauriOpenInFlight = (async () => {
        // Plain index.html: the console route is decided by window label
        // (see isCurrentWindowConsole), so no query string is needed here.
        const win = new WebviewWindow(CONSOLE_WINDOW_LABEL, {
          url: 'index.html',
          title: 'Console Output — 8086 Emulator',
          width: 600,
          height: 440,
          minWidth: 360,
          minHeight: 240,
          resizable: true,
        });
        // Wait for creation, but never hang: a timeout guards against a
        // missed tauri://created, and tauri://error surfaces failures.
        await Promise.race([
          (async () => {
            try {
              const unlisten = await win.once('tauri://created', () => undefined);
              unlisten();
            } catch { /* fall through to timeout/error below */ }
          })(),
          (async () => {
            try {
              const unlisten = await win.once('tauri://error', () => undefined);
              unlisten();
            } catch { /* ignore */ }
          })(),
          new Promise(resolve => setTimeout(resolve, 5000)),
        ]);
        tauriOpenInFlight = null;
      })();
    }
    await tauriOpenInFlight;
    return true;
  } catch {
    tauriOpenInFlight = null;
    return false;
  }
}

export interface ConsoleOpenResult {
  opened: boolean;
  /** 'tauri' | 'popup' | 'none' — which backend handled the request. */
  backend: 'tauri' | 'popup' | 'none';
}

/**
 * Open (or focus) the external console window. Safe to call repeatedly;
 * existing windows are focused, never duplicated. Closing the console window
 * never touches emulator state — it is a pure view onto the broadcast text.
 */
export async function openConsoleWindow(): Promise<ConsoleOpenResult> {
  if (isTauri()) {
    const ok = await ensureTauriWindow();
    return { opened: ok, backend: ok ? 'tauri' : 'none' };
  }
  const popup = ensureBrowserPopup();
  // window.open() returns null when a popup blocker intervenes.
  return popup ? { opened: true, backend: 'popup' } : { opened: false, backend: 'none' };
}

/** Best-effort focus check used for the launcher badge (no state involved). */
export function isBrowserPopupOpen(): boolean {
  return !!browserPopupRef && !browserPopupRef.closed;
}

/**
 * Is the external console window currently open? Real check (no focus
 * side-effects): Tauri label lookup, or the browser popup handle.
 */
export async function isConsoleWindowOpen(): Promise<boolean> {
  if (isTauri()) {
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      return (await WebviewWindow.getByLabel(CONSOLE_WINDOW_LABEL)) !== null;
    } catch {
      return false;
    }
  }
  return isBrowserPopupOpen();
}

/** Forward a message to a raw window.open() popup document when the portable
 *  transports are unavailable (very old browsers without BroadcastChannel).
 *  Modern browsers never reach this path: the popup loads this same app and
 *  receives everything via BroadcastChannel/Tauri events. */
export function legacyPopupWrite(full: string): void {
  const popup = browserPopupRef;
  if (!popup || popup.closed) return;
  try {
    const pre = popup.document?.getElementById('console-fallback-text');
    if (pre) pre.textContent = full;
    else popup.postMessage(JSON.stringify({ __emulator8086Console: true, msg: { type: 'sync', full } }), '*');
  } catch {
    // Cross-origin / closed race — ignore; the popup re-syncs on focus.
  }
}

// ── Interactive line editing (INT 21h AH=0Ah draft buffer) ──────────────────
// Pure keystroke reducer for the console window's not-yet-submitted line.
// Framework-free so it stays unit-testable in Node; the React console calls
// it from onKeyDown and renders `draft` live ahead of the blinking cursor.

/** Outcome of feeding one key into the AH=0Ah draft buffer. */
export type LineEditResult =
  /** Draft changed (typed char or Backspace) — keep editing. */
  | { action: 'append'; draft: string }
  | { action: 'delete'; draft: string }
  /** Enter on a non-empty draft — submit (caller clears the draft). */
  | { action: 'submit'; text: string }
  /** Ignored key (control key, empty submit, or DOS max-length reached). */
  | { action: 'noop'; draft: string };

/**
 * Feed one `KeyboardEvent.key` into the line draft.
 * - Printable single chars append unless `draft.length >= max` (real DOS
 *   stops accepting characters at the buffer's declared max-length byte).
 * - Backspace deletes the last char; Enter submits (non-empty drafts only,
 *   matching the old input box which ignored empty submits — except when
 *   max <= 0, where no character can ever be typed, so Enter submits the
 *   empty line instead of leaving the wait unsatisfiable).
 * - Modified keypresses (Ctrl/Alt/Meta) and other control keys are ignored.
 */
export function applyLineEditKey(
  draft: string,
  key: string,
  max: number,
  modifiers = false,
): LineEditResult {
  if (modifiers) return { action: 'noop', draft };
  if (key === 'Enter') {
    if (draft.length > 0) return { action: 'submit', text: draft };
    return max <= 0 ? { action: 'submit', text: '' } : { action: 'noop', draft };
  }
  if (key === 'Backspace') {
    return draft.length > 0 ? { action: 'delete', draft: draft.slice(0, -1) } : { action: 'noop', draft };
  }
  if (key.length !== 1) return { action: 'noop', draft };
  if (draft.length >= max) return { action: 'noop', draft };
  return { action: 'append', draft: draft + key };
}

/**
 * Clamp a pasted block to the remaining DOS max-length budget (line mode).
 * Returns the text to insert (possibly '').
 */
export function clampLineEditPaste(draft: string, pasted: string, max: number): string {
  const room = Math.max(0, max - draft.length);
  return pasted.replace(/[\r\n]+/g, ' ').slice(0, room);
}

export { eventToMessage };
