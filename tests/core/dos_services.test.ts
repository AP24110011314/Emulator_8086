// Regression: INT 21h services match DOS behavior — AH=0Ah writes only
// count+typed chars (tail fill preserved), enforces max length, echoes;
// status checks (AH=0Bh, INT 16h AH=01h) never consume input.
import { describe, expect, it } from 'vitest';
import { CPU } from '../../src/core/cpu';
import { assemble } from '../../src/core/assembler';
import { createInterruptHandler } from '../../src/core/interrupts';

function runDos(code: string, opts?: { chars?: string; line?: string | null; segmented?: boolean }) {
  const r = assemble(code);
  if (r.errors.length) throw new Error('ASM: ' + r.errors.map(e => e.message).join(','));
  const cpu = new CPU();
  let out = '';
  let chars = (opts?.chars ?? '').split('');
  const io = {
    writeChar: (c: string) => { out += c; },
    peekChar: () => (chars.length ? chars[0] : null),
    readChar: () => (chars.length ? chars.shift()! : null),
    readLine: (_max: number) => (opts?.line !== undefined ? opts.line : null),
  };
  cpu.interruptHandler = createInterruptHandler(io);
  for (const ai of r.instructions)
    for (let i = 0; i < ai.instruction.bytes.length; i++)
      cpu.writePhysical8(ai.address + i, ai.instruction.bytes[i]);
  const seg = opts?.segmented ? r.dataSegmentParagraph : 0;
  if (r.dataBytes.length)
    for (let i = 0; i < r.dataBytes.length; i++)
      cpu.writePhysical8((seg << 4) + i, r.dataBytes[i]);
  cpu.writeRegister('CS', 0);
  cpu.writeRegister('IP', r.entryAddress);
  cpu.writeRegister('DS', seg);
  cpu.writeRegister('ES', seg);
  cpu.writeRegister('SS', 0x2000);
  cpu.writeRegister('SP', 0x0100);
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
  return { cpu, get out() { return out; } };
}

describe('DOS interrupt services', () => {
  it('AH=01 reads char into AL and echoes', () => {
    const { cpu, out } = runDos(`MOV AH,01h\nINT 21h\nHLT`, { chars: 'Q' });
    expect(cpu.readRegister8('AL')).toBe(0x51);
    expect(out).toBe('Q');
  });
  it('AH=08 reads char with NO echo', () => {
    const { cpu, out } = runDos(`MOV AH,08h\nINT 21h\nHLT`, { chars: 'Q' });
    expect(cpu.readRegister8('AL')).toBe(0x51);
    expect(out).toBe('');
  });
  it('AH=02 prints DL', () => {
    const { out } = runDos(`MOV DL,'A'\nMOV AH,02h\nINT 21h\nHLT`);
    expect(out).toBe('A');
  });
  it('AH=09 prints $-terminated string', () => {
    const { out } = runDos(`.DATA\nmsg DB 'Hi!$'\n.CODE\nMOV AX,@DATA\nMOV DS,AX\nMOV DX,OFFSET msg\nMOV AH,09h\nINT 21h\nHLT`, { segmented: true });
    expect(out).toBe('Hi!');
  });
  it('AH=0A writes count+chars, preserves tail fill, echoes', () => {
    const { cpu, out } = runDos(`.DATA\nPROMPT DB '>$'\nNAMEBUF DB 20\nDB ?\nDB 20 DUP('$')\n.CODE\nMOV AX,@DATA\nMOV DS,AX\nMOV DX,OFFSET NAMEBUF\nMOV AH,0Ah\nINT 21h\nHLT`,
      { segmented: true, line: 'Ada' });
    const ds = cpu.readRegister16('DS');
    const dx = 2; // NAMEBUF offset: PROMPT='>$' is 2 bytes, so NAMEBUF at 2
    const base = ((ds << 4) + dx) & 0xfffff;
    expect(cpu.readPhysical8(base)).toBe(20);       // max untouched
    expect(cpu.readPhysical8(base + 1)).toBe(3);    // count = 3
    expect(cpu.readPhysical8(base + 2)).toBe(0x41); // 'A'
    expect(cpu.readPhysical8(base + 3)).toBe(0x64); // 'd'
    expect(cpu.readPhysical8(base + 4)).toBe(0x61); // 'a'
    expect(cpu.readPhysical8(base + 5)).toBe(0x24); // '$' fill preserved past typed text
    expect(cpu.readPhysical8(base + 6)).toBe(0x24);
    expect(out).toBe('Ada'); // echo
  });
  it('AH=0A enforces max length', () => {
    const { cpu } = runDos(`.DATA\nBUF DB 3\nDB ?\nDB 10 DUP(0)\n.CODE\nMOV AX,@DATA\nMOV DS,AX\nMOV DX,OFFSET BUF\nMOV AH,0Ah\nINT 21h\nHLT`,
      { segmented: true, line: 'ABCDEFGH' });
    const ds = cpu.readRegister16('DS');
    const base = ((ds << 4) + 0) & 0xfffff;
    expect(cpu.readPhysical8(base + 1)).toBe(3);
    expect(String.fromCharCode(cpu.readPhysical8(base + 2), cpu.readPhysical8(base + 3), cpu.readPhysical8(base + 4))).toBe('ABC');
  });
  it('AH=0A with no line zeroes count', () => {
    const { cpu } = runDos(`.DATA\nBUF DB 5\nDB ?\nDB 10 DUP(0)\n.CODE\nMOV AX,@DATA\nMOV DS,AX\nMOV DX,OFFSET BUF\nMOV AH,0Ah\nINT 21h\nHLT`,
      { segmented: true, line: null });
    const ds = cpu.readRegister16('DS');
    expect(cpu.readPhysical8(((ds << 4) + 1) & 0xfffff)).toBe(0);
  });
  it('AH=4C and INT 20 halt', () => {
    let r = runDos(`MOV AH,4Ch\nINT 21h\nMOV AX,9999h\nHLT`);
    expect(r.cpu.getState().halted).toBe(true);
    r = runDos(`INT 20h\nMOV AX,9999h\nHLT`);
    expect(r.cpu.getState().halted).toBe(true);
  });
  it('AH=0B peeks without consuming', () => {
    const { cpu } = runDos(`MOV AH,0Bh\nINT 21h\nMOV BL,AL\nMOV AH,01h\nINT 21h\nHLT`, { chars: 'Z' });
    expect(cpu.readRegister8('BL')).toBe(0xFF); // ready
    expect(cpu.readRegister8('AL')).toBe(0x5A); // status check did not eat 'Z'
  });
  it('INT16 AH=01 peeks without consuming; AH=00 consumes', () => {
    const { cpu } = runDos(`MOV AH,01h\nINT 16h\nMOV BL,AL\nMOV AH,00h\nINT 16h\nHLT`, { chars: 'K' });
    expect(cpu.readRegister8('BL')).toBe(0x4B);
    expect(cpu.readRegister8('AL')).toBe(0x4B);
  });
  it('full name_input flow: prompt + typed name printed', () => {
    const code = `.DATA
PROMPT DB 'Enter your name: $'
NAMEBUF DB 20
        DB ?
        DB 20 DUP('$')
GREET DB 0Dh, 0Ah, 'Hello, $'
.CODE
    MOV  AX, @DATA
    MOV  DS, AX
    MOV  AH, 09h
    MOV  DX, OFFSET PROMPT
    INT  21h
    MOV  AH, 0Ah
    MOV  DX, OFFSET NAMEBUF
    INT  21h
    MOV  AH, 09h
    MOV  DX, OFFSET GREET
    INT  21h
    MOV  AH, 09h
    MOV  DX, OFFSET NAMEBUF + 2
    INT  21h
    MOV  AH, 4Ch
    INT  21h`;
    const { out } = runDos(code, { segmented: true, line: 'Ada' });
    expect(out).toBe('Enter your name: Ada\r\nHello, Ada');
  });
});
