import { describe, expect, it } from 'vitest';
import { Memory, MEMORY_SIZE, createMemory, physicalAddress, segmentOffset } from '../../src/core/memory';

describe('Memory', () => {
  it('should read and write bytes', () => {
    const memory = new Memory();
    memory.write8(0x100, 0xAB);
    expect(memory.read8(0x100)).toBe(0xAB);
    expect(memory.read8(0x101)).toBe(0);
  });

  it('should read and write words in little-endian order', () => {
    const memory = new Memory();
    memory.write16(0x100, 0x1234);
    expect(memory.read8(0x100)).toBe(0x34);
    expect(memory.read8(0x101)).toBe(0x12);
    expect(memory.read16(0x100)).toBe(0x1234);
  });

  it('should convert segment:offset to physical address', () => {
    expect(physicalAddress(0x1000, 0x0010)).toBe(0x10010);
    expect(physicalAddress(0x1234, 0x5678)).toBe(0x179B8);
  });

  it('should convert physical address to segment:offset', () => {
    // segment:offset decomposition is not unique — physicalAddress(0x1234,0x5678)=0x179B8.
    // The canonical form is segment = floor(addr/16), offset = addr%16.
    const result = segmentOffset(0x179B8);
    expect(result.segment).toBe(0x179B);
    expect(result.offset).toBe(0x8);

    // Also verify round-trip: physicalAddress of canonical form gives the same address
    expect(physicalAddress(result.segment, result.offset)).toBe(0x179B8);
  });

  it('should validate address range', () => {
    const memory = new Memory();
    expect(() => memory.read8(MEMORY_SIZE)).toThrow('Address out of range');
    expect(() => memory.write8(MEMORY_SIZE, 0x55)).toThrow('Address out of range');
  });
});
