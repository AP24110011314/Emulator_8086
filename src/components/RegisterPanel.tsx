import React from 'react';
import { CPUState } from '../core/types';

interface RegisterPanelProps {
  cpuState: CPUState | null;
  prevState: CPUState | null;
  /** Render content only (no section wrapper/header) when nested in a card that has its own heading. */
  bare?: boolean;
}

function hex16(n: number): string {
  return (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

function hex8(n: number): string {
  return (n & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

const DEFAULT_STATE: CPUState = {
  AX: 0, BX: 0, CX: 0, DX: 0,
  SP: 0x0100, BP: 0, SI: 0, DI: 0,
  IP: 0, DS: 0x1000, SS: 0x2000, CS: 0, ES: 0,
  FLAGS: 0, halted: false
};

// Short role descriptions shown in hover tooltips.
const REG_DESC: Record<string, string> = {
  AX: 'Accumulator — arithmetic results, I/O data',
  AH: 'High byte of AX', AL: 'Low byte of AX',
  BX: 'Base — base pointer for memory access',
  BH: 'High byte of BX', BL: 'Low byte of BX',
  CX: 'Count — loop counter, string/repeat count',
  CH: 'High byte of CX', CL: 'Low byte of CX (shifts, ports)',
  DX: 'Data — I/O port address, MUL/DIV helper',
  DH: 'High byte of DX', DL: 'Low byte of DX',
  SP: 'Stack Pointer — offset of stack top',
  BP: 'Base Pointer — stack frame base',
  SI: 'Source Index — string source pointer',
  DI: 'Destination Index — string destination pointer',
  IP: 'Instruction Pointer — offset of next instruction',
  DS: 'Data Segment — base of data memory',
  SS: 'Stack Segment — base of stack memory',
  CS: 'Code Segment — base of code memory',
};

export function RegisterPanel({ cpuState, prevState, bare }: RegisterPanelProps) {
  const state = cpuState ?? DEFAULT_STATE;

  const changed = (key: keyof CPUState) => {
    if (!cpuState || !prevState) return false;
    return cpuState[key] !== prevState[key];
  };

  // Hover tooltip: role + hex + unsigned decimal value.
  const tip = (name: string, val: number, wide: boolean) =>
    `${name} · ${REG_DESC[name] ?? ''} — hex ${wide ? hex16(val) : hex8(val)}h, dec ${val & (wide ? 0xffff : 0xff)}`;

  const ah = (state.AX >> 8) & 0xff;
  const al = state.AX & 0xff;
  const bh = (state.BX >> 8) & 0xff;
  const bl = state.BX & 0xff;
  const ch = (state.CX >> 8) & 0xff;
  const cl = state.CX & 0xff;
  const dh = (state.DX >> 8) & 0xff;
  const dl = state.DX & 0xff;

  const prevAH = prevState ? (prevState.AX >> 8) & 0xff : ah;
  const prevAL = prevState ? prevState.AX & 0xff : al;
  const prevBH = prevState ? (prevState.BX >> 8) & 0xff : bh;
  const prevBL = prevState ? prevState.BX & 0xff : bl;
  const prevCH = prevState ? (prevState.CX >> 8) & 0xff : ch;
  const prevCL = prevState ? prevState.CX & 0xff : cl;
  const prevDH = prevState ? (prevState.DX >> 8) & 0xff : dh;
  const prevDL = prevState ? prevState.DX & 0xff : dl;

  return (
    <div className={`sidebar-section reg-section${bare ? ' bare' : ''}`}>
      {!bare && <div className="sidebar-section-header">REGISTERS</div>}

      {/* General Purpose rows: AX AH AL etc. */}
      <div className="reg-gp-table">
        {/* AX */}
        <div className="reg-row-gp">
          <span className="reg-name-16">AX</span>
          <span className={`reg-box reg-box-16 ${changed('AX') ? 'changed' : ''}`} id="reg-ax" title={tip('AX', state.AX, true)}>{hex16(state.AX)}</span>
          <span className="reg-name-8">AH</span>
          <span className={`reg-box reg-box-8 ${ah !== prevAH ? 'changed' : ''}`} id="reg-ah" title={tip('AH', ah, false)}>{hex8(ah)}</span>
          <span className="reg-name-8">AL</span>
          <span className={`reg-box reg-box-8 ${al !== prevAL ? 'changed' : ''}`} id="reg-al" title={tip('AL', al, false)}>{hex8(al)}</span>
        </div>

        {/* BX */}
        <div className="reg-row-gp">
          <span className="reg-name-16">BX</span>
          <span className={`reg-box reg-box-16 ${changed('BX') ? 'changed' : ''}`} id="reg-bx" title={tip('BX', state.BX, true)}>{hex16(state.BX)}</span>
          <span className="reg-name-8">BH</span>
          <span className={`reg-box reg-box-8 ${bh !== prevBH ? 'changed' : ''}`} id="reg-bh" title={tip('BH', bh, false)}>{hex8(bh)}</span>
          <span className="reg-name-8">BL</span>
          <span className={`reg-box reg-box-8 ${bl !== prevBL ? 'changed' : ''}`} id="reg-bl" title={tip('BL', bl, false)}>{hex8(bl)}</span>
        </div>

        {/* CX */}
        <div className="reg-row-gp">
          <span className="reg-name-16">CX</span>
          <span className={`reg-box reg-box-16 ${changed('CX') ? 'changed' : ''}`} id="reg-cx" title={tip('CX', state.CX, true)}>{hex16(state.CX)}</span>
          <span className="reg-name-8">CH</span>
          <span className={`reg-box reg-box-8 ${ch !== prevCH ? 'changed' : ''}`} id="reg-ch" title={tip('CH', ch, false)}>{hex8(ch)}</span>
          <span className="reg-name-8">CL</span>
          <span className={`reg-box reg-box-8 ${cl !== prevCL ? 'changed' : ''}`} id="reg-cl" title={tip('CL', cl, false)}>{hex8(cl)}</span>
        </div>

        {/* DX */}
        <div className="reg-row-gp">
          <span className="reg-name-16">DX</span>
          <span className={`reg-box reg-box-16 ${changed('DX') ? 'changed' : ''}`} id="reg-dx" title={tip('DX', state.DX, true)}>{hex16(state.DX)}</span>
          <span className="reg-name-8">DH</span>
          <span className={`reg-box reg-box-8 ${dh !== prevDH ? 'changed' : ''}`} id="reg-dh" title={tip('DH', dh, false)}>{hex8(dh)}</span>
          <span className="reg-name-8">DL</span>
          <span className={`reg-box reg-box-8 ${dl !== prevDL ? 'changed' : ''}`} id="reg-dl" title={tip('DL', dl, false)}>{hex8(dl)}</span>
        </div>
      </div>

      <div className="sidebar-divider" />

      {/* Pointer & Index: SP, BP, SI, DI */}
      <div className="reg-single-col">
        <div className="reg-row-single">
          <span className="reg-name-16">SP</span>
          <span className={`reg-box reg-box-16 ${changed('SP') ? 'changed' : ''}`} id="reg-sp" title={tip('SP', state.SP, true)}>{hex16(state.SP)}</span>
        </div>
        <div className="reg-row-single">
          <span className="reg-name-16">BP</span>
          <span className={`reg-box reg-box-16 ${changed('BP') ? 'changed' : ''}`} id="reg-bp" title={tip('BP', state.BP, true)}>{hex16(state.BP)}</span>
        </div>
        <div className="reg-row-single">
          <span className="reg-name-16">SI</span>
          <span className={`reg-box reg-box-16 ${changed('SI') ? 'changed' : ''}`} id="reg-si" title={tip('SI', state.SI, true)}>{hex16(state.SI)}</span>
        </div>
        <div className="reg-row-single">
          <span className="reg-name-16">DI</span>
          <span className={`reg-box reg-box-16 ${changed('DI') ? 'changed' : ''}`} id="reg-di" title={tip('DI', state.DI, true)}>{hex16(state.DI)}</span>
        </div>
      </div>

      <div className="sidebar-divider" />

      {/* IP, DS, SS, CS */}
      <div className="reg-single-col">
        <div className="reg-row-single">
          <span className="reg-name-16">IP</span>
          <span className={`reg-box reg-box-16 ${changed('IP') ? 'changed' : ''}`} id="reg-ip" title={tip('IP', state.IP, true)}>{hex16(state.IP)}</span>
        </div>
        <div className="reg-row-single">
          <span className="reg-name-16">DS</span>
          <span className={`reg-box reg-box-16 ${changed('DS') ? 'changed' : ''}`} id="reg-ds" title={tip('DS', state.DS, true)}>{hex16(state.DS)}</span>
        </div>
        <div className="reg-row-single">
          <span className="reg-name-16">SS</span>
          <span className={`reg-box reg-box-16 ${changed('SS') ? 'changed' : ''}`} id="reg-ss" title={tip('SS', state.SS, true)}>{hex16(state.SS)}</span>
        </div>
        <div className="reg-row-single">
          <span className="reg-name-16">CS</span>
          <span className={`reg-box reg-box-16 ${changed('CS') ? 'changed' : ''}`} id="reg-cs" title={tip('CS', state.CS, true)}>{hex16(state.CS)}</span>
        </div>
      </div>
    </div>
  );
}
