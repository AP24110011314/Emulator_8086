// INT 21h handler simulation for the 8086 emulator
// Simulates common DOS interrupt services for educational purposes.

import type { CPU } from './cpu';

// ─── Console I/O callback types ───────────────────────────────────────────────

export interface InterruptIO {
  /** Called when INT 21h outputs a character */
  writeChar: (ch: string) => void;
  /** Called when INT 21h needs to read a character (returns char or null if none pending) */
  readChar: () => string | null;
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
      // Read character from stdin (with echo) → AL
      const ch = io.readChar();
      if (ch !== null) {
        cpu.writeRegister8('AL', ch.charCodeAt(0));
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
      // Buffered keyboard input — simplified (not supported without real input)
      return false;
    }

    case 0x0B: {
      // Check stdin status: AL=0xFF if ready, 0x00 if not
      const ch = io.readChar();
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
        // Other vectors: no-op
        break;
    }
  };
}
