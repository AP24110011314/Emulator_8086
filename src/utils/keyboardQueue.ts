// ─── Queued stdin for INT 21h / INT 16h ───────────────────────────────────────
// The keystroke queue behind the emulator's keyboard input. Keystrokes typed
// into the console window (or the old sidebar box) are pushed here; the
// interrupt handler consumes them via peekChar/readChar/readLine.
//
// Framework-free so it stays unit-testable in Node. The App holds one
// instance in a ref and hands its methods to createInterruptHandler.

export interface KeyboardQueue {
  /** Append typed text (split into individual characters). */
  push(text: string): void;
  /** Non-destructive peek at the next pending character (status checks). */
  peekChar(): string | null;
  /** Consume and return the next pending character, or null when empty. */
  readChar(): string | null;
  /**
   * Consume a submitted line (up to maxChars), swallowing one Enter
   * terminator. Returns null when nothing is queued; anything beyond
   * maxChars stays queued for the next read.
   */
  readLine(maxChars: number): string | null;
  /** Number of queued character chunks. */
  readonly length: number;
  /** Drop everything (assemble/reset). */
  clear(): void;
}

export function createKeyboardQueue(): KeyboardQueue {
  let chars: string[] = [];
  return {
    push(text: string) {
      if (text) chars = [...chars, ...text.split('')];
    },
    peekChar() {
      const head = chars[0];
      return head && head.length > 0 ? head[0] : null;
    },
    readChar() {
      if (chars.length === 0) return null;
      const head = chars[0];
      if (head.length > 1) {
        // Multi-char entry (e.g. pasted text): consume one char,
        // keep the remainder queued.
        chars = [head.slice(1), ...chars.slice(1)];
        return head[0];
      }
      chars = chars.slice(1);
      return head;
    },
    readLine(maxChars: number) {
      const flat = chars.join('');
      if (flat.length === 0) return null;
      const term = flat.search(/[\r\n]/);
      const textEnd = term === -1 ? flat.length : term;
      const line = flat.slice(0, textEnd).slice(0, maxChars);
      let consumed = line.length;
      if (textEnd <= maxChars && term !== -1) {
        consumed += flat[term] === '\r' && flat[term + 1] === '\n' ? 2 : 1;
      }
      chars = flat.slice(consumed).split('');
      return line;
    },
    get length() {
      return chars.length;
    },
    clear() {
      chars = [];
    },
  };
}
