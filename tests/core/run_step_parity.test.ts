import { describe, expect, it } from 'vitest';
import { CPU } from '../../src/core/cpu';
import { assemble, AssembledInstruction } from '../../src/core/assembler';
import { createInterruptHandler } from '../../src/core/interrupts';
import { SAMPLES } from '../../src/samples/index';

// Run-vs-Step parity: every program runs two ways and must end byte-identical.
// - STEP path: one instruction per iteration (mirrors App.tsx handleStep).
// - RUN path: batched iterations (mirrors App.tsx runLoop batching: 1 / 8 /
//   64 instr per tick, halt checked per instruction). Batching must change
//   only render frequency, never semantics, output, or final state.
// Any divergence is a Run-loop bug (double-execution, duplicate output),
// not an instruction bug.

interface ScriptedInput {
  chars?: string;
  line?: string | null;
}

interface FinalState {
  regs: number[];
  flags: number;
  output: string;
  steps: number;
  memHash: number;
}

function setupCpu(source: string, input: ScriptedInput, outputSink: { text: string }): { cpu: CPU; instrMap: Map<number, AssembledInstruction> } {
  const r = assemble(source);
  if (r.errors.length) throw new Error('ASM: ' + r.errors.map(e => e.message).join(','));
  const cpu = new CPU();
  const chars = (input.chars ?? '').split('');
  cpu.interruptHandler = createInterruptHandler({
    writeChar: (c: string) => { outputSink.text += c; },
    peekChar: () => (chars.length ? chars[0] : null),
    readChar: () => (chars.length ? chars.shift()! : null),
    readLine: (_max: number) => (input.line !== undefined ? input.line : null),
  });
  for (const ai of r.instructions)
    for (let i = 0; i < ai.instruction.bytes.length; i++)
      cpu.writePhysical8(ai.address + i, ai.instruction.bytes[i]);
  // App.tsx setup: segmented .MODEL/.DATA/.CODE vs flat .COM
  const isSegmented = /(\.MODEL|PROC|SEGMENT|\.DATA|\.CODE|\.STACK)/i.test(source);
  const dsVal = isSegmented ? r.dataSegmentParagraph : 0;
  if (r.dataBytes.length)
    for (let i = 0; i < r.dataBytes.length; i++)
      cpu.writePhysical8((r.dataSegmentParagraph << 4) + i, r.dataBytes[i]);
  cpu.writeRegister('CS', 0);
  cpu.writeRegister('IP', r.entryAddress);
  cpu.writeRegister('DS', dsVal);
  cpu.writeRegister('ES', dsVal);
  cpu.writeRegister('SS', 0x2000);
  cpu.writeRegister('SP', 0x0100);
  const instrMap = new Map<number, AssembledInstruction>();
  for (const ai of r.instructions) instrMap.set(ai.address, ai);
  return { cpu, instrMap };
}

function singleStep(cpu: CPU, ai: AssembledInstruction): void {
  const ip = cpu.getState().IP;
  cpu.execute(ai.instruction);
  if (cpu.getState().IP === ip)
    cpu.writeRegister('IP', (ip + ai.instruction.bytes.length) & 0xffff);
}

function runStepPath(source: string, input: ScriptedInput = {}): FinalState {
  const sink = { text: '' };
  const { cpu, instrMap } = setupCpu(source, input, sink);
  let steps = 0;
  while (!cpu.getState().halted && steps < 50000) {
    const ai = instrMap.get(cpu.getState().IP);
    if (!ai) break;
    singleStep(cpu, ai);
    steps++;
  }
  return snapshot(cpu, sink.text, steps);
}

function runBatchedPath(source: string, input: ScriptedInput = {}, batch: number): FinalState {
  const sink = { text: '' };
  const { cpu, instrMap } = setupCpu(source, input, sink);
  let steps = 0;
  while (!cpu.getState().halted && steps < 50000) {
    let stopped = cpu.getState().halted;
    for (let i = 0; i < batch && !stopped; i++) {
      const ai = instrMap.get(cpu.getState().IP);
      if (!ai) { stopped = true; break; }
      singleStep(cpu, ai);
      steps++;
      if (cpu.getState().halted) stopped = true;
    }
    if (stopped) break;
  }
  return snapshot(cpu, sink.text, steps);
}

function snapshot(cpu: CPU, output: string, steps: number): FinalState {
  const s = cpu.getState();
  const data = cpu.getMemory().getData();
  let h = 2166136261;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 16777619);
  }
  return {
    regs: [s.AX, s.BX, s.CX, s.DX, s.SP, s.BP, s.SI, s.DI, s.CS, s.DS, s.ES, s.SS, s.IP],
    flags: s.FLAGS,
    output,
    steps,
    memHash: h | 0,
  };
}

function expectParity(source: string, input: ScriptedInput = {}) {
  const stepped = runStepPath(source, input);
  for (const batch of [1, 8, 64]) {
    const batched = runBatchedPath(source, input, batch);    expect(batched, `batch=${batch} divergence`).toEqual(stepped);
  }
}

const EXTRA_PROGRAMS: Array<{ name: string; code: string; input?: ScriptedInput }> = [
  {
    name: 'string reverse in place',
    code: `ORG 100h
str DB 'ABCDE'
MOV SI, OFFSET str
MOV DI, OFFSET str
ADD DI, 4
MOV CX, 2
rev_loop:
    MOV AL, [SI]
    MOV BL, [DI]
    MOV [SI], BL
    MOV [DI], AL
    INC SI
    DEC DI
    LOOP rev_loop
HLT`,
  },
  {
    name: 'fibonacci into memory',
    code: `ORG 100h
fib DB 8 DUP(0)
MOV SI, OFFSET fib
MOV BYTE PTR [SI], 0
MOV BYTE PTR [SI+1], 1
MOV CX, 6
ADD SI, 2
fib_loop:
    MOV AL, [SI-1]
    MOV BL, [SI-2]
    ADD AL, BL
    MOV [SI], AL
    INC SI
    LOOP fib_loop
HLT`,
  },
  {
    name: 'find max with jumps',
    code: `ORG 100h
arr DB 3, 9, 2, 7, 5
MOV CX, 4
MOV SI, OFFSET arr
MOV AL, [SI]
find_max:
    INC SI
    MOV BL, [SI]
    CMP BL, AL
    JLE skip_update
    MOV AL, BL
skip_update:
    LOOP find_max
HLT`,
  },
  {
    name: 'char input echo + print (AH=01)',
    code: `MOV AH, 01h
INT 21h
MOV DL, AL
MOV AH, 02h
INT 21h
HLT`,
    input: { chars: 'Q' },
  },
  {
    name: 'factorial with MUL + LOOP',
    code: `ORG 100h
MOV CX, 5
MOV AX, 1
fact_loop:
    MOV BX, CX
    MUL BX
    LOOP fact_loop
HLT`,
  },
];

describe('Run-vs-Step parity', () => {
  for (const s of SAMPLES) {
    it(`sample: ${s.id}`, () => {
      const input: ScriptedInput = s.id === 'name_input' ? { line: 'Ada' } : {};
      expectParity(s.code, input);
    });
  }
  for (const p of EXTRA_PROGRAMS) {
    it(`program: ${p.name}`, () => {
      expectParity(p.code, p.input ?? {});
    });
  }
  it('name_input output content is correct (not just self-consistent)', () => {
    const stepped = runStepPath(SAMPLES.find(s => s.id === 'name_input')!.code, { line: 'Ada' });
    expect(stepped.output).toBe('Enter your name: Ada\r\nHello, Ada');
  });
  it('countdown output has no duplicated digits', () => {
    const stepped = runStepPath(SAMPLES.find(s => s.id === 'countdown')!.code);
    // 10..1 digits each followed by newline; no "0112233" duplication pattern
    expect(stepped.output).not.toMatch(/(.)\1\1/);
    expect(stepped.output.length).toBeGreaterThan(0);
  });
});
