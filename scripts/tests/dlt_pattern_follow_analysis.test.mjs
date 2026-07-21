import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RULES,
  activeCandidatesForTarget,
  buildEvents,
  diagonalCandidates,
  dynamicPrediction,
  dynamicQuality,
  fisherGreater,
  fuseDynamicScores,
  fuseScores,
  longGapCandidates,
  loadAllDraws,
  matchOutcomeBlindControls,
  nextIssue,
  passesGate,
  recentMetricsFromPairs,
  rollingDynamicBacktest,
  scaleDynamicWeights,
  selectDanDrag,
  standardizeRange,
  trialDecision,
} from '../dlt_pattern_follow_analysis.mjs';

function row(issue, reds, blues = [3, 8], omissions = {}) {
  return {
    issue,
    reds: [...reds].sort((a, b) => a - b),
    blues: [...blues].sort((a, b) => a - b),
    redOmissionBefore: Object.fromEntries(
      Array.from({ length: 35 }, (_, index) => [String(index + 1).padStart(2, '0'), omissions[index + 1] ?? 0]),
    ),
  };
}

test('斜连同时生成正向和反向延伸号码', () => {
  assert.deepEqual(diagonalCandidates([10], [9, 11]), [7, 8, 12, 13]);
});

test('斜连越界候选自动剔除', () => {
  assert.deepEqual(diagonalCandidates([1, 35], [2, 34]), [3, 4, 32, 33]);
});

test('长度10断区使用双中点四码', () => {
  assert.deepEqual(longGapCandidates([1, 9, 20, 25, 35]), [13, 14, 15, 16]);
});

test('长度11断区使用单中点三码', () => {
  assert.deepEqual(longGapCandidates([1, 9, 21, 26, 35]), [14, 15, 16]);
});

test('Fisher单侧检验保持0到1范围且优势表更显著', () => {
  const strong = fisherGreater(8, 2, 2, 8);
  const flat = fisherGreater(5, 5, 5, 5);
  assert.ok(strong >= 0 && strong < flat && flat <= 1);
});

test('连号衍生候选包含闭区间四码且同源期只构成一个事件', () => {
  const rows = [
    row(1, [5, 6, 10, 11, 30]),
    row(2, [1, 2, 3, 4, 5]),
    row(3, [31, 32, 33, 34, 35]),
  ];
  const events = buildEvents(RULES.CONSECUTIVE_DERIVED, rows);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].candidates, [4, 5, 6, 7, 9, 10, 11, 12]);
});

test('两期观察规则不会跨越分段边界借用开奖结果', () => {
  const rows = [
    row(1, [1, 3, 10, 20, 30]),
    row(2, [2, 8, 18, 28, 35]),
  ];
  assert.deepEqual(buildEvents(RULES.GAP_MIDDLE, rows), []);
});

test('冷号阈值严格为遗漏大于15', () => {
  const rows = [
    row(1, [5, 6, 20, 30, 35], [3, 8], { 5: 15, 6: 16 }),
    row(2, [1, 2, 3, 4, 7]),
    row(3, [6, 8, 9, 10, 11]),
  ];
  const events = buildEvents(RULES.COLD_LOW_REAPPEAR_T2, rows);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].candidates, [6]);
  assert.equal(events[0].success, true);
});

test('结果盲对照选择不受后续命中结果变化影响', () => {
  const original = [
    row(1, [1, 3, 10, 20, 30]),
    row(2, [4, 8, 12, 24, 35]),
    row(3, [2, 9, 16, 25, 33]),
    row(4, [5, 6, 13, 22, 31]),
    row(5, [7, 11, 17, 27, 34]),
    row(6, [14, 18, 21, 29, 32]),
  ];
  const eventsA = buildEvents(RULES.GAP_MIDDLE, original);
  const matchesA = matchOutcomeBlindControls(RULES.GAP_MIDDLE, original, eventsA);
  const changed = original.map((item, index) => (
    index >= 1 ? { ...item, reds: [...original[original.length - index].reds] } : item
  ));
  const eventsB = buildEvents(RULES.GAP_MIDDLE, changed);
  const matchesB = matchOutcomeBlindControls(RULES.GAP_MIDDLE, changed, eventsB);
  assert.deepEqual(
    matchesA.map(({ triggerIndex, controlIndex }) => [triggerIndex, controlIndex]),
    matchesB.map(({ triggerIndex, controlIndex }) => [triggerIndex, controlIndex]),
  );
});

test('严格门槛边界与失败条件', () => {
  const passing = {
    validation: { support: 5, accuracy: 0.5, lift: 0.1, fisherP: 0.049 },
    train: { lift: 0.01 },
  };
  assert.equal(passesGate(passing).passed, true);
  assert.equal(passesGate({ ...passing, validation: { ...passing.validation, support: 4 } }).passed, false);
  assert.equal(passesGate({ ...passing, validation: { ...passing.validation, accuracy: 0.499 } }).passed, false);
  assert.equal(passesGate({ ...passing, validation: { ...passing.validation, fisherP: 0.05 } }).passed, false);
  assert.equal(passesGate({ ...passing, train: { lift: 0 } }).passed, false);
});

test('目标期活动候选按事件观察偏移取源期', () => {
  const rows = [
    row(1, [1, 3, 10, 20, 30]),
    row(2, [4, 6, 11, 21, 31]),
  ];
  assert.deepEqual(activeCandidatesForTarget(RULES.GAP_MIDDLE, rows, 2), [2, 5]);
});

test('无有效规律时融合分保持归一化V2不变', () => {
  const base = new Map([[1, 2], [2, 4], [3, 3]]);
  const fused = fuseScores(base, []);
  assert.deepEqual([...fused.entries()], [[1, 0], [2, 1], [3, 0.5]]);
});

test('融合规律层固定最多占15%', () => {
  const base = new Map([[1, 0], [2, 10]]);
  const fused = fuseScores(base, [{ weight: 1, candidates: [1] }]);
  assert.equal(fused.get(1), 0.15);
  assert.equal(fused.get(2), 0.85);
});

test('3胆与8红分别执行上期重号上限', () => {
  const history = [row(1, [1, 2, 3, 4, 5])];
  const scores = new Map(Array.from({ length: 35 }, (_, index) => [index + 1, 100 - index]));
  const selected = selectDanDrag(scores, history);
  assert.ok(selected.dan.filter((number) => history[0].reds.includes(number)).length <= 1);
  assert.ok(selected.all.filter((number) => history[0].reds.includes(number)).length <= 2);
  assert.equal(selected.dan.length, 3);
  assert.equal(selected.drag.length, 5);
});

test('动态Beta(2,2)平滑按最近12和最近6次事件计算', () => {
  const pairs = [
    [1, 0], [1, 0], [1, 1], [0, 0],
    [1, 0], [0, 1], [1, 0], [1, 0],
  ].map(([triggerSuccess, controlSuccess], index) => ({
    triggerIndex: index,
    triggerSuccess: Boolean(triggerSuccess),
    controlSuccess: Boolean(controlSuccess),
  }));
  const metrics = recentMetricsFromPairs(pairs);
  assert.equal(metrics.n12, 8);
  assert.equal(metrics.a12, 8 / 12);
  assert.equal(metrics.c12, 4 / 12);
  assert.equal(metrics.l12, 4 / 12);
  assert.equal(metrics.n6, 6);
  assert.equal(metrics.a6, 6 / 10);
  assert.equal(metrics.c6, 4 / 10);
  assert.equal(metrics.consecutiveMisses, 0);
});

test('动态试用门槛边界全部满足才激活', () => {
  const metrics = {
    n12: 5,
    a12: 0.60,
    l12: 0.10,
    a6: 0.55,
    l6: 0.01,
    consecutiveMisses: 2,
  };
  assert.equal(trialDecision(metrics, [12]).passed, true);
  assert.equal(trialDecision({ ...metrics, n12: 4 }, [12]).passed, false);
  assert.equal(trialDecision({ ...metrics, a12: 0.599 }, [12]).passed, false);
  assert.equal(trialDecision({ ...metrics, l12: 0.099 }, [12]).passed, false);
  assert.equal(trialDecision({ ...metrics, a6: 0.549 }, [12]).passed, false);
  assert.equal(trialDecision({ ...metrics, l6: 0 }, [12]).passed, false);
  assert.equal(trialDecision({ ...metrics, consecutiveMisses: 3 }, [12]).passed, false);
  assert.equal(trialDecision(metrics, []).passed, false);
});

test('动态质量随短期趋势和连续失误下降', () => {
  const metrics = { n12: 12, a12: 0.75, l12: 0.25, a6: 0.75, consecutiveMisses: 0 };
  assert.ok(Math.abs(dynamicQuality(metrics) - 0.9) < 1e-12);
  assert.ok(Math.abs(dynamicQuality({ ...metrics, consecutiveMisses: 2 }) - 0.45) < 1e-12);
  assert.equal(dynamicQuality({ ...metrics, consecutiveMisses: 3 }), 0);
  assert.ok(dynamicQuality({ ...metrics, a6: 0.60 }) < dynamicQuality(metrics));
});

test('动态双层缩放满足试用5%和全部15%上限', () => {
  const states = [
    ...[1, 2, 3].map((number) => ({ id: `T${number}`, tier: 'TRIAL', quality: 1, candidates: [number] })),
    ...[4, 5, 6].map((number) => ({ id: `C${number}`, tier: 'CORE', quality: 1, candidates: [number] })),
  ];
  const weighted = scaleDynamicWeights(states);
  const trialTotal = weighted.filter((item) => item.tier === 'TRIAL').reduce((sum, item) => sum + item.weight, 0);
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  assert.ok(Math.abs(trialTotal - 0.05) < 1e-12);
  assert.ok(Math.abs(total - 0.15) < 1e-12);
  assert.ok(weighted.every((item) => item.weight >= 0));
});

test('动态融合使用绝对权重且未触发权重回退V2', () => {
  const base = new Map([[1, 0], [2, 10]]);
  assert.deepEqual([...fuseDynamicScores(base, []).entries()], [[1, 0], [2, 1]]);
  const fused = fuseDynamicScores(base, [{ id: 'T1', weight: 0.025, candidates: [1] }]);
  assert.equal(fused.get(1), 0.025);
  assert.equal(fused.get(2), 0.975);
});

test('动态预测无合格试用规律时完整回退V2', () => {
  const history = [
    row(1, [2, 7, 14, 24, 33]),
    row(2, [4, 9, 16, 26, 31]),
  ];
  const prediction = dynamicPrediction(history, history, []);
  assert.equal(prediction.totalRuleWeight, 0);
  assert.deepEqual(prediction.final.dan, prediction.baselineV2.dan);
  assert.deepEqual(prediction.final.all, prediction.baselineV2.all);
});

test('动态最近38期严格滚动行数和权重上限', () => {
  const draws = loadAllDraws();
  const rows = standardizeRange(draws);
  const rolling = rollingDynamicBacktest(draws, rows);
  assert.equal(rolling.rows.length, 38);
  assert.equal(rolling.range, '2026043-2026080');
  assert.equal(rolling.rows[0].issue, 2026043);
  assert.equal(rolling.rows.at(-1).issue, 2026080);
  assert.ok(rolling.rows.every((item) => item.ruleHistoryEnd < item.issue));
  assert.ok(rolling.rows.every((item) => item.trialWeight <= 0.05 + 1e-12));
  assert.ok(rolling.rows.every((item) => item.totalRuleWeight <= 0.15 + 1e-12));
  for (const model of ['baselineV2', 'dynamic']) {
    assert.equal(Object.values(rolling.diagnostics.repeatDistributions[model].dan).reduce((sum, value) => sum + value, 0), 38);
    assert.equal(Object.values(rolling.diagnostics.repeatDistributions[model].all).reduce((sum, value) => sum + value, 0), 38);
    assert.ok(rolling.diagnostics.repeatDistributions[model].maxDan <= 1);
    assert.ok(rolling.diagnostics.repeatDistributions[model].maxAll <= 2);
  }
});

test('新增开奖后目标期自动推导且规律时间线扩展但固定门槛范围不滑动', () => {
  const draws = loadAllDraws();
  const rows = standardizeRange(draws);
  assert.equal(draws.length, 230);
  assert.equal(draws.at(-1).issue, 2026080);
  assert.equal(nextIssue(draws.at(-1).issue), 2026081);
  assert.equal(rows.length, 101);
  assert.equal(rows[0].issue, 2025130);
  assert.equal(rows.at(-1).issue, 2026080);
  assert.equal(rows.filter((item) => item.issue <= 2026049).length, 70);
  assert.equal(rows.filter((item) => item.issue >= 2026050 && item.issue <= 2026079).length, 30);
});
