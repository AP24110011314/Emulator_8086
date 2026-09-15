// Regression: every addressing mode resolves to the correct physical address
// with the correct default segment (SS for BP-based, DS otherwise).
import { describe, expect, it } from 'vitest';
import { CPU } from '../../src/core/cpu';
import { assemble } from '../../src/core/assembler';
import { Memory } from '../../src/core/memory';

function run(code: string, setup?: (cpu: CPU) => void) {
  const r = assemble(code);
  if (r.errors.length) throw new Error('ASM: ' + r.errors.map(e => e.message).join(','));
  const cpu = new CPU();
  for (const ai of r.instructions)
    for (let i = 0; i < ai.instruction.bytes.length; i++)
      cpu.writePhysical8(ai.address + i, ai.instruction.bytes[i]);
  if (r.dataBytes.length)
    for (let i = 0; i < r.dataBytes.length; i++)
      cpu.writePhysical8((r.dataSegmentParagraph << 4) + i, r.dataBytes[i]);
  cpu.writeRegister('CS', 0);
  cpu.writeRegister('IP', r.entryAddress);
  cpu.writeRegister('DS', 0);
  cpu.writeRegister('ES', 0);
  cpu.writeRegister('SS', 0);
  cpu.writeRegister('SP', 0xFFFE);
  if (setup) setup(cpu);
  const map = new Map(r.instructions.map(a => [a.address, a]));
  let steps = 0;
  while (!cpu.getState().halted && steps < 2000) {
    const ip = cpu.getState().IP;
    const ai = map.get(ip);
    if (!ai) break;
    cpu.execute(ai.instruction);
    if (cpu.getState().IP === ip) cpu.writeRegister('IP', (ip + ai.instruction.bytes.length) & 0xffff);
    steps++;
  }
  return cpu;
}

describe('addressing modes and default segments', () => {
  // DS base 0x10000, SS base 0x20000. Same offsets hold different markers.
  const mark = (cpu: CPU) => {
    cpu.writePhysical8(0x10050, 0xAA); cpu.writePhysical8(0x10051, 0x11);
    cpu.writePhysical8(0x20050, 0xBB); cpu.writePhysical8(0x20051, 0x22);
    cpu.writePhysical8(0x10060, 0xCC);
    cpu.writePhysical8(0x20060, 0xDD);
    cpu.writePhysical8(0x10070, 0xEE);
    cpu.writePhysical8(0x20070, 0xFF);
  };
  const seg = `
    MOV AX, 1000h
    MOV DS, AX
    MOV AX, 2000h
    MOV SS, AX
  `;

  it('direct [50h] uses DS', () => {
    const cpu = run(seg + 'MOV AX, [50h]\nHLT', mark);
    expect(cpu.getState().AX).toBe(0x11AA);
  });
  it('[BP] defaults to SS', () => {
    const cpu = run(seg + 'MOV BP, 50h\nMOV AX, [BP]\nHLT', mark);
    expect(cpu.getState().AX).toBe(0x22BB);
  });
  it('[BX] defaults to DS', () => {
    const cpu = run(seg + 'MOV BX, 50h\nMOV AX, [BX]\nHLT', mark);
    expect(cpu.getState().AX).toBe(0x11AA);
  });
  it('[SI]/[DI] indirect use DS', () => {
    let cpu = run(seg + 'MOV SI, 50h\nMOV AX, [SI]\nHLT', mark);
    expect(cpu.getState().AX).toBe(0x11AA);
    cpu = run(seg + 'MOV DI, 50h\nMOV AX, [DI]\nHLT', mark);
    expect(cpu.getState().AX).toBe(0x11AA);
  });
  it('[BP+10h] uses SS; [BX+10h] uses DS', () => {
    let cpu = run(seg + 'MOV BP, 50h\nMOV AX, [BP+10h]\nHLT', mark);
    expect(cpu.readPhysical8(0x20060)).toBe(0xDD);
    expect(cpu.getState().AX).toBe(cpu.readPhysical8(0x20060) | (cpu.readPhysical8(0x20061) << 8));
    // DS marker at 0x10060 is 0xCC — must NOT read that
    expect(cpu.getState().AX & 0xFF).toBe(0xDD);
    cpu = run(seg + 'MOV BX, 50h\nMOV AX, [BX+10h]\nHLT', mark);
    expect(cpu.getState().AX & 0xFF).toBe(0xCC);
  });
  it('based+indexed all four combos + displacement', () => {
    // BX=0x40, SI=0x10 → 0x50; BP=0x40, DI=0x10 → 0x50
    let cpu = run(seg + 'MOV BX,40h\nMOV SI,10h\nMOV AX,[BX+SI]\nHLT', mark);
    expect(cpu.getState().AX & 0xFF).toBe(0xAA); // DS
    cpu = run(seg + 'MOV BP,40h\nMOV DI,10h\nMOV AX,[BP+DI]\nHLT', mark);
    expect(cpu.getState().AX & 0xFF).toBe(0xBB); // SS
    cpu = run(seg + 'MOV BP,40h\nMOV SI,10h\nMOV AX,[BP+SI]\nHLT', mark);
    expect(cpu.getState().AX & 0xFF).toBe(0xBB); // SS (BP present)
    cpu = run(seg + 'MOV BX,40h\nMOV DI,10h\nMOV AX,[BX+DI+10h]\nHLT', mark);
    expect(cpu.getState().AX & 0xFF).toBe(0xCC); // DS:0x60
    cpu = run(seg + 'MOV BP,40h\nMOV DI,20h\nMOV AX,[BP+DI+10h]\nHLT', mark);
    expect(cpu.getState().AX & 0xFF).toBe(0xFF); // SS:0x70
  });
  it('segment override DS:[BP] reads DS; ES:[BX] reads ES', () => {
    let cpu = run(seg + 'MOV BP,50h\nMOV AX,DS:[BP]\nHLT', mark);
    expect(cpu.getState().AX & 0xFF).toBe(0xAA);
    cpu = run(seg + 'MOV AX,1000h\nMOV ES,AX\nMOV BX,50h\nMOV AX,ES:[BX]\nHLT', mark);
    expect(cpu.getState().AX & 0xFF).toBe(0xAA);
    // ES pointing elsewhere reads elsewhere
    cpu = run(seg + 'MOV AX,2000h\nMOV ES,AX\nMOV BX,50h\nMOV AX,ES:[BX]\nHLT', mark);
    expect(cpu.getState().AX & 0xFF).toBe(0xBB);
  });
  it('writes go to the same resolved address as reads', () => {
    const cpu = run(seg + 'MOV BP,50h\nMOV WORD PTR [BP], 1234h\nMOV BX,50h\nMOV AX,[BX]\nHLT', mark);
    // [BP] wrote to SS:0x50; [BX] reads DS:0x50 (untouched marker)
    expect(cpu.readPhysical8(0x20050)).toBe(0x34);
    expect(cpu.getState().AX & 0xFF).toBe(0xAA);
  });
  it('LEA computes offset without touching segment', () => {
    const cpu = run(seg + 'MOV BX,40h\nMOV SI,10h\nLEA AX,[BX+SI+5]\nHLT', mark);
    expect(cpu.getState().AX).toBe(0x55);
  });
  it('LDS/LES load far pointer', () => {
    const cpu = run(seg + `
      MOV BX, 80h
      MOV WORD PTR [BX], 1234h
      MOV WORD PTR [BX+2], 2000h
      LDS SI, [BX]
      HLT`, mark);
    expect(cpu.getState().SI).toBe(0x1234);
    expect(cpu.getState().DS).toBe(0x2000);
  });
  it('XLAT uses DS:BX+AL', () => {
    const cpu = run(seg + 'MOV BX,50h\nMOV AL,0\nXLAT\nHLT', mark);
    expect(cpu.readRegister8('AL')).toBe(0xAA);
  });
  it('word access wraps at the 1MB boundary like hardware', () => {
    const mem = new Memory();
    mem.write16(0xFFFFF, 0x1234);
    expect(mem.read8(0xFFFFF)).toBe(0x34);
    expect(mem.read8(0)).toBe(0x12);
    expect(mem.read16(0xFFFFF)).toBe(0x1234);
  });
});
