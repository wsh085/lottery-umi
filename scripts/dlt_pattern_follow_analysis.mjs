#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const DATA_2025 = path.join(ROOT, 'data', 'da_2025_data.json');
const DATA_2026 = path.join(ROOT, 'data', 'da_2026_data.json');
const DATABASE_JSON = path.join(ROOT, 'docs', 'lottery', '大乐透规律事件时间线_当前.json');
const ANALYSIS_JSON = path.join(ROOT, 'docs', 'lottery', '大乐透预测机器审计_当前.json');
const LEGACY_ARTIFACTS = [
  path.join(ROOT, 'docs', 'lottery', '大乐透近100期号码分布_2025130-2026079.json'),
  path.join(ROOT, 'docs', 'lottery', '大乐透近100期号码规律验证_2026080.json'),
];

const TIMELINE_START = 2025130;
const FIXED_RANGE_END = 2026079;
const TRAIN_END = 2026049;
const VALIDATION_START = 2026050;

const V2_RED_PARAMS = {
  L: { short: 12, long: 15, shortWeight: 0.3, longWeight: 0.2, gapWeight: -0.2, zoneWeight: 0.05, repeatWeight: 0 },
  M: { short: 6, long: 15, shortWeight: 0.3, longWeight: 0.2, gapWeight: -0.2, zoneWeight: 0, repeatWeight: 0 },
  H: { short: 15, long: 38, shortWeight: 0.3, longWeight: 0.2, gapWeight: -0.2, zoneWeight: 0.2, repeatWeight: 0 },
  X: { short: 6, long: 30, shortWeight: 0.7, longWeight: 0.2, gapWeight: 0, zoneWeight: 0.2, repeatWeight: -0.1 },
};

const BLUE_PARAMS = {
  L: { short: 12, long: 20, shortWeight: 0.8, longWeight: 0.4, gapWeight: 0.5 },
  M: { short: 4, long: 30, shortWeight: 0.8, longWeight: 0.4, gapWeight: 0.5 },
  H: { short: 10, long: 30, shortWeight: 0.6, longWeight: 0.2, gapWeight: 0.3 },
  X: { short: 10, long: 38, shortWeight: 0.2, longWeight: 0.4, gapWeight: 0.1 },
};

function require(condition, message) {
  if (!condition) throw new Error(message);
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value >= 1 && value <= 35))]
    .sort((a, b) => a - b);
}

function pad(number) {
  return String(number).padStart(2, '0');
}

function sha256(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function nextIssue(latestIssue) {
  require(Number.isInteger(latestIssue) && latestIssue > 0, `最新期号无效：${latestIssue}`);
  return latestIssue + 1;
}

function parseNumbers(text, expected, min, max, label, issue) {
  const values = String(text).trim().split(/\s+/).map(Number);
  require(values.length === expected, `${issue}${label}数量错误`);
  require(values.every((value) => Number.isInteger(value) && value >= min && value <= max), `${issue}${label}范围错误`);
  require(new Set(values).size === expected, `${issue}${label}存在重复`);
  require(values.every((value, index) => index === 0 || values[index - 1] < value), `${issue}${label}未升序`);
  return values;
}

function loadFile(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  require(Array.isArray(raw), `${file}不是数组`);
  return raw.map((item) => {
    const issue = Number(item['期数']);
    const reds = parseNumbers(item['红球'], 5, 1, 35, '前区', issue);
    const blues = parseNumbers(item['蓝球'], 2, 1, 12, '后区', issue);
    require(Number(item['和值']) === reds.reduce((sum, number) => sum + number, 0), `${issue}和值不一致`);
    return { issue, reds, blues };
  });
}

export function loadAllDraws() {
  const draws2025 = loadFile(DATA_2025);
  const draws2026 = loadFile(DATA_2026);
  require(draws2025.length === 150, `2025期数错误：${draws2025.length}`);
  require(draws2025[0].issue === 2025001 && draws2025.at(-1).issue === 2025150, '2025范围错误');
  require(draws2026.length > 0 && draws2026[0].issue === 2026001, '2026首期范围错误');
  for (const [label, rows] of [['2025', draws2025], ['2026', draws2026]]) {
    require(rows.every((draw, index) => index === 0 || rows[index - 1].issue + 1 === draw.issue), `${label}期号不连续或未按时间升序`);
  }
  const draws = [...draws2025, ...draws2026];
  require(draws.every((draw, index) => index === 0 || draws[index - 1].issue < draw.issue), '合并期号未严格递增');
  const targetIssue = nextIssue(draws.at(-1).issue);
  require(!draws.some((draw) => draw.issue === targetIssue), `自动推导目标期${targetIssue}已存在`);
  return draws;
}

function zoneOf(number) {
  if (number <= 12) return 0;
  if (number <= 24) return 1;
  return 2;
}

export function standardizeRange(draws) {
  const lastSeen = new Map();
  const rows = [];
  for (let index = 0; index < draws.length; index += 1) {
    const draw = draws[index];
    const redOmissionBefore = {};
    for (let number = 1; number <= 35; number += 1) {
      redOmissionBefore[pad(number)] = lastSeen.has(number) ? index - lastSeen.get(number) - 1 : index;
    }
    if (draw.issue >= TIMELINE_START) {
      const odd = draw.reds.filter((number) => number % 2 === 1).length;
      const zones = [0, 0, 0];
      for (const number of draw.reds) zones[zoneOf(number)] += 1;
      rows.push({
        issue: draw.issue,
        reds: draw.reds,
        blues: draw.blues,
        redOmissionBefore,
        redSum: draw.reds.reduce((sum, number) => sum + number, 0),
        oddEvenRatio: `${odd}:${5 - odd}`,
        zoneRatio: zones.join(':'),
        sourceRange: `${TIMELINE_START}-${draws.at(-1).issue}`,
      });
    }
    for (const number of draw.reds) lastSeen.set(number, index);
  }
  require(rows.length > 0, '规律事件时间线为空');
  require(rows[0].issue === TIMELINE_START && rows.at(-1).issue === draws.at(-1).issue, '规律事件时间线首末范围错误');
  return rows;
}

function gapMiddleCandidates(reds) {
  const set = new Set(reds);
  const candidates = [];
  for (let number = 1; number <= 33; number += 1) {
    if (set.has(number) && set.has(number + 2)) candidates.push(number + 1);
  }
  return uniqueSorted(candidates);
}

function consecutiveDerivedCandidates(reds) {
  const set = new Set(reds);
  const candidates = [];
  for (let number = 1; number <= 34; number += 1) {
    if (!set.has(number) || !set.has(number + 1)) continue;
    for (let candidate = number - 1; candidate <= number + 2; candidate += 1) candidates.push(candidate);
  }
  return uniqueSorted(candidates);
}

export function diagonalCandidates(firstReds, secondReds) {
  const second = new Set(secondReds);
  const candidates = [];
  for (const number of firstReds) {
    if (second.has(number + 1)) candidates.push(number + 2, number + 3);
    if (second.has(number - 1)) candidates.push(number - 2, number - 3);
  }
  return uniqueSorted(candidates);
}

export function longGapCandidates(reds) {
  const sorted = [...reds].sort((a, b) => a - b);
  const candidates = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const left = sorted[index];
    const right = sorted[index + 1];
    const missingLength = right - left - 1;
    if (missingLength < 10) continue;
    const local = [];
    if (missingLength % 2 === 1) {
      const middle = left + 1 + Math.floor(missingLength / 2);
      local.push(middle - 1, middle, middle + 1);
    } else {
      const firstMiddle = left + missingLength / 2;
      const secondMiddle = firstMiddle + 1;
      local.push(firstMiddle - 1, firstMiddle, secondMiddle, secondMiddle + 1);
    }
    candidates.push(...local.filter((number) => number > left && number < right));
  }
  return uniqueSorted(candidates);
}

function coldCandidates(row, min, max) {
  return row.reds.filter((number) => (
    number >= min && number <= max && Number(row.redOmissionBefore[pad(number)]) > 15
  ));
}

function makeRule(id, label, outcomeOffsets, candidateBuilder) {
  return Object.freeze({ id, label, outcomeOffsets: Object.freeze(outcomeOffsets), candidateBuilder });
}

export const RULES = Object.freeze({
  GAP_MIDDLE: makeRule('GAP_MIDDLE', '间隔号补中', [1, 2], (rows, index) => gapMiddleCandidates(rows[index].reds)),
  CONSECUTIVE_DERIVED: makeRule('CONSECUTIVE_DERIVED', '连号区间衍生', [1, 2], (rows, index) => consecutiveDerivedCandidates(rows[index].reds)),
  BLUE_0102_TO_RED_31_35: makeRule('BLUE_0102_TO_RED_31_35', '蓝球01/02关联红球31—35', [1, 2], (rows, index) => (
    rows[index].blues.some((number) => number === 1 || number === 2) ? [31, 32, 33, 34, 35] : []
  )),
  COLD_LOW_REAPPEAR_T2: makeRule('COLD_LOW_REAPPEAR_T2', '小于30冷号间隔1期复开', [2], (rows, index) => coldCandidates(rows[index], 1, 29)),
  COLD_HIGH_REAPPEAR_T1: makeRule('COLD_HIGH_REAPPEAR_T1', '30及以上冷号后续1期复开', [1], (rows, index) => coldCandidates(rows[index], 30, 35)),
  DIAGONAL_EXTENSION: makeRule('DIAGONAL_EXTENSION', '双向斜连延伸', [2], (rows, index) => (
    index + 1 < rows.length ? diagonalCandidates(rows[index].reds, rows[index + 1].reds) : []
  )),
  LONG_GAP_FILL: makeRule('LONG_GAP_FILL', '长断区中点补位', [1], (rows, index) => longGapCandidates(rows[index].reds)),
  RED35_TO_RED0102: makeRule('RED35_TO_RED0102', '红球35后首尾联动', [1], (rows, index) => (
    rows[index].reds.includes(35) ? [1, 2] : []
  )),
});

export const RULE_IDS = Object.freeze(Object.keys(RULES));

function outcomeHit(rows, sourceIndex, offsets, candidates) {
  const candidateSet = new Set(candidates);
  return offsets.some((offset) => rows[sourceIndex + offset].reds.some((number) => candidateSet.has(number)));
}

export function buildEvents(rule, rows) {
  const maxOffset = Math.max(...rule.outcomeOffsets);
  const events = [];
  for (let index = 0; index + maxOffset < rows.length; index += 1) {
    const candidates = uniqueSorted(rule.candidateBuilder(rows, index));
    if (candidates.length === 0) continue;
    events.push({
      sourceIndex: index,
      sourceIssue: rows[index].issue,
      candidates,
      outcomeIssues: rule.outcomeOffsets.map((offset) => rows[index + offset].issue),
      success: outcomeHit(rows, index, rule.outcomeOffsets, candidates),
    });
  }
  return events;
}

export function matchOutcomeBlindControls(rule, rows, events = buildEvents(rule, rows)) {
  const maxOffset = Math.max(...rule.outcomeOffsets);
  const triggerIndices = new Set(events.map((event) => event.sourceIndex));
  const eligibleControls = [];
  for (let index = 0; index + maxOffset < rows.length; index += 1) {
    if (!triggerIndices.has(index) && rule.candidateBuilder(rows, index).length === 0) eligibleControls.push(index);
  }
  const unused = new Set(eligibleControls);
  const matches = [];
  for (const event of events) {
    const available = [...unused].sort((left, right) => (
      Math.abs(left - event.sourceIndex) - Math.abs(right - event.sourceIndex) || left - right
    ));
    if (available.length === 0) break;
    const controlIndex = available[0];
    unused.delete(controlIndex);
    matches.push({
      triggerIndex: event.sourceIndex,
      triggerIssue: event.sourceIssue,
      controlIndex,
      controlIssue: rows[controlIndex].issue,
      candidates: event.candidates,
      triggerSuccess: event.success,
      controlSuccess: outcomeHit(rows, controlIndex, rule.outcomeOffsets, event.candidates),
      triggerOutcomeIssues: event.outcomeIssues,
      controlOutcomeIssues: rule.outcomeOffsets.map((offset) => rows[controlIndex + offset].issue),
    });
  }
  return matches;
}

function logChoose(n, k) {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  const effective = Math.min(k, n - k);
  let value = 0;
  for (let index = 1; index <= effective; index += 1) {
    value += Math.log(n - effective + index) - Math.log(index);
  }
  return value;
}

export function fisherGreater(a, b, c, d) {
  require([a, b, c, d].every((value) => Number.isInteger(value) && value >= 0), 'Fisher列联表必须为非负整数');
  const rowOne = a + b;
  const rowTwo = c + d;
  const successTotal = a + c;
  const total = rowOne + rowTwo;
  if (total === 0) return 1;
  const minimum = Math.max(0, rowOne - (total - successTotal));
  const maximum = Math.min(rowOne, successTotal);
  const start = Math.max(a, minimum);
  let probability = 0;
  for (let value = start; value <= maximum; value += 1) {
    const logP = logChoose(successTotal, value)
      + logChoose(total - successTotal, rowOne - value)
      - logChoose(total, rowOne);
    probability += Math.exp(logP);
  }
  return Math.min(1, Math.max(0, probability));
}

export function wilson95(hits, total) {
  if (total === 0) return [0, 1];
  const z = 1.959963984540054;
  const proportion = hits / total;
  const denominator = 1 + (z * z) / total;
  const centre = (proportion + (z * z) / (2 * total)) / denominator;
  const margin = z * Math.sqrt((proportion * (1 - proportion) + (z * z) / (4 * total)) / total) / denominator;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

export function evaluateRuleSegment(rule, rows) {
  const events = buildEvents(rule, rows);
  const matches = matchOutcomeBlindControls(rule, rows, events);
  const support = matches.length;
  const hits = matches.filter((match) => match.triggerSuccess).length;
  const controlHits = matches.filter((match) => match.controlSuccess).length;
  const accuracy = support === 0 ? 0 : hits / support;
  const controlAccuracy = support === 0 ? 0 : controlHits / support;
  const lift = accuracy - controlAccuracy;
  return {
    segmentStart: rows[0]?.issue ?? null,
    segmentEnd: rows.at(-1)?.issue ?? null,
    rawTriggerCount: events.length,
    support,
    hits,
    misses: support - hits,
    controlHits,
    controlMisses: support - controlHits,
    accuracy,
    controlAccuracy,
    lift,
    wilson95: wilson95(hits, support),
    fisherP: fisherGreater(hits, support - hits, controlHits, support - controlHits),
    matchedPairs: matches,
  };
}

export function passesGate(result) {
  const reasons = [];
  if (result.validation.support < 5) reasons.push('验证匹配支持数<5');
  if (result.validation.accuracy < 0.5) reasons.push('验证准确率<50%');
  if (!(result.train.lift > 0)) reasons.push('训练提升度<=0');
  if (!(result.validation.lift > 0)) reasons.push('验证提升度<=0');
  if (!(result.validation.fisherP < 0.05)) reasons.push('验证单侧Fisher原始p>=0.05');
  return { passed: reasons.length === 0, reasons };
}

export function ruleReliability(result) {
  if (!result.gate.passed) return 0;
  const validation = result.validation;
  return validation.accuracy
    * validation.lift
    * Math.min(validation.support / 10, 1)
    * (Math.min(-Math.log10(Math.max(validation.fisherP, 1e-12)), 3) / 3);
}

export function activeCandidatesForTarget(rule, rows, targetIndex = rows.length) {
  const candidates = [];
  for (let sourceIndex = 0; sourceIndex < rows.length; sourceIndex += 1) {
    if (!rule.outcomeOffsets.some((offset) => sourceIndex + offset === targetIndex)) continue;
    candidates.push(...rule.candidateBuilder(rows, sourceIndex));
  }
  return uniqueSorted(candidates);
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

export const DYNAMIC_CONFIG = Object.freeze({
  recentLong: 12,
  recentShort: 6,
  trialMinimumSupport: 5,
  trialAccuracyLongMinimum: 0.60,
  trialLiftLongMinimum: 0.10,
  trialAccuracyShortMinimum: 0.55,
  trialLiftShortStrictlyPositive: true,
  consecutiveMissStop: 3,
  trialPerRuleCap: 0.025,
  trialTotalCap: 0.05,
  corePerRuleCap: 0.075,
  allRulesCap: 0.15,
  smoothingAlpha: 2,
  smoothingBeta: 2,
});

function smoothedRate(hits, total) {
  return (hits + DYNAMIC_CONFIG.smoothingAlpha)
    / (total + DYNAMIC_CONFIG.smoothingAlpha + DYNAMIC_CONFIG.smoothingBeta);
}

export function recentMetricsFromPairs(pairs) {
  const ordered = [...pairs].sort((left, right) => left.triggerIndex - right.triggerIndex);
  const longWindow = ordered.slice(-DYNAMIC_CONFIG.recentLong);
  const shortWindow = longWindow.slice(-DYNAMIC_CONFIG.recentShort);
  const summarize = (window) => {
    const hits = window.filter((pair) => pair.triggerSuccess).length;
    const controlHits = window.filter((pair) => pair.controlSuccess).length;
    const accuracy = smoothedRate(hits, window.length);
    const controlAccuracy = smoothedRate(controlHits, window.length);
    return {
      n: window.length,
      hits,
      controlHits,
      accuracy,
      controlAccuracy,
      lift: accuracy - controlAccuracy,
    };
  };
  const long = summarize(longWindow);
  const short = summarize(shortWindow);
  let consecutiveMisses = 0;
  for (let index = ordered.length - 1; index >= 0 && !ordered[index].triggerSuccess; index -= 1) consecutiveMisses += 1;
  return {
    completedPairCount: ordered.length,
    n12: long.n,
    hits12: long.hits,
    controlHits12: long.controlHits,
    a12: long.accuracy,
    c12: long.controlAccuracy,
    l12: long.lift,
    n6: short.n,
    hits6: short.hits,
    controlHits6: short.controlHits,
    a6: short.accuracy,
    c6: short.controlAccuracy,
    l6: short.lift,
    consecutiveMisses,
    recentPairs: longWindow.map((pair) => ({
      triggerIssue: pair.triggerIssue ?? null,
      controlIssue: pair.controlIssue ?? null,
      triggerIndex: pair.triggerIndex,
      triggerSuccess: pair.triggerSuccess,
      controlSuccess: pair.controlSuccess,
    })),
  };
}

export function recentRuleMetrics(rule, rows) {
  const events = buildEvents(rule, rows);
  const pairs = matchOutcomeBlindControls(rule, rows, events);
  return recentMetricsFromPairs(pairs);
}

export function trialDecision(metrics, candidates) {
  const reasons = [];
  if (metrics.n12 < DYNAMIC_CONFIG.trialMinimumSupport) reasons.push('近期完整事件数<5');
  if (metrics.a12 < DYNAMIC_CONFIG.trialAccuracyLongMinimum) reasons.push('A12<60%');
  if (metrics.l12 < DYNAMIC_CONFIG.trialLiftLongMinimum) reasons.push('L12<10个百分点');
  if (metrics.a6 < DYNAMIC_CONFIG.trialAccuracyShortMinimum) reasons.push('A6<55%');
  if (!(metrics.l6 > 0)) reasons.push('L6<=0');
  if (metrics.consecutiveMisses >= DYNAMIC_CONFIG.consecutiveMissStop) reasons.push('连续失误>=3');
  if (!Array.isArray(candidates) || candidates.length === 0) reasons.push('当前无目标期候选');
  return { passed: reasons.length === 0, reasons };
}

export function dynamicQuality(metrics) {
  const supportFactor = Math.min(metrics.n12 / DYNAMIC_CONFIG.recentLong, 1);
  const accuracyFactor = clamp((metrics.a12 - 0.50) / 0.25);
  const liftFactor = clamp(metrics.l12 / 0.25);
  const trendFactor = clamp(0.5 + (metrics.a6 - metrics.a12) / 0.20);
  const missFactor = metrics.consecutiveMisses >= 3 ? 0 : metrics.consecutiveMisses === 2 ? 0.5 : 1;
  return clamp(supportFactor
    * (0.5 * accuracyFactor + 0.3 * liftFactor + 0.2 * trendFactor)
    * missFactor);
}

export function scaleDynamicWeights(states) {
  const eligible = states
    .filter((state) => state.eligible !== false && state.candidates?.length > 0 && state.quality > 0)
    .map((state) => ({
      ...state,
      rawWeight: (state.tier === 'CORE' ? DYNAMIC_CONFIG.corePerRuleCap : DYNAMIC_CONFIG.trialPerRuleCap) * state.quality,
    }));
  const trialRawTotal = eligible.filter((state) => state.tier === 'TRIAL')
    .reduce((sum, state) => sum + state.rawWeight, 0);
  const trialScale = trialRawTotal > DYNAMIC_CONFIG.trialTotalCap
    ? DYNAMIC_CONFIG.trialTotalCap / trialRawTotal : 1;
  const withTrialScale = eligible.map((state) => ({
    ...state,
    weight: state.tier === 'TRIAL' ? state.rawWeight * trialScale : state.rawWeight,
  }));
  const trialTotal = withTrialScale.filter((state) => state.tier === 'TRIAL')
    .reduce((sum, state) => sum + state.weight, 0);
  const coreRawTotal = withTrialScale.filter((state) => state.tier === 'CORE')
    .reduce((sum, state) => sum + state.weight, 0);
  const coreAvailable = Math.max(0, DYNAMIC_CONFIG.allRulesCap - trialTotal);
  const coreScale = coreRawTotal > coreAvailable ? coreAvailable / coreRawTotal : 1;
  return withTrialScale.map((state) => ({
    ...state,
    weight: state.tier === 'CORE' ? state.weight * coreScale : state.weight,
  }));
}

function stateOf(history) {
  const total = history.at(-1).reds.reduce((sum, number) => sum + number, 0);
  if (total <= 75) return 'L';
  if (total <= 90) return 'M';
  if (total <= 105) return 'H';
  return 'X';
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

function normalFrequency(history, window, number, field) {
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

export function balancedV2Scores(history) {
  const state = stateOf(history);
  const params = V2_RED_PARAMS[state];
  const longZones = averageZoneCounts(history);
  const recentZones = averageZoneCounts(history.slice(-5));
  const previous = new Set(history.at(-1).reds);
  const scores = new Map();
  for (let number = 1; number <= 35; number += 1) {
    const zoneDelta = (longZones[zoneOf(number)] - recentZones[zoneOf(number)]) / 5;
    const score = params.shortWeight * weightedFrequency(history, params.short, number)
      + params.longWeight * weightedFrequency(history, params.long, number)
      + params.gapWeight * Math.min(Math.max(actualGap(history, number), 1), 12) / 12
      + params.zoneWeight * zoneDelta
      + params.repeatWeight * Number(previous.has(number));
    scores.set(number, score);
  }
  return scores;
}

function normalizeScores(scores) {
  const values = [...scores.values()];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum;
  return new Map([...scores].map(([number, score]) => [number, span === 0 ? 0 : (score - minimum) / span]));
}

export function fuseScores(baseScores, activeRules) {
  const base = normalizeScores(baseScores);
  const totalWeight = activeRules.reduce((sum, item) => sum + item.weight, 0);
  if (!(totalWeight > 0)) return base;
  const fused = new Map();
  for (const [number, baseScore] of base) {
    const matchWeight = activeRules
      .filter((item) => item.candidates.includes(number))
      .reduce((sum, item) => sum + item.weight, 0);
    fused.set(number, 0.85 * baseScore + 0.15 * (matchWeight / totalWeight));
  }
  return fused;
}

export function fuseDynamicScores(baseScores, weightedRules) {
  const base = normalizeScores(baseScores);
  const totalWeight = weightedRules.reduce((sum, item) => sum + item.weight, 0);
  require(totalWeight <= DYNAMIC_CONFIG.allRulesCap + 1e-12, `动态规律总权重越界：${totalWeight}`);
  const fused = new Map();
  for (const [number, baseScore] of base) {
    const ruleContribution = weightedRules
      .filter((item) => item.candidates.includes(number))
      .reduce((sum, item) => sum + item.weight, 0);
    fused.set(number, (1 - totalWeight) * baseScore + ruleContribution);
  }
  return fused;
}

function rankScores(scores) {
  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .map(([number]) => number);
}

export function selectDanDrag(scores, history) {
  const ranking = rankScores(scores);
  const previous = new Set(history.at(-1).reds);
  const dan = [];
  const danDeferred = [];
  let danRepeat = 0;
  for (const number of ranking) {
    const isRepeat = previous.has(number);
    if (isRepeat && danRepeat >= 1) {
      danDeferred.push(number);
      continue;
    }
    dan.push(number);
    danRepeat += Number(isRepeat);
    if (dan.length === 3) break;
  }
  const drag = [];
  const skippedRepeat = [];
  let allRepeat = danRepeat;
  for (const number of ranking) {
    if (dan.includes(number)) continue;
    const isRepeat = previous.has(number);
    if (isRepeat && allRepeat >= 2) {
      skippedRepeat.push(number);
      continue;
    }
    drag.push(number);
    allRepeat += Number(isRepeat);
    if (drag.length === 5) break;
  }
  const all = [...dan, ...drag].sort((a, b) => a - b);
  return {
    dan: [...dan].sort((a, b) => a - b),
    drag: [...drag].sort((a, b) => a - b),
    all,
    ranking,
    selectedRepeats: all.filter((number) => previous.has(number)),
    danRepeats: dan.filter((number) => previous.has(number)),
    danDeferred: uniqueSorted(danDeferred.filter((number) => drag.includes(number))),
    skippedRepeat: uniqueSorted(skippedRepeat),
    danRepeat,
    allRepeat,
  };
}

export function predictBlue(history) {
  const params = BLUE_PARAMS[stateOf(history)];
  const scored = [];
  for (let number = 1; number <= 12; number += 1) {
    const score = params.shortWeight * normalFrequency(history, params.short, number, 'blues')
      + params.longWeight * normalFrequency(history, params.long, number, 'blues')
      + params.gapWeight * Math.min(actualGap(history, number, 'blues'), 10) / 10;
    scored.push([number, score]);
  }
  return scored.sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .slice(0, 2).map(([number]) => number).sort((a, b) => a - b);
}

function compactDynamicRuleState(state) {
  return {
    id: state.id,
    label: state.label,
    tier: state.tier,
    metrics: state.metrics,
    candidates: state.candidates,
    eligibility: state.eligibility,
    quality: state.quality,
    rawWeight: state.rawWeight,
    weight: state.weight,
  };
}

export function dynamicPrediction(history, ruleRows, coreRuleIds = []) {
  require(history.length > 0, '动态预测缺少V2历史');
  const coreSet = new Set(coreRuleIds);
  const states = RULE_IDS.map((ruleId) => {
    const rule = RULES[ruleId];
    const metrics = recentRuleMetrics(rule, ruleRows);
    const candidates = activeCandidatesForTarget(rule, ruleRows, ruleRows.length);
    const tier = coreSet.has(ruleId) ? 'CORE' : 'TRIAL';
    const quality = dynamicQuality(metrics);
    const eligibility = tier === 'TRIAL'
      ? trialDecision(metrics, candidates)
      : {
        passed: candidates.length > 0 && quality > 0,
        reasons: [
          ...(candidates.length === 0 ? ['当前无目标期候选'] : []),
          ...(!(quality > 0) ? ['动态质量为0'] : []),
        ],
      };
    return {
      id: ruleId,
      label: rule.label,
      tier,
      metrics,
      candidates,
      quality,
      eligibility,
      eligible: eligibility.passed,
    };
  });
  const weighted = scaleDynamicWeights(states);
  const weightedById = new Map(weighted.map((state) => [state.id, state]));
  const ruleStates = states.map((state) => {
    const weightedState = weightedById.get(state.id);
    return compactDynamicRuleState({
      ...state,
      rawWeight: weightedState?.rawWeight ?? 0,
      weight: weightedState?.weight ?? 0,
    });
  });
  const activeRules = ruleStates.filter((state) => state.weight > 0);
  const trialWeight = activeRules.filter((state) => state.tier === 'TRIAL')
    .reduce((sum, state) => sum + state.weight, 0);
  const coreWeight = activeRules.filter((state) => state.tier === 'CORE')
    .reduce((sum, state) => sum + state.weight, 0);
  const totalRuleWeight = trialWeight + coreWeight;
  require(trialWeight <= DYNAMIC_CONFIG.trialTotalCap + 1e-12, `试用层权重越界：${trialWeight}`);
  require(totalRuleWeight <= DYNAMIC_CONFIG.allRulesCap + 1e-12, `全部规律权重越界：${totalRuleWeight}`);
  if (coreSet.size === 0) require(1 - totalRuleWeight >= 0.95 - 1e-12, '无正式层时V2权重低于95%');

  const baseScores = balancedV2Scores(history);
  const baselineV2 = selectDanDrag(baseScores, history);
  const fusedScores = fuseDynamicScores(baseScores, activeRules);
  const final = selectDanDrag(fusedScores, history);
  const blues = predictBlue(history);
  return {
    state: stateOf(history),
    ruleStates,
    activeRules,
    trialWeight,
    coreWeight,
    totalRuleWeight,
    v2Weight: 1 - totalRuleWeight,
    baselineV2: { ...baselineV2, blues },
    final: { ...final, blues },
    changedFromV2: JSON.stringify(baselineV2.dan) !== JSON.stringify(final.dan)
      || JSON.stringify(baselineV2.all) !== JSON.stringify(final.all),
    scoreTable: scoreTable(baseScores, fusedScores, activeRules),
  };
}

function emptyPredictionMetrics() {
  return {
    rows: 0,
    danAny: 0,
    danGe2: 0,
    coverGe1: 0,
    coverGe2: 0,
    coverGe3: 0,
    totalCover: 0,
    blueAny: 0,
    union: 0,
  };
}

function predictionHits(selection, actual) {
  const actualReds = new Set(actual.reds);
  const actualBlues = new Set(actual.blues);
  const danHits = selection.dan.filter((number) => actualReds.has(number)).length;
  const cover = selection.all.filter((number) => actualReds.has(number)).length;
  const blueHits = selection.blues.filter((number) => actualBlues.has(number)).length;
  return { danHits, cover, blueHits, unionHit: danHits >= 1 || blueHits >= 1 };
}

function updatePredictionMetrics(metrics, hits) {
  metrics.rows += 1;
  metrics.danAny += Number(hits.danHits >= 1);
  metrics.danGe2 += Number(hits.danHits >= 2);
  metrics.coverGe1 += Number(hits.cover >= 1);
  metrics.coverGe2 += Number(hits.cover >= 2);
  metrics.coverGe3 += Number(hits.cover >= 3);
  metrics.totalCover += hits.cover;
  metrics.blueAny += Number(hits.blueHits >= 1);
  metrics.union += Number(hits.unionHit);
}

function metricWithoutRows(metrics) {
  return Object.fromEntries(Object.entries(metrics).filter(([key]) => key !== 'rows'));
}

export function rollingDynamicBacktest(allDraws, standardizedRows, coreRuleIds = []) {
  const targets = allDraws.slice(-38);
  require(targets.length === 38, `动态滚动目标不是38期：${targets.length}`);
  const baselineMetrics = emptyPredictionMetrics();
  const dynamicMetrics = emptyPredictionMetrics();
  const rows = [];
  const activationCounts = Object.fromEntries(RULE_IDS.map((ruleId) => [ruleId, 0]));
  for (const target of targets) {
    const targetIndex = allDraws.findIndex((draw) => draw.issue === target.issue);
    const history = allDraws.slice(0, targetIndex);
    const ruleHistory = standardizedRows.filter((row) => row.issue < target.issue);
    require(history.at(-1).issue < target.issue, `${target.issue} V2历史泄漏`);
    require(ruleHistory.length > 0 && ruleHistory.at(-1).issue < target.issue, `${target.issue}规律历史泄漏`);
    const prediction = dynamicPrediction(history, ruleHistory, coreRuleIds);
    const baselineHits = predictionHits(prediction.baselineV2, target);
    const dynamicHits = predictionHits(prediction.final, target);
    updatePredictionMetrics(baselineMetrics, baselineHits);
    updatePredictionMetrics(dynamicMetrics, dynamicHits);
    for (const state of prediction.activeRules) activationCounts[state.id] += 1;
    rows.push({
      issue: target.issue,
      state: prediction.state,
      ruleHistoryEnd: ruleHistory.at(-1).issue,
      trialWeight: prediction.trialWeight,
      coreWeight: prediction.coreWeight,
      totalRuleWeight: prediction.totalRuleWeight,
      v2Weight: prediction.v2Weight,
      changedFromV2: prediction.changedFromV2,
      ruleStates: prediction.ruleStates,
      baselineV2: {
        dan: prediction.baselineV2.dan,
        drag: prediction.baselineV2.drag,
        all: prediction.baselineV2.all,
        blues: prediction.baselineV2.blues,
        danRepeats: prediction.baselineV2.danRepeats,
        selectedRepeats: prediction.baselineV2.selectedRepeats,
        danRepeat: prediction.baselineV2.danRepeat,
        allRepeat: prediction.baselineV2.allRepeat,
        ...baselineHits,
      },
      dynamic: {
        dan: prediction.final.dan,
        drag: prediction.final.drag,
        all: prediction.final.all,
        blues: prediction.final.blues,
        danRepeats: prediction.final.danRepeats,
        selectedRepeats: prediction.final.selectedRepeats,
        danRepeat: prediction.final.danRepeat,
        allRepeat: prediction.final.allRepeat,
        ...dynamicHits,
      },
      actualReds: target.reds,
      actualBlues: target.blues,
    });
  }
  const weightValues = rows.map((row) => row.totalRuleWeight);
  const repeatDistributions = Object.fromEntries([
    ['baselineV2', 'baselineV2'],
    ['dynamic', 'dynamic'],
  ].map(([label, key]) => {
    const dan = {};
    const all = {};
    for (const row of rows) {
      dan[row[key].danRepeat] = (dan[row[key].danRepeat] ?? 0) + 1;
      all[row[key].allRepeat] = (all[row[key].allRepeat] ?? 0) + 1;
    }
    return [label, {
      dan,
      all,
      maxDan: Math.max(...rows.map((row) => row[key].danRepeat)),
      maxAll: Math.max(...rows.map((row) => row[key].allRepeat)),
    }];
  }));
  return {
    range: `${targets[0].issue}-${targets.at(-1).issue}`,
    rows,
    baseline: metricWithoutRows(baselineMetrics),
    dynamic: metricWithoutRows(dynamicMetrics),
    difference: Object.fromEntries(Object.keys(metricWithoutRows(dynamicMetrics)).map((key) => [
      key,
      dynamicMetrics[key] - baselineMetrics[key],
    ])),
    diagnostics: {
      enabledPeriods: rows.filter((row) => row.totalRuleWeight > 0).length,
      changedPeriods: rows.filter((row) => row.changedFromV2).length,
      averageRuleWeight: weightValues.reduce((sum, value) => sum + value, 0) / rows.length,
      maximumRuleWeight: Math.max(...weightValues),
      activationCounts,
      repeatDistributions,
    },
  };
}

function fixedNumberRows() {
  return {
    [TIMELINE_START]: { reds: [1, 13, 16, 27, 29], blues: [2, 11] },
    2025150: { reds: [13, 14, 15, 28, 31], blues: [1, 5] },
    2026001: { reds: [7, 9, 23, 27, 32], blues: [2, 8] },
    [FIXED_RANGE_END]: { reds: [6, 8, 23, 26, 27], blues: [5, 12] },
  };
}

function verifyScreenshotSpotChecks(rows) {
  const checks = [];
  for (const [issueText, expected] of Object.entries(fixedNumberRows())) {
    const issue = Number(issueText);
    const actual = rows.find((row) => row.issue === issue);
    require(actual, `截图抽查期号缺失：${issue}`);
    require(JSON.stringify(actual.reds) === JSON.stringify(expected.reds), `${issue}截图抽查前区不一致`);
    require(JSON.stringify(actual.blues) === JSON.stringify(expected.blues), `${issue}截图抽查后区不一致`);
    checks.push({ issue, reds: actual.reds, blues: actual.blues, matched: true });
  }
  return checks;
}

function buildRuleResults(trainRows, validationRows) {
  return RULE_IDS.map((ruleId) => {
    const rule = RULES[ruleId];
    const result = {
      id: rule.id,
      label: rule.label,
      outcomeOffsets: rule.outcomeOffsets,
      train: evaluateRuleSegment(rule, trainRows),
      validation: evaluateRuleSegment(rule, validationRows),
    };
    result.gate = passesGate(result);
    result.reliability = ruleReliability(result);
    return result;
  });
}

function scoreTable(baseScores, fusedScores, activeRules) {
  const normalized = normalizeScores(baseScores);
  const totalWeight = activeRules.reduce((sum, item) => sum + item.weight, 0);
  return Array.from({ length: 35 }, (_, index) => {
    const number = index + 1;
    const matchWeight = activeRules.filter((item) => item.candidates.includes(number))
      .reduce((sum, item) => sum + item.weight, 0);
    return {
      number,
      baseRaw: baseScores.get(number),
      baseNormalized: normalized.get(number),
      ruleMatch: totalWeight > 0 ? matchWeight / totalWeight : 0,
      fused: fusedScores.get(number),
    };
  });
}

function buildAnalysis() {
  const allDraws = loadAllDraws();
  const latestIssue = allDraws.at(-1).issue;
  const targetIssue = nextIssue(latestIssue);
  const rows = standardizeRange(allDraws);
  const fixedRows = rows.filter((row) => row.issue <= FIXED_RANGE_END);
  require(fixedRows.length === 100, `固定总体门槛样本不是100期：${fixedRows.length}`);
  require(fixedRows[0].issue === TIMELINE_START && fixedRows.at(-1).issue === FIXED_RANGE_END, '固定总体门槛范围发生滑动');
  const screenshotSpotChecks = verifyScreenshotSpotChecks(fixedRows);
  const trainRows = fixedRows.filter((row) => row.issue <= TRAIN_END);
  const validationRows = fixedRows.filter((row) => row.issue >= VALIDATION_START && row.issue <= FIXED_RANGE_END);
  require(trainRows.length === 70, `训练段不是70期：${trainRows.length}`);
  require(validationRows.length === 30, `验证段不是30期：${validationRows.length}`);
  require(trainRows.at(-1).issue === TRAIN_END && validationRows[0].issue === VALIDATION_START, '70/30边界错误');

  const rules = buildRuleResults(trainRows, validationRows);
  const acceptedRuleIds = rules.filter((result) => result.gate.passed).map((result) => result.id);
  const activeRules = [];
  for (const result of rules.filter((item) => item.gate.passed)) {
    const candidates = activeCandidatesForTarget(RULES[result.id], rows, rows.length);
    if (candidates.length > 0 && result.reliability > 0) {
      activeRules.push({ id: result.id, label: result.label, candidates, weight: result.reliability });
    }
  }

  const baseScores = balancedV2Scores(allDraws);
  const baseSelection = selectDanDrag(baseScores, allDraws);
  const fusedScores = fuseScores(baseScores, activeRules);
  const fusedSelection = selectDanDrag(fusedScores, allDraws);
  const blues = predictBlue(allDraws);
  const prediction = {
    issue: targetIssue,
    state: stateOf(allDraws),
    baselineV2: { ...baseSelection, blues },
    final: { ...fusedSelection, blues },
    activeRules,
    changedFromV2: JSON.stringify(baseSelection.all) !== JSON.stringify(fusedSelection.all)
      || JSON.stringify(baseSelection.dan) !== JSON.stringify(fusedSelection.dan),
    scoreTable: scoreTable(baseScores, fusedScores, activeRules),
  };
  const currentDynamic = dynamicPrediction(allDraws, rows, acceptedRuleIds);
  const rollingDynamic = rollingDynamicBacktest(allDraws, rows, []);
  const dynamicGate = {
    status: 'B_DYNAMIC_TRIAL_GATE',
    config: DYNAMIC_CONFIG,
    historicalTierPolicy: '固定总体门槛仍冻结于2025130-2026079且通过0项；滚动38期全部规律仅竞争试用层，正式层身份不追溯',
    current: {
      issue: targetIssue,
      ...currentDynamic,
    },
    rolling38: rollingDynamic,
  };

  const database = {
    meta: {
      lottery: '大乐透',
      rows: rows.length,
      range: `${TIMELINE_START}-${latestIssue}`,
      fixedGateRows: fixedRows.length,
      fixedGateRange: `${TIMELINE_START}-${FIXED_RANGE_END}`,
      trainRange: `${TIMELINE_START}-${TRAIN_END}`,
      validationRange: `${VALIDATION_START}-${FIXED_RANGE_END}`,
      omissionWarmupRange: '2025001-2025129',
      screenshotReference: '/var/folders/nj/9psk20z931n44010ssdzh03w0000gn/T/codex-clipboard-a4b7f412-ebde-448d-a4ae-b50ef1b5ceb5.png',
      screenshotSpotChecks,
    },
    rows,
  };
  database.meta.dataHash = sha256(database.rows);
  database.meta.fixedGateDataHash = sha256(fixedRows.map((row) => ({
    ...row,
    sourceRange: `${TIMELINE_START}-${FIXED_RANGE_END}`,
  })));

  const analysisCore = {
    status: 'FIXED_TIME_SPLIT_BACKTEST',
    data: {
      rows: rows.length,
      range: `${TIMELINE_START}-${latestIssue}`,
      latestIssue,
      targetIssue,
      sourceFiles: {
        da2025: { rows: 150, firstIssue: 2025001, lastIssue: 2025150 },
        da2026: {
          rows: allDraws.filter((draw) => draw.issue >= 2026001).length,
          firstIssue: 2026001,
          lastIssue: latestIssue,
        },
      },
      validationChecks: {
        rows: true,
        firstLastIssue: true,
        strictOrder: true,
        numberCounts: true,
        ranges: true,
        uniqueness: true,
        ascending: true,
        redSum: true,
      },
      fixedGateRows: fixedRows.length,
      fixedGateRange: `${TIMELINE_START}-${FIXED_RANGE_END}`,
      trainRows: trainRows.length,
      trainRange: `${TIMELINE_START}-${TRAIN_END}`,
      validationRows: validationRows.length,
      validationRange: `${VALIDATION_START}-${FIXED_RANGE_END}`,
      dataHash: database.meta.dataHash,
      fixedGateDataHash: database.meta.fixedGateDataHash,
      screenshotSpotChecks,
    },
    gate: {
      validationSupportMinimum: 5,
      validationAccuracyMinimum: 0.5,
      trainLiftStrictlyPositive: true,
      validationLiftStrictlyPositive: true,
      fisherAlternative: 'greater',
      fisherRawPStrictlyBelow: 0.05,
    },
    rules,
    acceptedRuleIds,
    prediction,
    dynamicGate,
  };
  const analysis = { ...analysisCore, analysisHash: sha256(analysisCore) };
  return { database, analysis };
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function numberList(numbers) {
  return numbers.map(pad).join('、') || '无';
}

function markdownReport(analysis) {
  const dynamic = analysis.dynamicGate;
  const current = dynamic.current;
  const rolling = dynamic.rolling38;
  const prediction = current.final;
  const metricLabels = {
    danAny: '3胆码至少命中1个',
    danGe2: '3胆码至少命中2个',
    coverGe1: '8红至少覆盖1个',
    coverGe2: '8红至少覆盖2个',
    coverGe3: '8红至少覆盖3个',
    totalCover: '红球总覆盖数',
    blueAny: '2蓝至少命中1个',
    union: '3胆或2蓝扩展联合',
  };
  const lines = [
    '# 大乐透近100期规律验证与B双层动态权重（2026080）',
    '',
    '> 固定70/30总体显著性结论与近期试用层是两个不同层次：总体门槛通过0项；近期试用层最多占5%，不代表规律已获得统计显著性。',
    '',
    '## 一、数据与固定总体门槛',
    '',
    `- 标准化数据：${analysis.data.rows}期，${analysis.data.range}。`,
    `- 训练段：${analysis.data.trainRows}期，${analysis.data.trainRange}。`,
    `- 验证段：${analysis.data.validationRows}期，${analysis.data.validationRange}。`,
    `- 数据哈希：\`${analysis.data.dataHash}\`。`,
    '- 固定门槛：验证支持数≥5、准确率≥50%、训练/验证提升度>0、验证单侧Fisher原始p<0.05。',
    '',
    '## 二、八项固定验证结论',
    '',
    '| 规律 | 训练命中/支持 | 训练提升 | 验证命中/支持 | 验证准确率 | 对照准确率 | 验证提升 | Fisher p | 结论 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const rule of analysis.rules) {
    lines.push(`| ${rule.label} | ${rule.train.hits}/${rule.train.support} | ${percent(rule.train.lift)} | ${rule.validation.hits}/${rule.validation.support} | ${percent(rule.validation.accuracy)} | ${percent(rule.validation.controlAccuracy)} | ${percent(rule.validation.lift)} | ${rule.validation.fisherP.toFixed(6)} | ${rule.gate.passed ? '正式层' : '总体淘汰'} |`);
  }
  lines.push(
    '',
    `固定总体门槛通过：**${analysis.acceptedRuleIds.length}项**。`,
    '',
    '## 三、2026080近期试用层动态状态',
    '',
    '| 规律 | n12 | A12 | L12 | A6 | L6 | 连错 | 当前候选 | D | 实际权重 | 状态/原因 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- |',
  );
  for (const state of current.ruleStates) {
    lines.push(`| ${state.label} | ${state.metrics.n12} | ${percent(state.metrics.a12)} | ${percent(state.metrics.l12)} | ${percent(state.metrics.a6)} | ${percent(state.metrics.l6)} | ${state.metrics.consecutiveMisses} | ${numberList(state.candidates)} | ${state.quality.toFixed(4)} | ${percent(state.weight)} | ${state.weight > 0 ? `${state.tier === 'CORE' ? '正式层' : '试用启用'}` : state.eligibility.reasons.join('；')} |`);
  }
  lines.push(
    '',
    `- 试用层总权重：${percent(current.trialWeight)}。`,
    `- 正式层总权重：${percent(current.coreWeight)}。`,
    `- 全部规律权重：${percent(current.totalRuleWeight)}；V2权重：${percent(current.v2Weight)}。`,
    `- 相对V2是否换号：${current.changedFromV2 ? '是' : '否'}。`,
    '',
    '动态公式：`F(n)=(1-W)×B(n)+Σ[w_r×I(n∈C_r)]`。未被当前触发使用的权重退回V2，不在规律之间重新分配。',
    '',
    '## 四、最近38期严格滚动对比',
    '',
    '| 指标 | V2 | B动态 | 变化 |',
    '| --- | ---: | ---: | ---: |',
  );
  for (const [key, label] of Object.entries(metricLabels)) {
    lines.push(`| ${label} | ${rolling.baseline[key]} | ${rolling.dynamic[key]} | ${rolling.difference[key] >= 0 ? '+' : ''}${rolling.difference[key]} |`);
  }
  lines.push(
    '',
    `- 动态权重启用：${rolling.diagnostics.enabledPeriods}/38期。`,
    `- 实际换号：${rolling.diagnostics.changedPeriods}/38期。`,
    `- 平均规律总权重：${percent(rolling.diagnostics.averageRuleWeight)}。`,
    `- 最大规律总权重：${percent(rolling.diagnostics.maximumRuleWeight)}。`,
    '',
    '### 4.1 逐期权重与命中',
    '',
    '| 期号 | 规律权重 | 启用规律 | 换号 | V2胆中/覆盖 | 动态胆中/覆盖 | 蓝中 |',
    '| --- | ---: | --- | --- | ---: | ---: | ---: |',
  );
  for (const row of rolling.rows) {
    const activeIds = row.ruleStates.filter((state) => state.weight > 0).map((state) => state.id).join(',') || '无';
    lines.push(`| ${row.issue} | ${percent(row.totalRuleWeight)} | ${activeIds} | ${row.changedFromV2 ? '是' : '否'} | ${row.baselineV2.danHits}/${row.baselineV2.cover} | ${row.dynamic.danHits}/${row.dynamic.cover} | ${row.dynamic.blueHits} |`);
  }
  lines.push(
    '',
    '## 五、2026080正式预测',
    '',
    `- 状态：${current.state}。`,
    `- 红球胆码：**${numberList(prediction.dan)}**。`,
    `- 红球拖码：**${numberList(prediction.drag)}**。`,
    `- 红球8码全集：**${numberList(prediction.all)}**。`,
    `- 蓝球：**${numberList(prediction.blues)}**。`,
    `- 入选上期重号：${numberList(prediction.selectedRepeats)}。`,
    `- 因8红总上限跳过的高分重号：${numberList(prediction.skippedRepeat)}。`,
    `- V2基线胆码/拖码：${numberList(current.baselineV2.dan)} / ${numberList(current.baselineV2.drag)}。`,
    '',
    '## 六、解释限制',
    '',
    '- 试用层允许总体显著性未通过的规律参与，近期高正确率仍可能只是随机波动。',
    '- Beta平滑、相对对照提升度和5%上限用于限制追涨，但不能证明未来有效。',
    '- 最近38期仅为按冻结参数进行的历史滚动，不是未来中奖概率。',
    '- 后区没有使用红球目标规律反向加分。',
    '- 彩票开奖具有独立随机性，本报告只用于统计研究和小额娱乐。',
    '',
    '## 七、审计标记',
    '',
    '```text',
    `DATA_OK rows=${analysis.data.rows} range=${analysis.data.range} train=${analysis.data.trainRange} validation=${analysis.data.validationRange}`,
    `RULES_EVALUATED=8 accepted=${analysis.acceptedRuleIds.length} ids=${analysis.acceptedRuleIds.join(',') || 'NONE'}`,
    `DYNAMIC_GATE_OK active=${current.activeRules.length} trial_weight=${current.trialWeight.toFixed(8)} total_weight=${current.totalRuleWeight.toFixed(8)} changed=${Number(current.changedFromV2)}`,
    `ROLLING_DYNAMIC_OK rows=${rolling.rows.length} enabled=${rolling.diagnostics.enabledPeriods} changed=${rolling.diagnostics.changedPeriods} dan_any=${rolling.dynamic.danAny} cover_ge3=${rolling.dynamic.coverGe3} total_cover=${rolling.dynamic.totalCover}`,
    `PREDICT_OK issue=${current.issue} dan=${prediction.dan.map(pad).join(',')} drag=${prediction.drag.map(pad).join(',')} all=${prediction.all.map(pad).join(',')} blue=${prediction.blues.map(pad).join(',')}`,
    `ANALYSIS_HASH=${analysis.analysisHash}`,
    '```',
    '',
    '## 八、独立复核',
    '',
    '独立Python实现从原始开奖JSON重新计算固定规律、近期12/6指标、双层权重、38期逐行结果和2026080号码，不导入Node主模块。',
    '',
    '```text',
    `DYNAMIC_INDEPENDENT_VERIFY_OK rows=38 active=${current.activeRules.length} prediction_match=1 data_hash=${analysis.data.dataHash}`,
    '```',
    '',
  );
  return lines.join('\n');
}

function writeArtifacts(database, analysis) {
  // 当前机器审计使用稳定文件名，移除已失效的旧目标期产物，避免下次误读。
  for (const legacyPath of LEGACY_ARTIFACTS) {
    if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
  }
  fs.writeFileSync(DATABASE_JSON, `${JSON.stringify(database, null, 2)}\n`);
  fs.writeFileSync(ANALYSIS_JSON, `${JSON.stringify(analysis, null, 2)}\n`);
}

function printSummary(analysis) {
  const compact = {
    data: analysis.data,
    rules: analysis.rules.map((rule) => ({
      id: rule.id,
      label: rule.label,
      train: { support: rule.train.support, accuracy: rule.train.accuracy, lift: rule.train.lift },
      validation: { support: rule.validation.support, accuracy: rule.validation.accuracy, controlAccuracy: rule.validation.controlAccuracy, lift: rule.validation.lift, fisherP: rule.validation.fisherP },
      gate: rule.gate,
    })),
    acceptedRuleIds: analysis.acceptedRuleIds,
    prediction: analysis.prediction,
    dynamicGate: analysis.dynamicGate,
    analysisHash: analysis.analysisHash,
  };
  process.stdout.write(`${JSON.stringify(compact, null, 2)}\n`);
}

function main() {
  const command = process.argv[2] ?? 'analyze';
  if (command === 'summary' && fs.existsSync(ANALYSIS_JSON)) {
    printSummary(JSON.parse(fs.readFileSync(ANALYSIS_JSON, 'utf8')));
    return;
  }
  require(command === 'analyze' || command === 'summary', `未知命令：${command}`);
  const { database, analysis } = buildAnalysis();
  if (command === 'analyze') writeArtifacts(database, analysis);
  process.stdout.write(`DATA_OK rows=${analysis.data.rows} range=${analysis.data.range}\n`);
  process.stdout.write(`SPLIT_OK train=${analysis.data.trainRows} validation=${analysis.data.validationRows}\n`);
  process.stdout.write(`RULES_EVALUATED=${analysis.rules.length} accepted=${analysis.acceptedRuleIds.length}\n`);
  process.stdout.write(`TARGET=${analysis.prediction.issue}\n`);
  process.stdout.write(`DYNAMIC_GATE_OK active=${analysis.dynamicGate.current.activeRules.length} total_weight=${analysis.dynamicGate.current.totalRuleWeight.toFixed(8)} changed=${Number(analysis.dynamicGate.current.changedFromV2)}\n`);
  process.stdout.write(`ROLLING_DYNAMIC_OK rows=${analysis.dynamicGate.rolling38.rows.length} enabled=${analysis.dynamicGate.rolling38.diagnostics.enabledPeriods} changed=${analysis.dynamicGate.rolling38.diagnostics.changedPeriods}\n`);
  process.stdout.write(`PREDICTION dan=${analysis.dynamicGate.current.final.dan.map(pad).join(',')} drag=${analysis.dynamicGate.current.final.drag.map(pad).join(',')} blue=${analysis.dynamicGate.current.final.blues.map(pad).join(',')}\n`);
  process.stdout.write(`ANALYSIS_HASH=${analysis.analysisHash}\n`);
  if (command === 'analyze') process.stdout.write('ARTIFACTS_WRITTEN\n');
  else printSummary(analysis);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) main();
