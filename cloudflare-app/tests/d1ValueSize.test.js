import test from "node:test";
import assert from "node:assert/strict";
import { FREE_TIER_BUDGET } from "../src/freeTierBudget.js";
import {
  D1ValueTooLongError,
  assertD1ValuePayloadWithinLimit,
  d1ValueByteLength,
  isD1ValuePayloadWithinLimit
} from "../src/platform/d1/valueSize.js";

test("D1 payload guard는 UTF-8 bytes로 1.9MB 안전 상한을 적용한다", () => {
  const atLimit = "a".repeat(FREE_TIER_BUDGET.maxD1ValuePayloadBytes);
  assert.equal(d1ValueByteLength(atLimit), FREE_TIER_BUDGET.maxD1ValuePayloadBytes);
  assert.equal(isD1ValuePayloadWithinLimit(atLimit), true);
  assert.doesNotThrow(() => assertD1ValuePayloadWithinLimit(atLimit));
});

test("D1 payload guard는 2MB 플랫폼 오류 전에 구조화된 오류를 낸다", () => {
  const overLimit = `${"가".repeat(Math.floor(FREE_TIER_BUDGET.maxD1ValuePayloadBytes / 3))}가`;
  assert.equal(isD1ValuePayloadWithinLimit(overLimit), false);
  assert.throws(
    () => assertD1ValuePayloadWithinLimit(overLimit),
    (error) => error instanceof D1ValueTooLongError
      && error.code === "D1_VALUE_TOO_LONG"
      && error.byteLength > FREE_TIER_BUDGET.maxD1ValuePayloadBytes
  );
});
