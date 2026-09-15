// INT 21h handler simulation for the 8086 emulator
// Simulates common DOS interrupt services for educational purposes.

import type { CPU } from './cpu';

// ─── Console I/O callback types ───────────────────────────────────────────────

export interface InterruptIO {
  /** Called when INT 21h outputs a character */
  writeChar: (ch: string) => void;
  /** Called when INT 21h needs to read a character (returns char or null if none pending) */
  readChar: () => string | null;
  /**
   * Buffered line input for INT 21h AH=0Ah. Called with the DOS max-length
   * from DS:DX; returns the submitted string (without the Enter terminator)
   * or null if no line is available. Hosts without this fall back to
   * consuming single chars via readChar.
   */
  readLine?: (maxChars: number) => string | null;
  /**
   * Non-destructive peek at the next pending character, if the host supports
   * it. Status checks (INT 21h AH=0Bh, INT 16h AH=01h) must NOT consume input —
   * without this they eat the keystroke the program is about to read.
   * Hosts without peek fall back to readChar (legacy behavior).
   */
  peekChar?: () => string | null;
}

/** Status-check read: peek when the host supports it, consume otherwise. */
function peekInput(io: InterruptIO): string | null {
  return io.peekChar ? io.peekChar() : io.readChar();
}

// ─── INT 21h service handler ──────────────────────────────────────────────────

/**
 * Handles INT 21h (DOS services).
 * Returns true if the program should halt (AH=4Ch).
 */
export function handleInt21h(cpu: CPU, io: InterruptIO): boolean {
  const ah = cpu.readRegister8('AH');

  switch (ah) {
    case 0x01: {
      // Read character from stdin → AL, echoing it like real DOS (programs
      // that want no echo use AH=08h instead). The echo lands in the console
      // at the cursor position, same as the AH=0Ah line echo below.
      const ch = io.readChar();
      if (ch !== null) {
        cpu.writeRegister8('AL', ch.charCodeAt(0));
        io.writeChar(ch);
      } else {
        cpu.writeRegister8('AL', 0);
      }
      return false;
    }

    case 0x02: {
      // Write character in DL to stdout
      const dl = cpu.readRegister8('DL');
      io.writeChar(String.fromCharCode(dl));
      return false;
    }

    case 0x06: {
      // Direct console I/O
      const dl = cpu.readRegister8('DL');
      if (dl === 0xFF) {
        // Read character (no wait)
        const ch = io.readChar();
        if (ch !== null) {
          cpu.writeRegister8('AL', ch.charCodeAt(0));
          cpu.setFlag('ZF', false);
        } else {
          cpu.writeRegister8('AL', 0);
          cpu.setFlag('ZF', true);
        }
      } else {
        // Write character
        io.writeChar(String.fromCharCode(dl));
      }
      return false;
    }

    case 0x08: {
      // Read character from stdin (no echo) → AL
      const ch = io.readChar();
      if (ch !== null) {
        cpu.writeRegister8('AL', ch.charCodeAt(0));
      } else {
        cpu.writeRegister8('AL', 0);
      }
      return false;
    }

    case 0x09: {
      // Write '$'-terminated string at DS:DX
      const ds = cpu.readRegister16('DS');
      let dx = cpu.readRegister16('DX');
      let output = '';
      for (let i = 0; i < 4096; i++) {
        const byte = cpu.readPhysical8(((ds << 4) + dx + i) & 0xFFFFF);
        if (byte === 0x24) break; // '$'
        output += String.fromCharCode(byte);
      }
      for (const ch of output) io.writeChar(ch);
      return false;
    }

    case 0x0A: {
      // Buffered keyboard input — DS:DX points to a DOS input buffer:
      //   [max_chars, chars_read, chars...]
      // Reads a full line (up to max_chars), stores the actual count at
      // DX+1 and the raw characters at DX+2. Bytes past the count are
      // deliberately left untouched — programs pre-fill them (e.g. with
      // '$' so a later AH=09h print terminates correctly).
      const ds = cpu.readRegister16('DS');
      const dx = cpu.readRegister16('DX');
      const bufPhys = ((ds << 4) + dx) & 0xFFFFF;
      const maxChars = cpu.readPhysical8(bufPhys);
      let line: string | null;
      if (io.readLine) {
        line = io.readLine(maxChars);
      } else {
        // Legacy hosts only supply single chars: consume up to maxChars,
        // stopping at Enter/end of queue.
        let s = '';
        for (let i = 0; i < maxChars; i++) {
          const ch = io.readChar();
          if (ch === null || ch === '\r' || ch === '\n') break;
          s += ch;
        }
        line = s.length > 0 ? s : null;
      }
      if (line !== null) {
        const text = line.slice(0, maxChars);
        cpu.writePhysical8((bufPhys + 1) & 0xFFFFF, text.length);
        for (let i = 0; i < text.length; i++) {
          cpu.writePhysical8((bufPhys + 2 + i) & 0xFFFFF, text.charCodeAt(i) & 0xFF);
        }
        // Real DOS echoes the line as typed.
        for (const ch of text) io.writeChar(ch);
      } else {
        cpu.writePhysical8((bufPhys + 1) & 0xFFFFF, 0);
      }
      return false;
    }

    case 0x0B: {
      // Check stdin status: AL=0xFF if ready, 0x00 if not (must not consume)
      const ch = peekInput(io);
      cpu.writeRegister8('AL', ch !== null ? 0xFF : 0x00);
      return false;
    }

    case 0x0C: {
      // Clear keyboard buffer and invoke sub-function in AL
      // Simplified: just return
      return false;
    }

    case 0x25: {
      // Set interrupt vector — no-op in our simulation
      return false;
    }

    case 0x35: {
      // Get interrupt vector — return 0
      cpu.writeRegister('BX', 0);
      cpu.writeRegister('ES', 0);
      return false;
    }

    case 0x39: {
      // Create subdirectory — not supported
      cpu.setFlag('CF', true);
      cpu.writeRegister('AX', 0x05);
      return false;
    }

    case 0x3C: {
      // Create file — not supported
      cpu.setFlag('CF', true);
      cpu.writeRegister('AX', 0x05);
      return false;
    }

    case 0x40: {
      // Write to file handle (BX=1 → stdout, BX=2 → stderr)
      const bx = cpu.readRegister16('BX');
      if (bx === 1 || bx === 2) {
        const ds = cpu.readRegister16('DS');
        const dx = cpu.readRegister16('DX');
        const cx = cpu.readRegister16('CX');
        for (let i = 0; i < cx; i++) {
          const byte = cpu.readPhysical8(((ds << 4) + dx + i) & 0xFFFFF);
          io.writeChar(String.fromCharCode(byte));
        }
        cpu.writeRegister('AX', cx);
        cpu.setFlag('CF', false);
      }
      return false;
    }

    case 0x4C: {
      // Exit program — halt the CPU
      return true; // signal HLT
    }

    default:
      // Unknown service — silently ignore
      return false;
  }
}

/**
 * Creates the interrupt handler function to attach to the CPU.
 * Supports INT 20h (terminate) and INT 21h (DOS services).
 */
export function createInterruptHandler(io: InterruptIO) {
  return (cpu: CPU, vector: number) => {
    switch (vector) {
      case 0x20:
        // INT 20h: terminate program
        cpu.writeRegister('FLAGS', cpu.readRegister16('FLAGS'));
        // Halt by setting halted flag via HLT
        cpu.execute({ mnemonic: 'HLT', operands: [], bytes: [0xF4] });
        break;

      case 0x21: {
        const shouldHalt = handleInt21h(cpu, io);
        if (shouldHalt) {
          cpu.execute({ mnemonic: 'HLT', operands: [], bytes: [0xF4] });
        }
        break;
      }

      default:
        // Handle INT 16h (BIOS keyboard services)
        if (vector === 0x16) {
          const ah = cpu.readRegister8('AH');
          switch (ah) {
            case 0x00: { // Read keystroke
              const ch = io.readChar();
              if (ch !== null) {
                cpu.writeRegister8('AL', ch.charCodeAt(0));
                cpu.setFlag('ZF', false);
              } else {
                cpu.writeRegister8('AL', 0);
                cpu.setFlag('ZF', true);
              }
              break;
            }
            case 0x01: { // Check keystroke status (must not consume)
              const ch = peekInput(io);
              cpu.setFlag('ZF', ch === null);
              cpu.writeRegister8('AL', ch !== null ? ch.charCodeAt(0) : 0);
              break;
            }
            default:
              break;
          }
          break;
        }
        // Other vectors: no-op
        break;
    }
  };
}
