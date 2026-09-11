// Memory model for the 8086 emulator

// 8086 has a 20-bit address space (1MB = 2^20 bytes)
export const MEMORY_SIZE = 1024 * 1024; // 1,048,576 bytes

// Segment:offset addressing - physical address is computed as
// physical = (segment << 4) + offset
export function physicalAddress(segment: number, offset: number): number {
  return ((segment << 4) + offset) & 0xfffff;
}

// Convert a physical address to segment:offset form (for display/debugging)
export function segmentOffset(address: number): { segment: number; offset: number } {
  const segment = Math.floor(address / 16);
  const offset = address % 16;
  return { segment, offset };
}

// Memory class - backed by a 1MB array
export class Memory {
  private readonly data: number[] = new Array(MEMORY_SIZE);

  constructor() {
    // Initialize to zeros
    this.data.fill(0);
  }

  // Read a byte at a physical address
  read8(address: number): number {
    this.validateAddress(address);
    return this.data[address] || 0;
  }

  // Read a word at a physical address (little-endian)
  read16(address: number): number {
    this.validateAddress(address);
    this.validateAddress(address + 1);
    return (this.data[address] | (this.data[address + 1] << 8)) & 0xffff;
  }

  // Write a byte to a physical address
  write8(address: number, value: number): void {
    this.validateAddress(address);
    this.data[address] = value & 0xff;
  }

  // Write a word to a physical address (little-endian)
  write16(address: number, value: number): void {
    this.validateAddress(address);
    this.validateAddress(address + 1);
    this.data[address] = value & 0xff;
    this.data[address + 1] = (value >>> 8) & 0xff;
  }

  // Read a byte at a segment:offset address
  readSegment(segment: number, offset: number): number {
    return this.read8(physicalAddress(segment, offset));
  }

  // Write a byte at a segment:offset address
  writeSegment(segment: number, offset: number, value: number): void {
    this.write8(physicalAddress(segment, offset), value);
  }

  // Read a word at a segment:offset address
  readSegment16(segment: number, offset: number): number {
    return this.read16(physicalAddress(segment, offset));
  }

  // Write a word at a segment:offset address
  writeSegment16(segment: number, offset: number, value: number): void {
    this.write16(physicalAddress(segment, offset), value);
  }

  // Fill the memory with a specific value
  clear(): void {
    this.data.fill(0);
  }

  // Get the underlying array (for testing/debugging)
  getData(): readonly number[] {
    return this.data;
  }

  private validateAddress(address: number): void {
    if (address < 0 || address >= MEMORY_SIZE) {
      throw new Error(`Address out of range: ${address} (max ${MEMORY_SIZE - 1})`);
    }
  }
}

// Convenience function for creating a memory instance
export function createMemory(): Memory {
  return new Memory();
}