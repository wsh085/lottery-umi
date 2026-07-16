#!/usr/bin/env node

/**
 * 大乐透8红三球覆盖时间分块集成。
 *
 * develop：只评价2025039—2026041，输出开发冠军，不计算封存38期表现。
 * validate：读取已冻结冠军，仅对2026042—2026079执行一次严格滚动验证。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const DATA_2025 = path.join(ROOT, 'data', 'da_2025_data.json');
const DATA_2026 = path.join(ROOT, 'data', 'da_2026_data.json');

const DEV_END = 2026041;
const DEV_TARGET_START = 2025039;
const VALIDATION_START = 2026042;
const VALIDATION_END = 2026079;
const TARGET_ISSUE = 2026080;

const DEV_BLOCKS = [
  { id: 'D1', start: 2025039, end: 2025089 },
  { id: 'D2', start: 2025090, end: 2025140 },
  { id: 'D3', start: 2025141, end: 2026041 },
];

const SHORT_WINDOWS = [4, 6, 8, 10, 12, 15];
const MEDIUM_WINDOWS = [20, 30];
const LONG_WINDOWS = [38, 60, 100];
const FREQUENCY_TEMPLATES = [
  [0.6, 0.3, 0.1],
  [0.4, 0.4, 0.2],
  [0.3, 0.3, 0.4],
];
const REPEAT_WEIGHTS = [-0.1, -0.05, 0];
const ENSEMBLE_SIZES = [3, 5, 7, 9];

const BLUE_PARAMS = {
  L: { short: 12, long: 20, shortWeight: 0.8, longWeight: 0.4, gapWeight: 0.5 },
  M: { short: 4, long: 30, shortWeight: 0.8, longWeight: 0.4, gapWeight: 0.5 },
  H: { short: 10, long: 30, shortWeight: 0.6, longWeight: 0.2, gapWeight: 0.3 },
  X: { short: 10, long: 38, shortWeight: 0.2, longWeight: 0.4, gapWeight: 0.1 },
};

const V2_RED_PARAMS = {
  L: { short: 12, long: 15, shortWeight: 0.3, longWeight: 0.2, gapWeight: -0.2, zoneWeight: 0.05, repeatWeight: 0 },
  M: { short: 6, long: 15, shortWeight: 0.3, longWeight: 0.2, gapWeight: -0.2, zoneWeight: 0, repeatWeight: 0 },
  H: { short: 15, long: 38, shortWeight: 0.3, longWeight: 0.2, gapWeight: -0.2, zoneWeight: 0.2, repeatWeight: 0 },
  X: { short: 6, long: 30, shortWeight: 0.7, longWeight: 0.2, gapWeight: 0, zoneWeight: 0.2, repeatWeight: -0.1 },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseNumbers(text, expected, min, max, label, issue) {
  const values = String(text).trim().split(/\s+/).map(Number);
  assert(values.length === expected, `${issue} ${label}数量错误`);
  assert(values.every((value) => Number.isInteger(value) && value >= min && value <= max), `${issue} ${label}范围错误`);
  assert(new Set(values).size === expected, `${issue} ${label}存在重复`);
  assert(values.every((value, index) => index === 0 || values[index - 1] < value), `${issue} ${label}未升序`);
  return values;
}

function loadFile(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert(Array.isArray(raw), `${file}不是数组`);
  return raw.map((row) => {
    const issue = Number(row['期数']);
    const reds = parseNumbers(row['红球'], 5, 1, 35, '前区', issue);
    const blues = parseNumbers(row['蓝球'], 2, 1, 12, '后区', issue);
    assert(Number(row['和值']) === reds.reduce((sum, value) => sum + value, 0), `${issue}和值不一致`);
    return { issue, reds, blues };
  });
}

function loadAllDraws() {
  const draws2025 = loadFile(DATA_2025);
  const draws2026 = loadFile(DATA_2026);
  assert(draws2025.length === 150, `2025期数错误：${draws2025.length}`);
  assert(draws2026.length === 79, `2026期数错误：${draws2026.length}`);
  assert(draws2025[0].issue === 2025001 && draws2025.at(-1).issue === 2025150, '2025范围错误');
  assert(draws2026[0].issue === 2026001 && draws2026.at(-1).issue === 2026079, '2026范围错误');
  const draws = [...draws2025, ...draws2026];
  assert(draws.every((draw, index) => index === 0 || draws[index - 1].issue < draw.issue), '合并期号顺序错误');
  assert(!draws.some((draw) => draw.issue === TARGET_ISSUE), '目标期已存在于数据中');
  return draws;
}

function stateOf(history) {
  const sum = history.at(-1).reds.reduce((total, value) => total + value, 0);
  if (sum <= 75) return 'L';
  if (sum <= 90) return 'M';
  if (sum <= 105) return 'H';
  return 'X';
}

function zoneOf(number) {
  if (number <= 12) return 0;
  if (number <= 24) return 1;
  return 2;
}

function weightedFrequency(history, window, number) {
  const slice = history.slice(-window);
  if (slice.length === 0) return 0;
  let count = 0;
  for (let index = 0; index < slice.length; index += 1) {
    if (slice[index].reds.includes(number)) count += index === slice.length - 1 ? 0.5 : 1;
  }
  return count / slice.length;
}

function normalFrequency(history, window, number, field = 'reds') {
  const slice = history.slice(-window);
  if (slice.length === 0) return 0;
  return slice.filter((draw) => draw[field].includes(number)).length / slice.length;
}

function actualGap(history, number, field = 'reds') {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index][field].includes(number)) return history.length - 1 - index;
  }
  return history.length;
}

function averageZoneCounts(history) {
  if (history.length === 0) return [0, 0, 0];
  const counts = [0, 0, 0];
  for (const draw of history) {
    for (const number of draw.reds) counts[zoneOf(number)] += 1;
  }
  return counts.map((count) => count / history.length);
}

function oddAverage(history) {
  if (history.length === 0) return 0;
  return history.reduce((total, draw) => total + draw.reds.filter((number) => number % 2 === 1).length, 0) / history.length;
}

function gapShape(shape, gap) {
  const effectiveGap = Math.max(gap, 1);
  if (shape === 'ACTIVE') return Math.exp(-effectiveGap / 3);
  if (shape === 'MILD_REBOUND') return Math.exp(-Math.abs(effectiveGap - 4) / 3);
  if (shape === 'MID_REBOUND') return Math.exp(-Math.abs(effectiveGap - 7) / 4);
  if (shape === 'LONG_PENALTY') return -Math.min(effectiveGap, 12) / 12;
  throw new Error(`未知遗漏形态：${shape}`);
}

function conditionalStateFrequency(history, number, matchWindow) {
  const currentState = stateOf(history);
  const matched = [];
  // response期的状态只能由其前一期计算，严格排除尚未出现的目标期。
  for (let index = 1; index < history.length; index += 1) {
    const previousSum = history[index - 1].reds.reduce((sum, value) => sum + value, 0);
    const responseState = previousSum <= 75 ? 'L' : previousSum <= 90 ? 'M' : previousSum <= 105 ? 'H' : 'X';
    if (responseState === currentState) matched.push(history[index]);
  }
  const slice = matchWindow === 'ALL' ? matched : matched.slice(-Number(matchWindow));
  if (slice.length === 0) return 0;
  return slice.filter((draw) => draw.reds.includes(number)).length / slice.length;
}

function cooccurrenceScore(history, number, aggregate) {
  const lastNumbers = history.at(-1).reds;
  const prior = history.slice(0, -1);
  if (prior.length === 0) return 0;
  const rates = lastNumbers.map((previousNumber) => (
    prior.filter((draw) => draw.reds.includes(number) && draw.reds.includes(previousNumber)).length / prior.length
  ));
  if (aggregate === 'MAX') return Math.max(...rates);
  if (aggregate === 'SUM') return rates.reduce((sum, value) => sum + value, 0);
  return rates.reduce((sum, value) => sum + value, 0) / rates.length;
}

function createCandidates() {
  const candidates = [];
  let sequence = 1;
  const add = (family, params, complexity) => {
    candidates.push({ id: `C${String(sequence).padStart(3, '0')}`, family, params, complexity });
    sequence += 1;
  };

  for (const short of SHORT_WINDOWS) {
    for (const medium of MEDIUM_WINDOWS) {
      for (const long of LONG_WINDOWS) {
        for (const weights of FREQUENCY_TEMPLATES) add('FREQUENCY', { short, medium, long, weights }, 4);
      }
    }
  }
  for (const shape of ['ACTIVE', 'MILD_REBOUND', 'MID_REBOUND', 'LONG_PENALTY']) {
    add('GAP_SHAPE', { shape }, 1);
  }
  for (const recentWindow of [5, 10]) add('ZONE_REBOUND', { recentWindow }, 1);
  add('ZONE_BLEND', { recentWindows: [5, 10], weights: [0.6, 0.4] }, 2);
  for (const recentWindow of [5, 10]) add('PARITY_REBOUND', { recentWindow }, 1);
  add('ZONE_PARITY_BLEND', { recentWindow: 5, zoneWeight: 0.7, parityWeight: 0.3 }, 3);
  for (const matchWindow of [20, 50, 'ALL']) add('STATE_FREQUENCY', { matchWindow }, 1);
  for (const aggregate of ['MEAN', 'MAX', 'SUM']) {
    for (const repeatWeight of REPEAT_WEIGHTS) add('COOCCURRENCE', { aggregate, repeatWeight }, 2);
  }
  add('BALANCED_V2', { version: 'V2' }, 7);

  assert(candidates.length === 131, `候选数意外变化：${candidates.length}`);
  return candidates;
}

function scoreCandidate(candidate, history, number) {
  const lastSet = new Set(history.at(-1).reds);
  const repeat = lastSet.has(number) ? 1 : 0;
  if (candidate.family === 'FREQUENCY') {
    const { short, medium, long, weights } = candidate.params;
    return weights[0] * weightedFrequency(history, short, number)
      + weights[1] * weightedFrequency(history, medium, number)
      + weights[2] * weightedFrequency(history, long, number);
  }
  if (candidate.family === 'GAP_SHAPE') return gapShape(candidate.params.shape, actualGap(history, number));
  if (candidate.family === 'ZONE_REBOUND') {
    const longAverage = averageZoneCounts(history);
    const recentAverage = averageZoneCounts(history.slice(-candidate.params.recentWindow));
    return (longAverage[zoneOf(number)] - recentAverage[zoneOf(number)]) / 5;
  }
  if (candidate.family === 'ZONE_BLEND') {
    const longAverage = averageZoneCounts(history);
    return candidate.params.recentWindows.reduce((total, window, index) => {
      const recentAverage = averageZoneCounts(history.slice(-window));
      return total + candidate.params.weights[index] * (longAverage[zoneOf(number)] - recentAverage[zoneOf(number)]) / 5;
    }, 0);
  }
  if (candidate.family === 'PARITY_REBOUND') {
    const deficit = oddAverage(history) - oddAverage(history.slice(-candidate.params.recentWindow));
    return number % 2 === 1 ? deficit / 5 : -deficit / 5;
  }
  if (candidate.family === 'ZONE_PARITY_BLEND') {
    const longZones = averageZoneCounts(history);
    const recent = history.slice(-candidate.params.recentWindow);
    const recentZones = averageZoneCounts(recent);
    const zoneScore = (longZones[zoneOf(number)] - recentZones[zoneOf(number)]) / 5;
    const parityDeficit = oddAverage(history) - oddAverage(recent);
    const parityScore = number % 2 === 1 ? parityDeficit / 5 : -parityDeficit / 5;
    return candidate.params.zoneWeight * zoneScore + candidate.params.parityWeight * parityScore;
  }
  if (candidate.family === 'STATE_FREQUENCY') {
    return conditionalStateFrequency(history, number, candidate.params.matchWindow);
  }
  if (candidate.family === 'COOCCURRENCE') {
    return cooccurrenceScore(history, number, candidate.params.aggregate) + candidate.params.repeatWeight * repeat;
  }
  if (candidate.family === 'BALANCED_V2') {
    const state = stateOf(history);
    const params = V2_RED_PARAMS[state];
    const longZones = averageZoneCounts(history);
    const recentZones = averageZoneCounts(history.slice(-5));
    const zoneDelta = (longZones[zoneOf(number)] - recentZones[zoneOf(number)]) / 5;
    return params.shortWeight * weightedFrequency(history, params.short, number)
      + params.longWeight * weightedFrequency(history, params.long, number)
      + params.gapWeight * Math.min(Math.max(actualGap(history, number), 1), 12) / 12
      + params.zoneWeight * zoneDelta
      + params.repeatWeight * repeat;
  }
  throw new Error(`未知候选家族：${candidate.family}`);
}

function rankCandidate(candidate, history) {
  return Array.from({ length: 35 }, (_, index) => index + 1)
    .map((number) => ({ number, score: scoreCandidate(candidate, history, number) }))
    .sort((left, right) => right.score - left.score || left.number - right.number);
}

function selectNumbers(ranking, history) {
  const lastSet = new Set(history.at(-1).reds);
  const dan = [];
  let danRepeat = 0;
  const danDeferred = [];
  for (const entry of ranking) {
    const repeat = lastSet.has(entry.number);
    if (repeat && danRepeat >= 1) {
      danDeferred.push(entry.number);
      continue;
    }
    dan.push(entry.number);
    if (repeat) danRepeat += 1;
    if (dan.length === 3) break;
  }

  const drag = [];
  let allRepeat = danRepeat;
  const skippedRepeat = [];
  for (const entry of ranking) {
    if (dan.includes(entry.number)) continue;
    const repeat = lastSet.has(entry.number);
    if (repeat && allRepeat >= 2) {
      skippedRepeat.push(entry.number);
      continue;
    }
    drag.push(entry.number);
    if (repeat) allRepeat += 1;
    if (drag.length === 5) break;
  }
  assert(dan.length === 3 && drag.length === 5, '未能选满3胆5拖');
  return {
    dan: [...dan].sort((a, b) => a - b),
    drag: [...drag].sort((a, b) => a - b),
    all: [...dan, ...drag].sort((a, b) => a - b),
    danRepeat,
    allRepeat,
    selectedRepeats: [...dan, ...drag].filter((number) => lastSet.has(number)).sort((a, b) => a - b),
    danDeferred: [...new Set(danDeferred)].sort((a, b) => a - b),
    skippedRepeat: [...new Set(skippedRepeat)].sort((a, b) => a - b),
  };
}

function rankEnsemble(baseCandidates, history) {
  const vote = new Map(Array.from({ length: 35 }, (_, index) => [index + 1, 0]));
  for (const candidate of baseCandidates) {
    const ranking = rankCandidate(candidate, history);
    ranking.forEach((entry, rank) => vote.set(entry.number, vote.get(entry.number) + 1 / (1 + rank)));
  }
  return [...vote.entries()]
    .map(([number, total]) => ({ number, score: total / baseCandidates.length }))
    .sort((left, right) => right.score - left.score || left.number - right.number);
}

function predictBlue(history) {
  const state = stateOf(history);
  const params = BLUE_PARAMS[state];
  return Array.from({ length: 12 }, (_, index) => index + 1)
    .map((number) => ({
      number,
      score: params.shortWeight * normalFrequency(history, params.short, number, 'blues')
        + params.longWeight * normalFrequency(history, params.long, number, 'blues')
        + params.gapWeight * Math.min(actualGap(history, number, 'blues'), 10) / 10,
    }))
    .sort((left, right) => right.score - left.score || left.number - right.number)
    .slice(0, 2)
    .map((entry) => entry.number)
    .sort((a, b) => a - b);
}

function emptyMetrics() {
  return { rows: 0, danAny: 0, danGe2: 0, coverGe1: 0, coverGe2: 0, coverGe3: 0, totalCover: 0, blueAny: 0, union: 0, maxDanRepeat: 0, maxAllRepeat: 0 };
}

function updateMetrics(metrics, selected, actual, blues = null) {
  const actualRedSet = new Set(actual.reds);
  const danHits = selected.dan.filter((number) => actualRedSet.has(number)).length;
  const cover = selected.all.filter((number) => actualRedSet.has(number)).length;
  const blueHits = blues ? blues.filter((number) => actual.blues.includes(number)).length : 0;
  metrics.rows += 1;
  metrics.danAny += danHits >= 1 ? 1 : 0;
  metrics.danGe2 += danHits >= 2 ? 1 : 0;
  metrics.coverGe1 += cover >= 1 ? 1 : 0;
  metrics.coverGe2 += cover >= 2 ? 1 : 0;
  metrics.coverGe3 += cover >= 3 ? 1 : 0;
  metrics.totalCover += cover;
  metrics.blueAny += blueHits >= 1 ? 1 : 0;
  metrics.union += danHits >= 1 || blueHits >= 1 ? 1 : 0;
  metrics.maxDanRepeat = Math.max(metrics.maxDanRepeat, selected.danRepeat);
  metrics.maxAllRepeat = Math.max(metrics.maxAllRepeat, selected.allRepeat);
  return { danHits, cover, blueHits };
}

function metricWithoutRows(metrics) {
  return {
    rows: metrics.rows,
    danAny: metrics.danAny,
    danGe2: metrics.danGe2,
    coverGe1: metrics.coverGe1,
    coverGe2: metrics.coverGe2,
    coverGe3: metrics.coverGe3,
    totalCover: metrics.totalCover,
    blueAny: metrics.blueAny,
    union: metrics.union,
    maxDanRepeat: metrics.maxDanRepeat,
    maxAllRepeat: metrics.maxAllRepeat,
  };
}

function evaluateBaseCandidates(devDraws, candidates) {
  const targets = devDraws.filter((draw) => draw.issue >= DEV_TARGET_START);
  const results = new Map(candidates.map((candidate) => [candidate.id, {
    candidate,
    overall: emptyMetrics(),
    blocks: Object.fromEntries(DEV_BLOCKS.map((block) => [block.id, emptyMetrics()])),
  }]));

  for (const target of targets) {
    const targetIndex = devDraws.findIndex((draw) => draw.issue === target.issue);
    const history = devDraws.slice(0, targetIndex);
    assert(history.length >= 38, `${target.issue}启动训练不足38期`);
    const block = DEV_BLOCKS.find((item) => target.issue >= item.start && target.issue <= item.end);
    assert(block, `${target.issue}未落入开发块`);
    for (const candidate of candidates) {
      const selected = selectNumbers(rankCandidate(candidate, history), history);
      const result = results.get(candidate.id);
      updateMetrics(result.overall, selected, target);
      updateMetrics(result.blocks[block.id], selected, target);
    }
  }
  return [...results.values()];
}

function variance(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

function stabilityKey(result) {
  const blockCounts = DEV_BLOCKS.map((block) => result.blocks[block.id].coverGe3);
  return {
    minBlock: Math.min(...blockCounts),
    blockVariance: variance(blockCounts),
    coverGe3: result.overall.coverGe3,
    totalCover: result.overall.totalCover,
    coverGe2: result.overall.coverGe2,
    coverGe1: result.overall.coverGe1,
    danGe2: result.overall.danGe2,
    danAny: result.overall.danAny,
    complexity: result.candidate?.complexity ?? result.ensembleSize,
    id: result.candidate?.id ?? `E${String(result.ensembleSize).padStart(2, '0')}`,
  };
}

function compareStable(left, right) {
  const a = stabilityKey(left);
  const b = stabilityKey(right);
  return b.minBlock - a.minBlock
    || a.blockVariance - b.blockVariance
    || b.coverGe3 - a.coverGe3
    || b.totalCover - a.totalCover
    || b.coverGe2 - a.coverGe2
    || b.coverGe1 - a.coverGe1
    || b.danGe2 - a.danGe2
    || b.danAny - a.danAny
    || a.complexity - b.complexity
    || a.id.localeCompare(b.id);
}

function evaluateEnsemble(devDraws, rankedBase, ensembleSize) {
  const baseResults = rankedBase.slice(0, ensembleSize);
  const baseCandidates = baseResults.map((result) => result.candidate);
  const overall = emptyMetrics();
  const blocks = Object.fromEntries(DEV_BLOCKS.map((block) => [block.id, emptyMetrics()]));
  for (let index = 0; index < devDraws.length; index += 1) {
    const target = devDraws[index];
    if (target.issue < DEV_TARGET_START) continue;
    const history = devDraws.slice(0, index);
    const selected = selectNumbers(rankEnsemble(baseCandidates, history), history);
    const block = DEV_BLOCKS.find((item) => target.issue >= item.start && target.issue <= item.end);
    updateMetrics(overall, selected, target);
    updateMetrics(blocks[block.id], selected, target);
  }
  return { ensembleSize, baseIds: baseCandidates.map((candidate) => candidate.id), overall, blocks };
}

function canonicalChampion(champion) {
  return {
    algorithm: 'time_block_reciprocal_rank_v1',
    ensembleSize: champion.ensembleSize,
    baseStrategies: champion.baseStrategies,
    selection: { danCount: 3, dragCount: 5, danRepeatCap: 1, allRepeatCap: 2, tieBreak: 'number_ascending' },
    vote: 'mean(1/(1+zero_based_rank))',
    developmentBoundary: { seed: '2025001-2025038', targets: '2025039-2026041', blocks: ['2025039-2025089', '2025090-2025140', '2025141-2026041'] },
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function baseResultSummary(result) {
  return {
    id: result.candidate.id,
    family: result.candidate.family,
    params: result.candidate.params,
    complexity: result.candidate.complexity,
    overall: metricWithoutRows(result.overall),
    blocks: Object.fromEntries(DEV_BLOCKS.map((block) => [block.id, metricWithoutRows(result.blocks[block.id])])),
    key: stabilityKey(result),
  };
}

function ensembleSummary(result) {
  return {
    ensembleSize: result.ensembleSize,
    baseIds: result.baseIds,
    overall: metricWithoutRows(result.overall),
    blocks: Object.fromEntries(DEV_BLOCKS.map((block) => [block.id, metricWithoutRows(result.blocks[block.id])])),
    key: stabilityKey(result),
  };
}

function runDevelop() {
  const allDraws = loadAllDraws();
  const devDraws = allDraws.filter((draw) => draw.issue <= DEV_END);
  const validationCount = allDraws.filter((draw) => draw.issue >= VALIDATION_START && draw.issue <= VALIDATION_END).length;
  assert(allDraws.length === 229, '合并期数不是229');
  assert(devDraws.length === 191, `开发期数错误：${devDraws.length}`);
  assert(devDraws.at(-1).issue === DEV_END, '开发末期错误');
  assert(devDraws.filter((draw) => draw.issue >= DEV_TARGET_START).length === 153, '开发目标数错误');
  for (const block of DEV_BLOCKS) {
    assert(devDraws.filter((draw) => draw.issue >= block.start && draw.issue <= block.end).length === 51, `${block.id}不是51期`);
  }
  assert(validationCount === 38, `封存窗口期数错误：${validationCount}`);

  const candidates = createCandidates();
  const rankedBase = evaluateBaseCandidates(devDraws, candidates).sort(compareStable);
  assert(rankedBase.every((result) => result.overall.maxDanRepeat <= 1 && result.overall.maxAllRepeat <= 2), '基础策略违反重号约束');
  const ensembles = ENSEMBLE_SIZES.map((size) => evaluateEnsemble(devDraws, rankedBase, size)).sort(compareStable);
  const championResult = ensembles[0];
  const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const champion = {
    ensembleSize: championResult.ensembleSize,
    baseStrategies: championResult.baseIds.map((id) => candidateMap.get(id)),
  };
  const normalizedChampion = canonicalChampion(champion);
  const output = {
    status: 'VALIDATION_NOT_OPENED',
    generatedAt: new Date().toISOString(),
    data: {
      rows2025: 150,
      range2025: '2025001-2025150',
      rows2026: 79,
      range2026: '2026001-2026079',
      allRows: 229,
      developmentRows: 191,
      developmentTargets: 153,
      blockRows: [51, 51, 51],
      sealedValidationRows: 38,
      targetIssue: TARGET_ISSUE,
    },
    candidateCount: candidates.length,
    candidateFamilyCounts: Object.fromEntries([...new Set(candidates.map((candidate) => candidate.family))].map((family) => [family, candidates.filter((candidate) => candidate.family === family).length])),
    baseRankingIds: rankedBase.map((result) => result.candidate.id),
    topBaseStrategies: rankedBase.slice(0, 12).map(baseResultSummary),
    ensembles: ensembles.map(ensembleSummary),
    champion: normalizedChampion,
    championDevelopment: ensembleSummary(championResult),
    championSha256: sha256(normalizedChampion),
  };

  // 防止开发输出意外携带封存逐期结果。
  assert(output.status === 'VALIDATION_NOT_OPENED', '开发状态错误');
  assert(!Object.hasOwn(output, 'validation'), '开发输出意外含验证结果');
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function hydrateChampion(freeze, expectedStatus = 'VALIDATION_NOT_OPENED') {
  assert(freeze.status === expectedStatus, `冻结状态必须为${expectedStatus}，实际为${freeze.status}`);
  assert(freeze.champion && Array.isArray(freeze.champion.baseStrategies), '冻结冠军缺失');
  assert(freeze.champion.baseStrategies.length === freeze.champion.ensembleSize, '冻结集成规模不一致');
  assert(sha256(freeze.champion) === freeze.championSha256, '冻结冠军SHA-256不匹配');
  return freeze.champion.baseStrategies;
}

function formatRow(target, selected, blues, hit) {
  return {
    issue: target.issue,
    state: null,
    dan: selected.dan,
    drag: selected.drag,
    all: selected.all,
    blues,
    actualReds: target.reds,
    actualBlues: target.blues,
    danHits: hit.danHits,
    cover: hit.cover,
    blueHits: hit.blueHits,
    unionHit: hit.danHits >= 1 || hit.blueHits >= 1 ? 1 : 0,
    danRepeat: selected.danRepeat,
    allRepeat: selected.allRepeat,
    selectedRepeats: selected.selectedRepeats,
    danDeferred: selected.danDeferred,
    skippedRepeat: selected.skippedRepeat,
  };
}

function runValidate(freezePath, reproduce = false) {
  assert(freezePath, 'validate需要冻结JSON路径');
  const absoluteFreezePath = path.resolve(ROOT, freezePath);
  const freeze = JSON.parse(fs.readFileSync(absoluteFreezePath, 'utf8'));
  const baseCandidates = hydrateChampion(freeze, reproduce ? 'VALIDATION_OPENED_ONCE' : 'VALIDATION_NOT_OPENED');
  const allDraws = loadAllDraws();
  assert(freeze.data?.developmentTargets === 153 && freeze.data?.sealedValidationRows === 38, '冻结数据边界不匹配');
  const validationTargets = allDraws.filter((draw) => draw.issue >= VALIDATION_START && draw.issue <= VALIDATION_END);
  assert(validationTargets.length === 38, '验证期数不是38');

  const metrics = emptyMetrics();
  const rows = [];
  for (const target of validationTargets) {
    const index = allDraws.findIndex((draw) => draw.issue === target.issue);
    const history = allDraws.slice(0, index);
    assert(history.at(-1).issue < target.issue, `${target.issue}发生未来泄漏`);
    const selected = selectNumbers(rankEnsemble(baseCandidates, history), history);
    const blues = predictBlue(history);
    const hit = updateMetrics(metrics, selected, target, blues);
    const row = formatRow(target, selected, blues, hit);
    row.state = stateOf(history);
    rows.push(row);
  }
  assert(metrics.rows === 38, '验证汇总行数错误');
  assert(metrics.maxDanRepeat <= 1 && metrics.maxAllRepeat <= 2, '验证重号约束失败');

  const finalHistory = allDraws;
  const finalSelected = selectNumbers(rankEnsemble(baseCandidates, finalHistory), finalHistory);
  const finalPrediction = {
    issue: TARGET_ISSUE,
    state: stateOf(finalHistory),
    dan: finalSelected.dan,
    drag: finalSelected.drag,
    all: finalSelected.all,
    blues: predictBlue(finalHistory),
    selectedRepeats: finalSelected.selectedRepeats,
    danDeferred: finalSelected.danDeferred,
    skippedRepeat: finalSelected.skippedRepeat,
    danRepeat: finalSelected.danRepeat,
    allRepeat: finalSelected.allRepeat,
  };
  const decision = metrics.coverGe3 >= 14 ? 'PASS_PROMOTE_V3' : 'FAIL_KEEP_V2';
  const output = {
    ...freeze,
    status: 'VALIDATION_OPENED_ONCE',
    validationOpenedAt: new Date().toISOString(),
    validation: {
      range: '2026042-2026079',
      rows,
      summary: metricWithoutRows(metrics),
      threshold: { minimumCount: 14, denominator: 38, minimumRate: 36.8 },
      decision,
    },
    finalPrediction,
  };
  if (reproduce) {
    assert(JSON.stringify(metricWithoutRows(metrics)) === JSON.stringify(freeze.validation?.summary), '复算汇总与首次验证不一致');
    assert(JSON.stringify(finalPrediction) === JSON.stringify(freeze.finalPrediction), '复算2026080候选与首次验证不一致');
    process.stdout.write(`${JSON.stringify({
      status: 'VALIDATION_REPRODUCED_WITH_FROZEN_CHAMPION',
      championSha256: freeze.championSha256,
      rows: rows.map((row) => ({
        issue: row.issue,
        state: row.state,
        dan: row.dan,
        drag: row.drag,
        blues: row.blues,
        danHits: row.danHits,
        cover: row.cover,
        blueHits: row.blueHits,
        unionHit: row.unionHit,
        danRepeat: row.danRepeat,
        allRepeat: row.allRepeat,
      })),
      summary: metricWithoutRows(metrics),
      decision,
      finalPrediction,
    }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

const [mode, freezePath] = process.argv.slice(2);
if (mode === 'develop') runDevelop();
else if (mode === 'validate') runValidate(freezePath);
else if (mode === 'reproduce') runValidate(freezePath, true);
else throw new Error('用法：node scripts/dlt_cover3_time_block_ensemble.mjs develop|validate|reproduce [freeze-json]');
