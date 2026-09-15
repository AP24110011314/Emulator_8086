import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyConsoleMessage,
  applyLineEditKey,
  clampLineEditPaste,
  consoleBroadcast,
  EMPTY_CONSOLE_VIEW,
  subscribeConsoleMessages,
} from '../utils/consoleBus';

/** Which blocking keyboard read the main window's CPU is parked on (if any). */
interface ConsoleInputMode {
  mode: 'char' | 'line';
  max: number;
}

/**
 * Standalone console window. Rendered INSTEAD of App when the page is loaded
 * with ?window=console (both the Tauri WebviewWindow and the browser popup
 * load this same app at that URL). It owns no emulator state — committed
 * output is a pure view onto the text broadcast by the main window — but it
 * IS the terminal keyboard: when the main window announces it is parked on
 * a blocking INT 21h / INT 16h read, keystrokes typed here are sent back
 * over the bus and queued as the program's stdin. Closing the window never
 * affects the running CPU; reopening re-syncs the full output on mount.
 */
export function ConsoleWindow() {
  const [view, setView] = useState(EMPTY_CONSOLE_VIEW);
  const output = view.text;
  const [connected, setConnected] = useState(false);
  // Pending keyboard read announced by the main window (null = not waiting).
  const [inputMode, setInputMode] = useState<ConsoleInputMode | null>(null);
  // Not-yet-submitted AH=0Ah line (local preview ahead of the cursor).
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Read by the key handler so auto-repeat / focus timing can't act stale.
  // (Updated post-commit; key/paste events always fire after a commit.)
  const inputModeRef = useRef<ConsoleInputMode | null>(null);
  useEffect(() => {
    inputModeRef.current = inputMode;
  });

  useEffect(() => {
    // Ask the main window for the full current output (covers reopen mid-run)
    // and for the current input mode (covers opening mid-wait).
    consoleBroadcast({ type: 'request-sync' });
    consoleBroadcast({ type: 'request-input-mode' });
    const timer = setTimeout(() => setConnected(true), 300);
    const unsubscribe = subscribeConsoleMessages(msg => {
      setConnected(true);
      switch (msg.type) {
        case 'append':
        case 'sync':
        case 'clear':
          // Ordered + deduped: a message delivered twice (dual transports,
          // re-subscription) is applied exactly once.
          setView(prev => applyConsoleMessage(prev, msg));
          if (msg.type === 'clear') setDraft('');
          break;
        case 'input-mode': {
          // Fresh wait announcement (or wait over). A changed wait clears
          // any half-typed line from the previous read; repeat announcements
          // of the same wait are ignored (no caret jump, no re-render).
          const next = msg.mode === null ? null : { mode: msg.mode, max: msg.max ?? 0 };
          const prev = inputModeRef.current;
          if ((prev?.mode ?? null) !== (next?.mode ?? null) || (prev?.max ?? 0) !== (next?.max ?? 0)) {
            setDraft('');
            setInputMode(next);
          }
          break;
        }
        case 'request-sync':
          // A second console window asking — only the main window answers,
          // so ignore here to avoid echo storms.
          break;
        case 'input-data':
        case 'request-input-mode':
        case 'closed':
          // Addressed to the main window (or level signals) — ignore here.
          break;
      }
    });

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [output, draft, inputMode]);

  // When the emulator starts waiting, move keyboard focus here so the user
  // can type immediately (focus inside this window only — never steals the
  // OS window from the main app).
  useEffect(() => {
    if (inputMode) bodyRef.current?.focus();
  }, [inputMode]);

  const sendInput = useCallback((text: string) => {
    if (!text) return;
    consoleBroadcast({ type: 'input-data', text });
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const waiting = inputModeRef.current;
    if (!waiting) return; // read-only unless the emulator asked for input
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (waiting.mode === 'char') {
      // Single-character reads (AH=01H/08H, INT 16h AH=00h): the very next
      // keypress is consumed immediately. Enter arrives as DOS carriage
      // return; anything else printable goes over verbatim.
      if (e.key === 'Enter') {
        e.preventDefault();
        sendInput('\r');
      } else if (e.key.length === 1) {
        e.preventDefault();
        sendInput(e.key);
      }
      return;
    }
    // Buffered line reads (AH=0Ah): edit locally with a live preview,
    // Backspace-correctable, Enter submits — with the DOS max-length byte
    // capping accepted characters exactly like the old input box did.
    // (Computed from state, not inside a setState updater: updaters must be
    // pure — StrictMode double-invokes them, which would submit Enter twice.)
    const res = applyLineEditKey(draft, e.key, waiting.max, false);
    switch (res.action) {
      case 'append':
      case 'delete':
        e.preventDefault();
        setDraft(res.draft);
        break;
      case 'submit':
        e.preventDefault();
        setDraft('');
        sendInput(res.text + '\r');
        break;
      default:
        if (e.key === 'Enter' || e.key === 'Backspace' || e.key === ' ') e.preventDefault();
        break;
    }
  }, [sendInput, draft]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const waiting = inputModeRef.current;
    if (!waiting || e.clipboardData == null) return;
    const text = e.clipboardData.getData('text');
    if (!text) return;
    e.preventDefault();
    if (waiting.mode === 'char') {
      // Queue the whole paste; the first char satisfies the pending read
      // and the rest wait for subsequent reads (same as the old input box).
      sendInput(text);
    } else {
      setDraft(prev => prev + clampLineEditPaste(prev, text, waiting.max));
    }
  }, [sendInput]);

  const waitingHint =
    inputMode?.mode === 'line'
      ? `⌨ typing input (max ${inputMode.max} chars) — Backspace corrects, Enter submits`
      : inputMode?.mode === 'char'
        ? '⌨ press any key — it is read immediately'
        : null;

  return (
    <div className="console-window">
      <header className="console-window-header">
        <span className="console-window-title">
          <span className="logo-chip">8086</span> Console Output
        </span>
        <span className={`console-window-live ${connected ? 'on' : ''}`}>
          {connected ? '● live' : '○ waiting for emulator…'}
        </span>
      </header>
      <div
        className={`console-window-body${inputMode ? ' awaiting-input' : ''}`}
        id="output-console"
        ref={bodyRef}
        tabIndex={0}
        role="textbox"
        aria-label={inputMode ? 'Emulator console — type input here' : 'Emulator console output (read-only)'}
        aria-readonly={!inputMode}
        title={inputMode ? 'Type here — the program is waiting for keyboard input' : 'Program output (click here and type when input is requested)'}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
      >
        {output ? (
          <span className="output-text">{output}</span>
        ) : (
          <span className="output-placeholder">Waiting for INT 21h output…</span>
        )}
        {inputMode && output && (
          <span className="output-text" aria-hidden="true">{draft}</span>
        )}
        {inputMode && !output && (
          <span className="output-text" aria-hidden="true">{draft || '\u00a0'}</span>
        )}
        {inputMode && <span className="output-cursor" aria-hidden="true" />}
        <div ref={bottomRef} />
      </div>
      <footer className="console-window-footer">
        <span>{waitingHint ?? `${output.length} chars`}</span>
        <button className="clear-btn" onClick={() => setView(prev => ({ ...prev, text: '' }))} title="Clear this view (emulator keeps running)">
          Clear view
        </button>
      </footer>
    </div>
  );
}
