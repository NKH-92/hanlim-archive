// 검색 코어: 서버(data/searchData.js)와 브라우저(즉시 검색)가 같은 코드를 쓴다.
// createSearchCore는 외부 스코프를 참조하지 않는 완전 독립 팩토리여야 한다.
// 클라이언트에는 views/clientScript.js가 createSearchCore.toString()으로 소스를 그대로 내려보낸다.
export function createSearchCore() {
  function clean(value) {
    return String(value ?? "").trim();
  }

  function normalizeSearchText(value) {
    return clean(value).normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
  }

  function compactSearchText(value) {
    return normalizeSearchText(value).replace(/[\s\-_/.,:;()[\]{}]+/g, "");
  }

  function searchTokens(value) {
    const normalized = normalizeSearchText(value);
    const compacted = compactSearchText(value);
    const tokens = normalized
      .split(/[\s\-_/.,:;()[\]{}]+/)
      .map((token) => token.trim())
      .filter(Boolean);

    if (compacted && !tokens.includes(compacted)) {
      tokens.push(compacted);
    }

    return [...new Set(tokens)].slice(0, 8);
  }

  function levenshteinDistance(left, right) {
    const a = Array.from(compactSearchText(left));
    const b = Array.from(compactSearchText(right));

    if (!a.length) return b.length;
    if (!b.length) return a.length;

    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    let current = Array.from({ length: b.length + 1 }, () => 0);

    for (let i = 1; i <= a.length; i += 1) {
      current[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      }
      // splice 복사 대신 행 버퍼만 교환한다(오타 허용 스코어링 핫패스).
      const swap = previous;
      previous = current;
      current = swap;
    }

    return previous[b.length];
  }

  // ---- 한글 자모 데이터 (두벌식) ----
  const CHOSEONG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
  const JUNGSEONG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"];
  const JONGSEONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
  const QWERTY_TO_JAMO = {
    q: "ㅂ", Q: "ㅃ", w: "ㅈ", W: "ㅉ", e: "ㄷ", E: "ㄸ", r: "ㄱ", R: "ㄲ", t: "ㅅ", T: "ㅆ",
    y: "ㅛ", u: "ㅕ", i: "ㅑ", o: "ㅐ", O: "ㅒ", p: "ㅔ", P: "ㅖ",
    a: "ㅁ", s: "ㄴ", d: "ㅇ", f: "ㄹ", g: "ㅎ", h: "ㅗ", j: "ㅓ", k: "ㅏ", l: "ㅣ",
    z: "ㅋ", x: "ㅌ", c: "ㅊ", v: "ㅍ", b: "ㅠ", n: "ㅜ", m: "ㅡ"
  };
  const JAMO_TO_QWERTY = {
    "ㅂ": "q", "ㅃ": "q", "ㅈ": "w", "ㅉ": "w", "ㄷ": "e", "ㄸ": "e", "ㄱ": "r", "ㄲ": "r", "ㅅ": "t", "ㅆ": "t",
    "ㅛ": "y", "ㅕ": "u", "ㅑ": "i", "ㅐ": "o", "ㅒ": "o", "ㅔ": "p", "ㅖ": "p",
    "ㅁ": "a", "ㄴ": "s", "ㅇ": "d", "ㄹ": "f", "ㅎ": "g", "ㅗ": "h", "ㅓ": "j", "ㅏ": "k", "ㅣ": "l",
    "ㅋ": "z", "ㅌ": "x", "ㅊ": "c", "ㅍ": "v", "ㅠ": "b", "ㅜ": "n", "ㅡ": "m",
    "ㅘ": "hk", "ㅙ": "ho", "ㅚ": "hl", "ㅝ": "nj", "ㅞ": "np", "ㅟ": "nl", "ㅢ": "ml",
    "ㄳ": "rt", "ㄵ": "sw", "ㄶ": "sg", "ㄺ": "fr", "ㄻ": "fa", "ㄼ": "fq", "ㄽ": "ft", "ㄾ": "fx", "ㄿ": "fv", "ㅀ": "fg", "ㅄ": "qt"
  };
  const VOWEL_COMBOS = { "ㅗㅏ": "ㅘ", "ㅗㅐ": "ㅙ", "ㅗㅣ": "ㅚ", "ㅜㅓ": "ㅝ", "ㅜㅔ": "ㅞ", "ㅜㅣ": "ㅟ", "ㅡㅣ": "ㅢ" };
  const JONG_COMBOS = { "ㄱㅅ": "ㄳ", "ㄴㅈ": "ㄵ", "ㄴㅎ": "ㄶ", "ㄹㄱ": "ㄺ", "ㄹㅁ": "ㄻ", "ㄹㅂ": "ㄼ", "ㄹㅅ": "ㄽ", "ㄹㅌ": "ㄾ", "ㄹㅍ": "ㄿ", "ㄹㅎ": "ㅀ", "ㅂㅅ": "ㅄ" };
  const JONG_SPLIT = { "ㄳ": ["ㄱ", "ㅅ"], "ㄵ": ["ㄴ", "ㅈ"], "ㄶ": ["ㄴ", "ㅎ"], "ㄺ": ["ㄹ", "ㄱ"], "ㄻ": ["ㄹ", "ㅁ"], "ㄼ": ["ㄹ", "ㅂ"], "ㄽ": ["ㄹ", "ㅅ"], "ㄾ": ["ㄹ", "ㅌ"], "ㄿ": ["ㄹ", "ㅍ"], "ㅀ": ["ㄹ", "ㅎ"], "ㅄ": ["ㅂ", "ㅅ"] };

  // NFKC 정규화(normalizeSearchText)는 호환 자모를 조합형(U+1100대)으로 바꾼다.
  // 초성·자판 판정은 호환 자모 기준이므로 비교 전에 되돌린다.
  function compatJamo(text) {
    let result = "";
    for (const char of String(text ?? "")) {
      const code = char.charCodeAt(0);
      if (code >= 0x1100 && code <= 0x1112) {
        result += CHOSEONG[code - 0x1100];
      } else if (code >= 0x1161 && code <= 0x1175) {
        result += JUNGSEONG[code - 0x1161];
      } else if (code >= 0x11a8 && code <= 0x11c2) {
        result += JONGSEONG[code - 0x11a7];
      } else {
        result += char;
      }
    }
    return result;
  }

  function isHangulVowelJamo(jamo) {
    const code = jamo.charCodeAt(0);
    return code >= 0x314f && code <= 0x3163;
  }

  function isHangulConsonantJamo(jamo) {
    const code = jamo.charCodeAt(0);
    return code >= 0x3131 && code <= 0x314e;
  }

  function composeSyllable(cho, jung, jong) {
    const choIndex = CHOSEONG.indexOf(cho);
    const jungIndex = JUNGSEONG.indexOf(jung);
    const jongIndex = JONGSEONG.indexOf(jong || "");
    if (choIndex < 0 || jungIndex < 0 || jongIndex < 0) return null;
    return String.fromCharCode(0xac00 + choIndex * 588 + jungIndex * 28 + jongIndex);
  }

  // "vmfhwprxm" 같은 한영 전환 실수를 두벌식 규칙으로 한글로 되살린다.
  function qwertyToHangul(text) {
    const jamos = [];
    for (const char of String(text ?? "")) {
      const upper = QWERTY_TO_JAMO[char];
      const lower = QWERTY_TO_JAMO[char.toLowerCase()];
      jamos.push(upper || lower || char);
    }

    let result = "";
    let cho = "";
    let jung = "";
    let jong = "";

    const flush = () => {
      if (cho && jung) {
        result += composeSyllable(cho, jung, jong) || cho + jung + jong;
      } else {
        result += cho + jung + jong;
      }
      cho = "";
      jung = "";
      jong = "";
    };

    for (const jamo of jamos) {
      if (isHangulConsonantJamo(jamo)) {
        if (!cho) {
          cho = jamo;
        } else if (!jung) {
          flush();
          cho = jamo;
        } else if (!jong && JONGSEONG.includes(jamo)) {
          jong = jamo;
        } else if (jong && JONG_COMBOS[jong + jamo]) {
          jong = JONG_COMBOS[jong + jamo];
        } else {
          flush();
          cho = jamo;
        }
      } else if (isHangulVowelJamo(jamo)) {
        if (jong) {
          const split = JONG_SPLIT[jong];
          const carried = split ? split[1] : jong;
          jong = split ? split[0] : "";
          flush();
          cho = carried;
          jung = jamo;
        } else if (jung && VOWEL_COMBOS[jung + jamo]) {
          jung = VOWEL_COMBOS[jung + jamo];
        } else if (jung) {
          flush();
          jung = jamo;
        } else {
          jung = jamo;
        }
      } else {
        flush();
        result += jamo;
      }
    }
    flush();
    return result;
  }

  // 반대 방향: 한글 IME 상태로 영문 코드를 친 경우("ㅔㅍ" → "pv")를 되살린다.
  function hangulToQwerty(text) {
    let result = "";
    for (const char of compatJamo(String(text ?? ""))) {
      const code = char.charCodeAt(0);
      if (code >= 0xac00 && code <= 0xd7a3) {
        const offset = code - 0xac00;
        const cho = CHOSEONG[Math.floor(offset / 588)];
        const jung = JUNGSEONG[Math.floor((offset % 588) / 28)];
        const jong = JONGSEONG[offset % 28];
        result += (JAMO_TO_QWERTY[cho] || "") + (JAMO_TO_QWERTY[jung] || "") + (jong ? JAMO_TO_QWERTY[jong] || "" : "");
      } else {
        result += JAMO_TO_QWERTY[char] || char;
      }
    }
    return result;
  }

  // "ㅈㅈㄱㄹㅅ" → 제조기록서를 찾도록 문자열의 초성만 추출한다.
  function chosungOf(value) {
    let result = "";
    for (const char of compatJamo(compactSearchText(value))) {
      const code = char.charCodeAt(0);
      if (code >= 0xac00 && code <= 0xd7a3) {
        result += CHOSEONG[Math.floor((code - 0xac00) / 588)];
      } else if (code >= 0x3131 && code <= 0x314e) {
        result += char;
      }
    }
    return result;
  }

  function isChosungToken(token) {
    const compat = compatJamo(String(token ?? ""));
    return compat.length >= 2 && /^[ㄱ-ㅎ]+$/.test(compat);
  }

  function isCloseMatch(token, value) {
    const compactToken = compactSearchText(token);
    const compactValue = compactSearchText(value);

    if (compactToken.length < 3 || compactValue.length < 3) {
      return false;
    }
    if (compactValue.includes(compactToken)) {
      return true;
    }

    const maxDistance = compactToken.length <= 5 ? 1 : 2;
    if (Math.abs(compactToken.length - compactValue.length) <= maxDistance &&
        levenshteinDistance(compactToken, compactValue) <= maxDistance) {
      return true;
    }

    return normalizeSearchText(value)
      .split(/[\s\-_/.,:;()[\]{}]+/)
      .filter(Boolean)
      .some((chunk) => {
        const compactChunk = compactSearchText(chunk);
        return Math.abs(compactChunk.length - compactToken.length) <= maxDistance &&
          levenshteinDistance(compactToken, compactChunk) <= maxDistance;
      });
  }

  // 랙 면 표기: 단면 랙은 "13", 양면 랙은 "13-1"(A면)/"13-2"(B면). utils.rackFaceLabel과 같은 규칙.
  function rackFaceLabel(document) {
    const rackNumber = Number(document.rack_number || 0);
    if (!rackNumber) {
      return "";
    }
    const single = document.is_single_sided === 1 || document.is_single_sided === true || document.is_single_sided === "1";
    if (single) {
      return String(rackNumber);
    }
    return rackNumber + "-" + (document.rack_face === "B" ? 2 : 1);
  }

  function documentLocationText(document) {
    const zone = document.zone_number ? `${document.zone_number}구역` : "";
    const face = rackFaceLabel(document);
    const rack = face ? `${face}번 랙` : document.rack_code || "";
    const column = document.column_number ? `${document.column_number}열` : "";
    const shelf = document.shelf_number ? `${document.shelf_number}선반` : document.slot_code ? `칸 ${document.slot_code}` : "";
    return [zone, rack, column, shelf].filter(Boolean).join(" ");
  }

  function searchFields(document) {
    const location = documentLocationText(document);
    const faceLabel = rackFaceLabel(document);
    const locationAliases = [
      location,
      document.rack_code,
      document.zone_number ? `${document.zone_number}구역` : "",
      document.rack_number ? `${document.rack_number}랙 ${document.rack_number}번랙 ${document.rack_number}번 랙` : "",
      faceLabel,
      document.column_number ? `${document.column_number}열` : "",
      document.shelf_number ? `${document.shelf_number}선반 ${document.shelf_number}행 ${document.shelf_number}칸` : "",
      // 과거 표기(A면/B면) 검색 습관도 계속 받아준다.
      document.rack_face ? `${document.rack_face}면` : ""
    ].filter(Boolean).join(" ");
    return [
      { label: "문서번호", value: document.document_number, weight: 120 },
      { label: "문서명", value: document.document_name, weight: 110 },
      { label: "개정번호", value: document.revision_number, weight: 55 },
      { label: "대분류", value: document.category_name, weight: 65 },
      { label: "태그", value: document.tag_names, weight: 50 },
      { label: "랙 위치", value: locationAliases, weight: 75 },
      { label: "비고", value: document.note, weight: 30 }
    ];
  }

  function scoreField(token, field) {
    const value = normalizeSearchText(field.value);
    const compactValue = compactSearchText(field.value);
    const compactToken = compactSearchText(token);

    if (!compactToken || !compactValue) return null;
    if (compactValue === compactToken) return { score: field.weight + 120, reason: `${field.label} 정확히 일치` };
    if (compactValue.startsWith(compactToken)) return { score: field.weight + 80, reason: `${field.label} 앞부분 일치` };
    if (compactValue.includes(compactToken) || value.includes(normalizeSearchText(token))) {
      return { score: field.weight + 45, reason: `${field.label} 부분 일치` };
    }
    if (isCloseMatch(token, field.value)) return { score: field.weight + 20, reason: `${field.label} 유사 일치` };
    return null;
  }

  function scoreChosungField(token, field) {
    const target = chosungOf(field.value);
    if (!target || target.length < token.length) return null;
    if (target === token) return { score: field.weight + 70, reason: `${field.label} 초성 일치` };
    if (target.startsWith(token)) return { score: field.weight + 45, reason: `${field.label} 초성 일치` };
    if (token.length >= 3 && target.includes(token)) return { score: field.weight + 25, reason: `${field.label} 초성 일치` };
    return null;
  }

  function tokenVariants(token) {
    const variants = [{ value: token, penalty: 0, note: "" }];
    if (/^[a-z0-9]+$/.test(token) && /[a-z]/.test(token)) {
      const converted = compactSearchText(qwertyToHangul(token));
      if (converted && converted !== token && /[가-힣]/.test(converted)) {
        variants.push({ value: converted, penalty: 12, note: "한/영 자판 보정" });
      }
    } else if (/^[가-힣ㄱ-ㅎㅏ-ㅣ]+$/.test(compatJamo(token)) && !isChosungToken(token)) {
      const converted = compactSearchText(hangulToQwerty(token));
      if (converted && converted !== token) {
        variants.push({ value: converted, penalty: 12, note: "한/영 자판 보정" });
      }
    }
    return variants;
  }

  function bestFieldScore(token, fields) {
    let best = null;

    if (isChosungToken(token)) {
      const compatToken = compatJamo(token);
      for (const field of fields) {
        const scored = scoreChosungField(compatToken, field);
        if (scored && (!best || scored.score > best.score)) best = scored;
      }
      return best;
    }

    for (const variant of tokenVariants(token)) {
      for (const field of fields) {
        const scored = scoreField(variant.value, field);
        if (!scored) continue;
        const adjusted = {
          score: scored.score - variant.penalty,
          reason: variant.note ? `${scored.reason}(${variant.note})` : scored.reason
        };
        if (!best || adjusted.score > best.score) best = adjusted;
      }
    }
    return best;
  }

  function scoreDocumentMatch(document, query, options = {}) {
    // 동일 검색어로 여러 문서를 채점할 때 토큰을 호출자가 한 번만 계산해 재사용할 수 있다.
    const tokens = Array.isArray(options.tokens) ? options.tokens : searchTokens(query);
    if (!tokens.length) {
      return { relevance_score: 0, match_reason: "전체 목록" };
    }

    let score = 0;
    let matchedTokens = 0;
    const reasons = [];
    const fields = searchFields(document);

    for (const token of tokens) {
      const best = bestFieldScore(token, fields);
      if (best) {
        matchedTokens += 1;
        score += best.score;
        reasons.push(best.reason);
      }
    }

    const minCoverage = Number.isFinite(options.minCoverage) ? options.minCoverage : 0.5;
    const coverage = matchedTokens / tokens.length;
    if (coverage < minCoverage || matchedTokens === 0) {
      return { relevance_score: 0, match_reason: "" };
    }

    return {
      relevance_score: Math.round(score * coverage + matchedTokens * 12),
      match_reason: [...new Set(reasons)].slice(0, 2).join(", ")
    };
  }

  function compareByText(left, right, field) {
    return normalizeSearchText(left[field]).localeCompare(normalizeSearchText(right[field]), "ko");
  }

  function compareByLocation(left, right) {
    return (Number(left.zone_number || 0) - Number(right.zone_number || 0)) ||
      (Number(left.rack_number || 0) - Number(right.rack_number || 0)) ||
      (Number(left.column_number || 0) - Number(right.column_number || 0)) ||
      (Number(left.shelf_number || 0) - Number(right.shelf_number || 0)) ||
      normalizeSearchText(left.rack_face).localeCompare(normalizeSearchText(right.rack_face), "ko") ||
      compareByText(left, right, "document_number");
  }

  function compareSearchResults(left, right, sort, hasQuery) {
    switch (sort) {
      case "updated":
        return normalizeSearchText(right.updated_at).localeCompare(normalizeSearchText(left.updated_at)) ||
          Number(right.id || 0) - Number(left.id || 0);
      case "docnum":
        return compareByText(left, right, "document_number") || compareByText(left, right, "revision_number");
      case "category":
        return compareByText(left, right, "category_name") || compareByText(left, right, "document_number");
      case "location":
        return compareByLocation(left, right);
      case "relevance":
      default:
        if (hasQuery) {
          return Number(right.relevance_score || 0) - Number(left.relevance_score || 0) ||
            normalizeSearchText(right.updated_at).localeCompare(normalizeSearchText(left.updated_at)) ||
            Number(right.id || 0) - Number(left.id || 0);
        }
        return normalizeSearchText(right.updated_at).localeCompare(normalizeSearchText(left.updated_at)) ||
          Number(right.id || 0) - Number(left.id || 0);
    }
  }

  // "2구역 PV 폐기" → 구역/대분류/태그/상태 필터 + 남은 검색어로 분해한다.
  // 명시 필터(explicit)가 이미 있으면 해당 유형은 텍스트로 남긴다.
  function parseSearchQuery(query, context = {}) {
    const raw = clean(query);
    if (!raw) {
      return { text: "", filters: {}, chips: [] };
    }

    const categories = context.categories || [];
    const tags = context.tags || [];
    const explicit = context.explicit || {};
    const filters = {};
    const chips = [];
    const remaining = [];

    for (const part of raw.split(/\s+/)) {
      const zoneMatch = part.match(/^(\d{1,2})구역$/);
      if (zoneMatch && !filters.zoneNumber && !explicit.zoneNumber) {
        filters.zoneNumber = Number(zoneMatch[1]);
        chips.push({ type: "zone", label: `${filters.zoneNumber}구역`, value: filters.zoneNumber, token: part });
        continue;
      }
      if ((part === "폐기" || part === "폐기문서") && !filters.status && !explicit.status) {
        filters.status = "disposed";
        chips.push({ type: "status", label: "폐기", value: "disposed", token: part });
        continue;
      }
      if (part === "보관중" && !filters.status && !explicit.status) {
        filters.status = "active";
        chips.push({ type: "status", label: "보관중", value: "active", token: part });
        continue;
      }

      const compactPart = compactSearchText(part);
      const category = categories.find((item) => compactSearchText(item.name) === compactPart);
      if (category && !filters.categoryId && !explicit.categoryId) {
        filters.categoryId = Number(category.id);
        chips.push({ type: "category", label: clean(category.name), value: filters.categoryId, token: part });
        continue;
      }

      const tag = tags.find((item) => compactSearchText(item.name) === compactPart);
      if (tag && !filters.tagId && !explicit.tagId) {
        filters.tagId = Number(tag.id);
        chips.push({ type: "tag", label: clean(tag.name), value: filters.tagId, token: part });
        continue;
      }

      remaining.push(part);
    }

    return { text: remaining.join(" "), filters, chips };
  }

  // 검색어와 겹치는 부분을 <mark>로 감싼 HTML을 만든다. escapeFn은 호출자가 주입한다.
  function highlightHtml(text, query, escapeFn) {
    const value = String(text ?? "");
    if (!value) return "";
    const escape = escapeFn || ((input) => input);
    const tokens = searchTokens(query).filter((token) => !isChosungToken(token) && token.length >= 1);
    if (!tokens.length) return escape(value);

    const lower = value.toLowerCase();
    const ranges = [];
    for (const token of tokens) {
      let index = 0;
      while ((index = lower.indexOf(token, index)) !== -1) {
        ranges.push([index, index + token.length]);
        index += token.length;
      }
    }
    if (!ranges.length) return escape(value);

    ranges.sort((left, right) => left[0] - right[0]);
    const merged = [];
    for (const range of ranges) {
      const last = merged[merged.length - 1];
      if (last && range[0] <= last[1]) {
        last[1] = Math.max(last[1], range[1]);
      } else {
        merged.push([range[0], range[1]]);
      }
    }

    let html = "";
    let position = 0;
    for (const [start, end] of merged) {
      html += escape(value.slice(position, start)) + "<mark>" + escape(value.slice(start, end)) + "</mark>";
      position = end;
    }
    html += escape(value.slice(position));
    return html;
  }

  // 같은 검색어에서 자주 클릭된 문서를 끌어올린다(검색어별 학습).
  function clickBoost(hits) {
    return Math.min(Math.max(Number(hits) || 0, 0), 12) * 6;
  }

  // 전체 클릭 인기도는 약하게만 반영한다(즉시 검색 인덱스용).
  function popularityBoost(count) {
    return Math.min(Math.max(Number(count) || 0, 0), 20) * 2;
  }

  return {
    clean,
    normalizeSearchText,
    compactSearchText,
    searchTokens,
    levenshteinDistance,
    chosungOf,
    isChosungToken,
    qwertyToHangul,
    hangulToQwerty,
    rackFaceLabel,
    documentLocationText,
    scoreDocumentMatch,
    compareSearchResults,
    parseSearchQuery,
    highlightHtml,
    clickBoost,
    popularityBoost
  };
}

// 서버 공용 인스턴스. 서버 코드는 이 인스턴스를 공유하고,
// 브라우저는 searchCoreScript()가 팩토리 소스를 내려보내 따로 생성한다.
export const sharedSearchCore = createSearchCore();
