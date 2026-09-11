// Types for the 8086 CPU emulator

// Register names
export type GPRegister = 'AX' | 'BX' | 'CX' | 'DX';
export type HalfRegister = 'AH' | 'AL' | 'BH' | 'BL' | 'CH' | 'CL' | 'DH' | 'DL';
export type PointerRegister = 'SP' | 'BP';
export type IndexRegister = 'SI' | 'DI';
export type SegmentRegister = 'CS' | 'DS' | 'ES' | 'SS';

// Individual flag bits
export type FlagName =
  | 'CF'  // Carry Flag
  | 'PF'  // Parity Flag
  | 'AF'  // Auxiliary Carry Flag
  | 'ZF'  // Zero Flag
  | 'SF'  // Sign Flag
  | 'TF'  // Trap Flag
  | 'IF'  // Interrupt Enable Flag
  | 'DF'  // Direction Flag
  | 'OF'  // Overflow Flag;

// FLAGS register bit positions
export const FLAG_BITS: Record<FlagName, number> = {
  CF: 0,
  PF: 2,
  AF: 4,
  ZF: 6,
  SF: 7,
  TF: 8,
  IF: 9,
  DF: 10,
  OF: 11
};

// Operand types for decoded instructions
export interface Operand {
  type: 'register' | 'memory' | 'immediate';
  value?: number;
  segment?: SegmentRegister;
  offset?: number;
  register?: GPRegister | HalfRegister | PointerRegister | IndexRegister;
  /** Explicit operand size override from BYTE PTR / WORD PTR */
  size?: 8 | 16;
  /** Base register for complex addressing: BX+SI, BP+DI, etc. */
  base?: string;
  /** Index register for complex addressing */
  index?: string;
}

// Decoded instruction representation
export interface Instruction {
  mnemonic: string;
  operands: Operand[];
  // Machine code bytes for validation/debugging
  bytes: number[];
}

// CPU State
export interface CPUState {
  // General purpose registers (16-bit)
  AX: number; BX: number; CX: number; DX: number;

  // Pointer and index registers
  SP: number; BP: number; SI: number; DI: number;

  // Segment registers
  CS: number; DS: number; ES: number; SS: number;

  // Instruction pointer
  IP: number;

  // FLAGS register
  FLAGS: number;

  // Whether the CPU is halted
  halted: boolean;

  // Runtime error message if CPU halted due to fault (e.g. division by zero)
  error?: string;
}

// Simple factory for creating a CPU state
export function createCPUState(): CPUState {
  return {
    AX: 0, BX: 0, CX: 0, DX: 0,
    SP: 0xFFFE, // Initialize SP to top of stack area
    BP: 0, SI: 0, DI: 0,
    CS: 0, DS: 0, ES: 0, SS: 0,
    IP: 0,
    FLAGS: 0,
    halted: false
  };
}