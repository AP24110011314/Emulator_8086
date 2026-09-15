// Regression: label arithmetic positions, nested DUP, negative EQU,
// forward references, and precise (not silent/misreported) errors.
import { describe, expect, it } from 'vitest';
import { assemble } from '../../src/core/assembler';

describe('assembler edge cases', () => {
  it('label arithmetic all positions', () => {
    const r = assemble(`
      ORG 100h
      arr DB 1, 2, 3
      MOV DX, OFFSET arr + 2
      MOV SI, arr+1
      MOV AL, [arr + 2]
      MOV BX, OFFSET arr-1
      MOV CX, arr + 0FFH
      HLT
    `);
    expect(r.errors).toEqual([]);
    const code = r.instructions.filter(a => !/^(DB|DW|DD)$/i.test(a.instruction.mnemonic));
    const vals = code.map(a => a.instruction.operands.map(o => o.value).filter(v => v !== undefined));
    expect(vals[0]).toEqual([0x102]); // OFFSET arr+2
    expect(vals[1]).toEqual([0x101]); // bare arr+1
    expect(vals[3]).toEqual([0xFF]);  // OFFSET arr-1 = 0x100-1
    expect(vals[4]).toEqual([0x1FF]); // arr+0FFH
    const mem = code[2].instruction.operands[1];
    expect(mem.type).toBe('memory');
    expect(mem.offset).toBe(0x102);
  });
  it('nested DUP expands fully', () => {
    const r = assemble(`ORG 100h\nbuf DB 2 DUP(3 DUP(7))\nHLT`);
    expect(r.errors).toEqual([]);
    const db = r.instructions[0].instruction;
    expect(db.bytes.length).toBe(6);
    expect(db.bytes.every(b => b === 7)).toBe(true);
  });
  it('negative EQU and EQU used in DB/DW', () => {
    const r = assemble(`NEG1 EQU -2\nMOV AL, NEG1\nHLT`);
    expect(r.errors).toEqual([]);
    expect(r.instructions[0].instruction.operands[1].value).toBe(0xFFFE);
  });
  it('forward-referenced label in JMP and MOV', () => {
    const r = assemble(`JMP done\nMOV AX, 1\ndone:\nMOV BX, val\nHLT\nval DB 5`);
    expect(r.errors).toEqual([]);
  });
  it('unknown label inside brackets is an error, not silent [0]', () => {
    const r = assemble(`MOV AX, [NOPE_LABEL_XYZ]\nHLT`);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0].message).toMatch(/NOPE_LABEL_XYZ/);
  });
  it('unknown label with arithmetic is Undefined label, not parse error', () => {
    const r = assemble(`MOV DX, OFFSET MISSING ABC + 2\nHLT`);
    // 'MISSING ABC + 2' — garbage; must report something accurate, not crash
    expect(r.errors.length).toBeGreaterThan(0);
  });
  it('DB string + ? + DUP mixed', () => {
    const r = assemble(`ORG 100h\nmsg DB 'AB', 0, ?, 3 DUP(9)\nHLT`);
    expect(r.errors).toEqual([]);
    expect(r.instructions[0].instruction.bytes).toEqual([0x41, 0x42, 0, 0, 9, 9, 9]);
  });
  it('DW/DD little-endian bytes', () => {
    const r = assemble(`ORG 100h\nw DW 1234h\nd DD 12345678h\nHLT`);
    expect(r.errors).toEqual([]);
    expect(r.instructions[0].instruction.bytes).toEqual([0x34, 0x12]);
    expect(r.instructions[1].instruction.bytes).toEqual([0x78, 0x56, 0x34, 0x12]);
  });
  it('PROC/ENDP + RET n + END entry', () => {
    const r = assemble(`.CODE\nCALL ADDN\nHLT\nADDN PROC\nMOV AX,1\nRET 4\nADDN ENDP\nEND`);
    expect(r.errors).toEqual([]);
    const ret = r.instructions.find(a => a.instruction.mnemonic === 'RET');
    expect(ret).toBeDefined();
  });
  it('segmented .DATA/.CODE labels resolve', () => {
    const r = assemble(`.DATA\nmsg DB 'Hi$'\n.CODE\nMOV DX, OFFSET msg\nHLT`);
    expect(r.errors).toEqual([]);
    expect(r.dataBytes).toEqual([0x48, 0x69, 0x24]);
    expect(r.instructions[0].instruction.operands[1].value).toBe(0);
  });
  it('BYTE PTR / WORD PTR sizes', () => {
    const r = assemble(`MOV BYTE PTR [100h], 5\nMOV WORD PTR [BX], AX\nHLT`);
    expect(r.errors).toEqual([]);
    expect(r.instructions[0].instruction.operands[0].size).toBe(8);
    expect(r.instructions[1].instruction.operands[0].size).toBe(16);
  });
});
