// 테스트 전용 D1 계측기. prepare 호출과 실제 단독 실행, batch 안의 statement 수를
// 분리해 기록하므로 요청별 내부 예산을 일관되게 검증할 수 있다.
export function createD1BudgetHarness(resolvers = {}) {
  const state = {
    prepareCalls: 0,
    directExecutions: 0,
    batchStatements: 0,
    batches: [],
    calls: []
  };

  const prepare = (sql) => {
    state.prepareCalls += 1;
    const statement = makeStatement(sql, []);
    return statement;
  };

  const makeStatement = (sql, args) => ({
    sql,
    args,
    bind(...nextArgs) {
      return makeStatement(sql, nextArgs);
    },
    async first() {
      state.directExecutions += 1;
      state.calls.push({ type: "first", sql, args });
      return resolvers.first?.(sql, args) ?? null;
    },
    async all() {
      state.directExecutions += 1;
      state.calls.push({ type: "all", sql, args });
      return { results: resolvers.all?.(sql, args) ?? [] };
    },
    async run() {
      state.directExecutions += 1;
      state.calls.push({ type: "run", sql, args });
      return { meta: { changes: resolvers.run?.(sql, args) ?? 1 } };
    }
  });

  return {
    state,
    DB: {
      prepare,
      async batch(statements) {
        state.batchStatements += statements.length;
        state.batches.push(statements.map(({ sql, args }) => ({ sql, args })));
        return resolvers.batch?.(statements) ?? statements.map(() => ({ meta: { changes: 1 } }));
      }
    }
  };
}

export function countD1Statements(state) {
  return Number(state?.directExecutions || 0) + Number(state?.batchStatements || 0);
}

export function hasLoopedD1Execution(state, expectedDirectExecutions) {
  return Number(state?.directExecutions || 0) > Number(expectedDirectExecutions || 0);
}
