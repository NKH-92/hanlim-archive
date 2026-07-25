import test from "node:test";
import assert from "node:assert/strict";
import {
  D1LikePatternTooLongError,
  d1ContainsPattern
} from "../src/platform/d1/likePattern.js";

test("D1 contains pattern은 ASCII 48자와 한글 16자를 50 bytes 안에서 허용한다", () => {
  assert.equal(new TextEncoder().encode(d1ContainsPattern("a".repeat(48))).byteLength, 50);
  assert.equal(new TextEncoder().encode(d1ContainsPattern("가".repeat(16))).byteLength, 50);
});

test("D1 contains pattern은 D1의 50-byte 상한을 넘기 전에 명확한 400 오류를 낸다", () => {
  for (const query of ["a".repeat(49), "가".repeat(17)]) {
    assert.throws(
      () => d1ContainsPattern(query),
      (error) => error instanceof D1LikePatternTooLongError
        && error.code === "D1_LIKE_PATTERN_TOO_LONG"
        && error.status === 400
    );
  }
});

test("D1 contains pattern은 wildcard 문자를 literal로 escape하고 escape bytes도 계산한다", () => {
  assert.equal(d1ContainsPattern("A%_\\B"), "%A\\%\\_\\\\B%");
  assert.throws(() => d1ContainsPattern("%".repeat(25)), D1LikePatternTooLongError);
});
