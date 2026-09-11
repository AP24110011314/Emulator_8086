import { describe, expect, it, beforeEach } from 'vitest';
import { CPU } from '../../src/core/cpu';
import { createCPUState, Instruction, Operand } from '../../src/core/types';
import { physicalAddress } from '../../src/core/memory';
import { assemble } from '../../src/core/assembler';
import { createInterruptHandler } from '../../src/core/interrupts';

// Helper to create an instruction with operands
function makeInstruction(mnemonic: string, operands: Operand[], bytes: number[] = [0x90]): Instruction {
  return { mnemonic, operands, bytes };
}

describe('CPU', () => {
  let cpu: CPU;

  beforeEach(() => {
    cpu = new CPU();
    cpu.reset();
  });

  it('should have correct initial state', () => {
    const state = cpu.getState();
    expect(state.AX).toBe(0);
    expect(state.SP).toBe(0xFFFE);
    expect(state.CS).toBe(0);
    expect(state.FLAGS).toBe(0);
    expect(state.halted).toBe(false);
  });

  it('should read and write registers', () => {
    cpu.writeRegister('AX', 0x1234);
    cpu.writeRegister8('AL', 0x5A);
    expect(cpu.getState().AX).toBe(0x125A);
    cpu.writeRegister8('AH', 0xA5);
    expect(cpu.getState().AX).toBe(0xA55A);
    cpu.writeRegister('BX', 0x9ABC);
    cpu.writeRegister('CX', 0x1122);
    cpu.writeRegister('DX', 0x3344);
    cpu.writeRegister('SP', 0x100);
    cpu.writeRegister('BP', 0x200);
    cpu.writeRegister('SI', 0x300);
    cpu.writeRegister('DI', 0x400);
    cpu.writeRegister('CS', 0x1000);
    cpu.writeRegister('DS', 0x2000);
    cpu.writeRegister('ES', 0x3000);
    cpu.writeRegister('SS', 0x4000);
    cpu.writeRegister('IP', 0x100);
    cpu.writeRegister('FLAGS', 0x0002);
    expect(cpu.getState().FLAGS).toBe(0x0002);
  });

  it('should throw for unknown registers', () => {
    expect(() => cpu.writeRegister('NOT_A_REGISTER', 5)).toThrow('Unknown register');
    expect(() => cpu.readRegister8('AHX')).toThrow('Unknown 8-bit register');
  });

  it('should perform MOV', () => {
    cpu.execute(makeInstruction('MOV', [
      { type: 'register', register: 'AX' },
      { type: 'immediate', value: 0x1234 }
    ], [0xB8, 0x34, 0x12]));
    expect(cpu.getState().AX).toBe(0x1234);
  });

  it('should perform ADD with flags', () => {
    cpu.writeRegister('AX', 0x0005);
    cpu.execute(makeInstruction('ADD', [
      { type: 'register', register: 'AX' },
      { type: 'immediate', value: 0x0003 }
    ], [0x05, 0x03]));
    expect(cpu.getState().AX).toBe(0x0008);
    expect(cpu.getFlag('ZF')).toBe(false);
    expect(cpu.getFlag('CF')).toBe(false);
    expect(cpu.getFlag('OF')).toBe(false);
  });

  it('should set carry flag on overflow', () => {
    cpu.writeRegister('FLAGS', 0);
    cpu.writeRegister('AX', 0xFFFF);
    cpu.execute(makeInstruction('ADD', [
      { type: 'register', register: 'AX' },
      { type: 'immediate', value: 0x0001 }
    ], [0x05, 0x01]));
    expect(cpu.getState().AX).toBe(0x0000);
    expect(cpu.getFlag('CF')).toBe(true);   // unsigned overflow → CF
    // 0xFFFF as signed is -1; -1 + 1 = 0, no signed overflow → OF=false
    expect(cpu.getFlag('OF')).toBe(false);
    expect(cpu.getFlag('ZF')).toBe(true);
  });

  it('should set overflow flag on signed overflow', () => {
    cpu.writeRegister('AX', 0x7FFF);
    cpu.execute(makeInstruction('ADD', [
      { type: 'register', register: 'AX' },
      { type: 'immediate', value: 0x0001 }
    ], [0x05, 0x01]));
    expect(cpu.getState().AX).toBe(0x8000);
    expect(cpu.getFlag('OF')).toBe(true);
    expect(cpu.getFlag('SF')).toBe(true);
  });

  it('should perform SUB with flags', () => {
    cpu.writeRegister('AX', 0x0010);
    cpu.execute(makeInstruction('SUB', [
      { type: 'register', register: 'AX' },
      { type: 'immediate', value: 0x0007 }
    ], [0x2D, 0x07]));
    expect(cpu.getState().AX).toBe(0x0009);
    expect(cpu.getFlag('ZF')).toBe(false);
    expect(cpu.getFlag('CF')).toBe(false);
  });

  it('should set borrow flag on underflow', () => {
    cpu.writeRegister('AX', 0x0005);
    cpu.execute(makeInstruction('SUB', [
      { type: 'register', register: 'AX' },
      { type: 'immediate', value: 0x0007 }
    ], [0x2D, 0x07]));
    expect(cpu.getState().AX).toBe(0xFFFE);
    expect(cpu.getFlag('CF')).toBe(true);
    expect(cpu.getFlag('ZF')).toBe(false);
  });

  it('should perform CMP without changing destination', () => {
    cpu.writeRegister('AX', 0x0010);
    cpu.writeRegister('BX', 0x0005);
    cpu.execute(makeInstruction('CMP', [
      { type: 'register', register: 'AX' },
      { type: 'register', register: 'BX' }
    ], [0x39, 0xC3]));
    expect(cpu.getState().AX).toBe(0x0010);
    expect(cpu.getState().BX).toBe(0x0005);
    expect(cpu.getFlag('ZF')).toBe(false);
    expect(cpu.getFlag('SF')).toBe(false);
  });

  it('should perform AND, OR, XOR with flags', () => {
    cpu.writeRegister('AX', 0x0F0F);
    cpu.execute(makeInstruction('AND', [
      { type: 'register', register: 'AX' },
      { type: 'immediate', value: 0xFF00 }
    ], [0x25, 0xFF, 0x00]));
    expect(cpu.getState().AX).toBe(0x0F00);
    expect(cpu.getFlag('CF')).toBe(false);
    expect(cpu.getFlag('OF')).toBe(false);

    cpu.writeRegister('AX', 0x0000);
    cpu.execute(makeInstruction('OR', [
      { type: 'register', register: 'AX' },
      { type: 'immediate', value: 0x00FF }
    ], [0x09, 0xFF, 0x00]));
    expect(cpu.getState().AX).toBe(0x00FF);
    expect(cpu.getFlag('PF')).toBe(true);

    cpu.writeRegister('AX', 0x00FF);
    cpu.execute(makeInstruction('XOR', [
      { type: 'register', register: 'AX' },
      { type: 'immediate', value: 0x00FF }
    ], [0x35, 0xFF, 0x00]));
    expect(cpu.getState().AX).toBe(0x0000);
    expect(cpu.getFlag('ZF')).toBe(true);
  });

  it('should perform INC and DEC', () => {
    // INC: increment AX from 0x00FF to 0x0100
    cpu.writeRegister('FLAGS', 0);
    cpu.writeRegister('AX', 0x00FF);
    cpu.execute(makeInstruction('INC', [{ type: 'register', register: 'AX' }], [0x40]));
    expect(cpu.getState().AX).toBe(0x0100);
    // INC affects SF, ZF, AF, OF, PF but NOT CF - CF should be preserved (still 0)
    expect(cpu.getFlag('CF')).toBe(false);
    expect(cpu.getFlag('ZF')).toBe(false);  // 0x0100 is not zero
    expect(cpu.getFlag('SF')).toBe(false);  // result is positive
    expect(cpu.getFlag('PF')).toBe(true);   // parity of 0x0100 = 0 (even number of 1 bits)
    expect(cpu.getFlag('OF')).toBe(false);  // 0x00FF -> 0x0100: no sign-bit overflow
    expect(cpu.getFlag('AF')).toBe(true);   // ((0x0F + 1) > 0xF) = true

    // DEC: decrement AX from 0x0100 to 0x00FF
    cpu.execute(makeInstruction('DEC', [{ type: 'register', register: 'AX' }], [0x48]));
    expect(cpu.getState().AX).toBe(0x00FF);
    // DEC affects SF, ZF, AF, OF, PF but NOT CF - CF should be preserved (still false)
    expect(cpu.getFlag('CF')).toBe(false);
    expect(cpu.getFlag('ZF')).toBe(false);  // 0x00FF is not zero
    expect(cpu.getFlag('SF')).toBe(false);  // result is positive
    expect(cpu.getFlag('PF')).toBe(true);   // parity of 0x00FF low byte = 0xFF = 8 ones = even → PF=1
    expect(cpu.getFlag('OF')).toBe(false);  // 0x0100 -> 0x00FF: no sign-bit underflow
    // AF = ((d & 0xF) < 1); d=0x0100, d&0xF=0, so 0 < 1 = true → AF=true
    expect(cpu.getFlag('AF')).toBe(true);
  });

  it('should perform JMP', () => {
    cpu.writeRegister('IP', 0x0100);
    cpu.execute(makeInstruction('JMP', [{ type: 'immediate', value: 0x0200 }], [0xEB, 0x04]));
    expect(cpu.getState().IP).toBe(0x0200);
  });

  it('should perform conditional jumps', () => {
    cpu.writeRegister('IP', 0x0100);
    // Set AX=5 first, then CMP so that ZF is set (5-5=0)
    cpu.writeRegister('AX', 0x0005);
    cpu.execute(makeInstruction('CMP', [
      { type: 'register', register: 'AX' },
      { type: 'immediate', value: 0x0005 }
    ], [0x80, 0xF8, 0x05]));
    // ZF=1 now (result was 0), JE should jump
    cpu.execute(makeInstruction('JE', [{ type: 'immediate', value: 0x0105 }], [0x74, 0x00]));
    expect(cpu.getState().IP).toBe(0x0105);

    // ZF is still 1, JNE should NOT jump — IP stays at 0x0105
    cpu.execute(makeInstruction('JNE', [{ type: 'immediate', value: 0x0200 }], [0x75, 0x04]));
    expect(cpu.getState().IP).toBe(0x0105);
  });

  it('should perform LOOP', () => {
    cpu.writeRegister('IP', 0x0100);
    cpu.writeRegister('CX', 0x0003);
    cpu.execute(makeInstruction('LOOP', [{ type: 'immediate', value: 0x0100 }], [0xE0, 0xFE]));
    expect(cpu.getState().CX).toBe(0x0002);
    expect(cpu.getState().IP).toBe(0x0100);
  });

  it('should perform CALL and RET', () => {
    cpu.writeRegister('IP', 0x0100);
    cpu.writeRegister('SP', 0x0100);
    cpu.writeRegister('SS', 0x0000);
    cpu.execute(makeInstruction('CALL', [{ type: 'immediate', value: 0x0200 }], [0xE8, 0x04, 0x00]));
    expect(cpu.getState().IP).toBe(0x0200);
    expect(cpu.getState().SP).toBe(0x00FE);
    expect(cpu.read16(physicalAddress(0x0000, 0x00FE))).toBe(0x0103);
    cpu.execute(makeInstruction('RET', [], [0xC3]));
    expect(cpu.getState().IP).toBe(0x0103);
    expect(cpu.getState().SP).toBe(0x0100);
  });

  it('should perform PUSH and POP', () => {
    cpu.writeRegister('IP', 0x0100);
    cpu.writeRegister('SP', 0x0100);
    cpu.writeRegister('SS', 0x0000);
    cpu.execute(makeInstruction('PUSH', [{ type: 'immediate', value: 0x1234 }], [0x68, 0x34, 0x12]));
    expect(cpu.getState().SP).toBe(0x00FE);
    expect(cpu.read16(physicalAddress(0x0000, 0x00FE))).toBe(0x1234);
    cpu.execute(makeInstruction('POP', [{ type: 'register', register: 'AX' }], [0x58]));
    expect(cpu.getState().AX).toBe(0x1234);
    expect(cpu.getState().SP).toBe(0x0100);
  });

  it('should perform XCHG', () => {
    cpu.writeRegister('AX', 0x1234);
    cpu.writeRegister('BX', 0x5678);
    cpu.execute(makeInstruction('XCHG', [
      { type: 'register', register: 'AX' },
      { type: 'register', register: 'BX' }
    ], [0x90, 0xC3]));
    expect(cpu.getState().AX).toBe(0x5678);
    expect(cpu.getState().BX).toBe(0x1234);
  });

  it('should perform NOP and HLT', () => {
    cpu.execute(makeInstruction('NOP', []));
    expect(cpu.getState().AX).toBe(0);
    cpu.execute(makeInstruction('HLT', []));
    expect(cpu.getState().halted).toBe(true);
    expect(cpu.step()).toBeNull();
  });

  it('should run Hello World and capture output', () => {
    let out = '';
    const io = { writeChar: (c: string) => { out += c; }, readChar: () => null };

    // Test 1: string using AH=09h
    const code1 = `
.DATA
    msg DB 'Hello, World!$'
.CODE
    MOV AX, @DATA
    MOV DS, AX
    MOV AH, 09h
    MOV DX, msg
    INT 21h
    MOV AH, 4Ch
    INT 21h
`;
    const res = assemble(code1);
    expect(res.errors).toHaveLength(0);
    const c = new CPU();
    c.interruptHandler = createInterruptHandler(io);
    const dataPhysBase = res.dataSegmentParagraph << 4;
    for (let i = 0; i < res.dataBytes.length; i++) {
      c.writePhysical8(dataPhysBase + i, res.dataBytes[i]);
    }
    c.writeRegister('DS', res.dataSegmentParagraph);
    for (const ai of res.instructions) {
      c.execute(ai.instruction);
    }
    expect(out).toBe('Hello, World!');

    // Test 2: char by char with AH=02h
    out = '';
    const code2 = `
        MOV AH, 02h
        MOV DL, 'H'
        INT 21h
        MOV DL, 'i'
        INT 21h
        MOV AH, 4Ch
        INT 21h
`;
    const res2 = assemble(code2);
    expect(res2.errors).toHaveLength(0);
    const c2 = new CPU();
    c2.interruptHandler = createInterruptHandler(io);
    for (const ai of res2.instructions) {
      c2.execute(ai.instruction);
    }
    expect(out).toBe('Hi');
  });

  it('should perform LEA', () => {
    cpu.writeRegister('DS', 0x1000);
    cpu.writeRegister('BX', 0x0010);
    cpu.writeRegister('AX', 0);
    cpu.execute(makeInstruction('LEA', [
      { type: 'register', register: 'AX' },
      { type: 'memory', register: 'BX', offset: 0x0020 }
    ], [0x8D, 0x1C, 0x0E]));
    // LEA loads the effective address (offset only)
    expect(cpu.getState().AX).toBe(0x0030);
  });

  it('should step through instructions', () => {
    // MOV AX, 0x1234 = 0xB8, 0x34, 0x12 (little-endian: lo first), then NOP = 0x90
    cpu.loadAndJump([0xB8, 0x34, 0x12, 0x90], 0, 0);
    const instr1 = cpu.step(); // MOV AX, 0x1234 — 3 bytes, IP goes to 3
    const instr2 = cpu.step(); // NOP — 1 byte, IP goes to 4
    expect(instr1?.mnemonic).toBe('MOV');
    expect(instr2?.mnemonic).toBe('NOP');
    expect(cpu.getState().AX).toBe(0x1234);
    expect(cpu.getState().IP).toBe(0x0004);
  });
});
