// FTS5 색인 본문을 만드는 term 생성기.
//
// unicode61 tokenizer만으로는 한글 부분일치가 되지 않으므로 2·3-gram과 초성 term을 함께 넣는다.
// 이 계산은 JavaScript에만 존재한다. SQL trigger로 재현할 수 없으므로 색인 갱신은 항상
// 애플리케이션이 수행하고, trigger는 "재색인 대상 표시"만 담당한다.
//
// 검색 질의 쪽(searchData.js)과 색인 쓰기 쪽(domains/search/infrastructure/projection.js)이
// 같은 함수를 써야 하므로 두 계층이 함께 의존할 수 있는 leaf 모듈로 둔다.
import { sharedSearchCore } from "../searchCore.js";

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
