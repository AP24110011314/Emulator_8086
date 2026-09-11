import React from 'react';
import { CPUState } from '../core/types';

interface RegisterPanelProps {
  cpuState: CPUState | null;
  prevState: CPUState | null;
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

export function RegisterPanel({ cpuState, prevState }: RegisterPanelProps) {
  const state = cpuState ?? DEFAULT_STATE;

  const changed = (key: keyof CPUState) => {
    if (!cpuState || !prevState) return false;
    return cpuState[key] !== prevState[key];
  };

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
    <div className="sidebar-section reg-section">
      <div className="sidebar-section-header">REGISTERS</div>

      {/* General Purpose rows: AX AH AL etc. */}
      <div className="reg-gp-table">
        {/* AX */}
        <div className="reg-row-gp">
          <span className="reg-name-16">AX</span>
          <span className={`reg-box reg-box-16 ${changed('AX') ? 'changed' : ''}`} id="reg-ax">{hex16(state.AX)}</span>
          <span className="reg-name-8">AH</span>
          <span className={`reg-box reg-box-8 ${ah !== prevAH ? 'changed' : ''}`} id="reg-ah">{hex8(ah)}</span>
          <span className="reg-name-8">AL</span>
          <span className={`reg-box reg-box-8 ${al !== prevAL ? 'changed' : ''}`} id="reg-al">{hex8(al)}</span>
        </div>

        {/* BX */}
        <div className="reg-row-gp">
          <span className="reg-name-16">BX</span>
          <span className={`reg-box reg-box-16 ${changed('BX') ? 'changed' : ''}`} id="reg-bx">{hex16(state.BX)}</span>
          <span className="reg-name-8">BH</span>
          <span className={`reg-box reg-box-8 ${bh !== prevBH ? 'changed' : ''}`} id="reg-bh">{hex8(bh)}</span>
          <span className="reg-name-8">BL</span>
          <span className={`reg-box reg-box-8 ${bl !== prevBL ? 'changed' : ''}`} id="reg-bl">{hex8(bl)}</span>
        </div>

        {/* CX */}
        <div className="reg-row-gp">
          <span className="reg-name-16">CX</span>
          <span className={`reg-box reg-box-16 ${changed('CX') ? 'changed' : ''}`} id="reg-cx">{hex16(state.CX)}</span>
          <span className="reg-name-8">CH</span>
          <span className={`reg-box reg-box-8 ${ch !== prevCH ? 'changed' : ''}`} id="reg-ch">{hex8(ch)}</span>
          <span className="reg-name-8">CL</span>
          <span className={`reg-box reg-box-8 ${cl !== prevCL ? 'changed' : ''}`} id="reg-cl">{hex8(cl)}</span>
        </div>

        {/* DX */}
        <div className="reg-row-gp">
          <span className="reg-name-16">DX</span>
          <span className={`reg-box reg-box-16 ${changed('DX') ? 'changed' : ''}`} id="reg-dx">{hex16(state.DX)}</span>
          <span className="reg-name-8">DH</span>
          <span className={`reg-box reg-box-8 ${dh !== prevDH ? 'changed' : ''}`} id="reg-dh">{hex8(dh)}</span>
          <span className="reg-name-8">DL</span>
          <span className={`reg-box reg-box-8 ${dl !== prevDL ? 'changed' : ''}`} id="reg-dl">{hex8(dl)}</span>
        </div>
      </div>

      <div className="sidebar-divider" />

      {/* Pointer & Index: SP, BP, SI, DI */}
      <div className="reg-single-col">
        <div className="reg-row-single">
          <span className="reg-name-16">SP</span>
          <span className={`reg-box reg-box-16 ${changed('SP') ? 'changed' : ''}`} id="reg-sp">{hex16(state.SP)}</span>
        </div>
        <div className="reg-row-single">
          <span className="reg-name-16">BP</span>
          <span className={`reg-box reg-box-16 ${changed('BP') ? 'changed' : ''}`} id="reg-bp">{hex16(state.BP)}</span>
        </div>
        <div className="reg-row-single">
          <span className="reg-name-16">SI</span>
          <span className={`reg-box reg-box-16 ${changed('SI') ? 'changed' : ''}`} id="reg-si">{hex16(state.SI)}</span>
        </div>
        <div className="reg-row-single">
          <span className="reg-name-16">DI</span>
          <span className={`reg-box reg-box-16 ${changed('DI') ? 'changed' : ''}`} id="reg-di">{hex16(state.DI)}</span>
        </div>
      </div>

      <div className="sidebar-divider" />

      {/* IP, DS, SS, CS */}
      <div className="reg-single-col">
        <div className="reg-row-single">
          <span className="reg-name-16">IP</span>
          <span className={`reg-box reg-box-16 ${changed('IP') ? 'changed' : ''}`} id="reg-ip">{hex16(state.IP)}</span>
        </div>
        <div className="reg-row-single">
          <span className="reg-name-16">DS</span>
          <span className={`reg-box reg-box-16 ${changed('DS') ? 'changed' : ''}`} id="reg-ds">{hex16(state.DS)}</span>
        </div>
        <div className="reg-row-single">
          <span className="reg-name-16">SS</span>
          <span className={`reg-box reg-box-16 ${changed('SS') ? 'changed' : ''}`} id="reg-ss">{hex16(state.SS)}</span>
        </div>
        <div className="reg-row-single">
          <span className="reg-name-16">CS</span>
          <span className={`reg-box reg-box-16 ${changed('CS') ? 'changed' : ''}`} id="reg-cs">{hex16(state.CS)}</span>
        </div>
      </div>
    </div>
  );
}
