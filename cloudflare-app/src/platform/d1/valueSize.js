import { FREE_TIER_BUDGET } from "../../freeTierBudget.js";

export class D1ValueTooLongError extends RangeError {
  constructor(byteLength) {
    super(
      `D1 value payload ${byteLength} bytes exceeds safe limit `
      + `${FREE_TIER_BUDGET.maxD1ValuePayloadBytes} bytes`
    );
    this.name = "D1ValueTooLongError";
    this.code = "D1_VALUE_TOO_LONG";
    this.byteLength = byteLength;
  }
}

export function d1ValueByteLength(value) {
  return new TextEncoder().encode(String(value ?? "")).byteLength;
}

export function isD1ValuePayloadWithinLimit(value) {
  return d1ValueByteLength(value) <= FREE_TIER_BUDGET.maxD1ValuePayloadBytes;
}

export function assertD1ValuePayloadWithinLimit(value) {
  const byteLength = d1ValueByteLength(value);
  if (byteLength > FREE_TIER_BUDGET.maxD1ValuePayloadBytes) {
    throw new D1ValueTooLongError(byteLength);
  }
}
