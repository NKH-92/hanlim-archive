// FTS5 색인 본문 term 생성기. 검색 질의와 projection 쓰기가 함께 쓰는 순수 규칙이다.
import { sharedSearchCore } from "../../../searchCore.js";

export const normalizeSearchText = sharedSearchCore.normalizeSearchText;

export function buildSearchIndexTerms(value) {
  const normalized = normalizeSearchText(value);
  const terms = new Set();
  for (const token of normalized.split(/\s+/).filter(Boolean)) {
    if (token.length <= 2) {
      terms.add(token);
    } else {
      for (let index = 0; index < token.length - 1; index += 1) {
        terms.add(token.slice(index, index + 2));
      }
      for (let index = 0; index < token.length - 2; index += 1) {
        terms.add(token.slice(index, index + 3));
      }
    }
    const initials = hangulInitials(token);
    if (initials && initials !== token) terms.add(initials);
  }
  return [...terms].filter((term) => term && !/["'*:()]/.test(term));
}

function hangulInitials(value) {
  const initials = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
  let output = "";
  for (const character of value) {
    const code = character.charCodeAt(0) - 0xac00;
    output += code >= 0 && code <= 11171 ? initials[Math.floor(code / 588)] : character;
  }
  return output;
}
