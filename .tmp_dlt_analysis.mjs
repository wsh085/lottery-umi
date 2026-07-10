import fs from 'node:fs';

const DATA_PATH = 'data/da_2026_data.json';
const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

const parseNumbers = (value) => value.trim().split(/\s+/).map(Number);
const formatNumber = (value) => String(value).padStart(2, '0');
const zoneOf = (value) => (value <= 12 ? 0 : value <= 24 ? 1 : 2);

const draws = raw.map((row) => {
  const reds = parseNumbers(row['红球']);
  const blues = parseNumbers(row['蓝球']);
  const odd = reds.filter((value) => value % 2 === 1).length;
  const zones = [0, 0, 0];
  reds.forEach((value) => {
    zones[zoneOf(value)] += 1;
  });

  return {
    issue: row['期数'],
    reds,
    blues,
    odd,
    even: reds.length - odd,
    sum: reds.reduce((total, value) => total + value, 0),
    zones,
    source: row,
  };
});

function validateData() {
  const errors = [];
  const issueSet = new Set();

  draws.forEach((draw, index) => {
    if (issueSet.has(draw.issue)) errors.push(`${draw.issue}: 重复期号`);
    issueSet.add(draw.issue);
    if (index > 0 && Number(draw.issue) <= Number(draws[index - 1].issue)) {
      errors.push(`${draw.issue}: 期号未严格递增`);
    }
    if (draw.reds.length !== 5 || new Set(draw.reds).size !== 5) {
      errors.push(`${draw.issue}: 红球数量或唯一性错误`);
    }
    if (draw.blues.length !== 2 || new Set(draw.blues).size !== 2) {
      errors.push(`${draw.issue}: 蓝球数量或唯一性错误`);
    }
    if (draw.reds.some((value) => value < 1 || value > 35)) {
      errors.push(`${draw.issue}: 红球越界`);
    }
    if (draw.blues.some((value) => value < 1 || value > 12)) {
      errors.push(`${draw.issue}: 蓝球越界`);
    }
    if (draw.reds.some((value, i) => i > 0 && value <= draw.reds[i - 1])) {
      errors.push(`${draw.issue}: 红球未严格升序`);
    }
    if (draw.blues.some((value, i) => i > 0 && value <= draw.blues[i - 1])) {
      errors.push(`${draw.issue}: 蓝球未严格升序`);
    }
    if (draw.sum !== Number(draw.source['和值'])) {
      errors.push(`${draw.issue}: 和值不一致`);
    }
    if (`${draw.odd}:${draw.even}` !== draw.source['奇偶比']) {
      errors.push(`${draw.issue}: 奇偶比不一致`);
    }
  });

  return errors;
}

function frequency(train, field, maxNumber, window) {
  const sample = train.slice(-Math.min(window, train.length));
  const counts = Array(maxNumber + 1).fill(0);
  sample.forEach((draw) => draw[field].forEach((value) => counts[value] += 1));
  return { counts, size: sample.length };
}

function omission(train, field, number) {
  for (let i = train.length - 1, gap = 0; i >= 0; i -= 1, gap += 1) {
    if (train[i][field].includes(number)) return gap;
  }
  return train.length;
}

function triangularPreference(value, center, radius) {
  return Math.max(0, 1 - Math.abs(value - center) / radius);
}

function chooseReds(train, config) {
  const fShort = frequency(train, 'reds', 35, config.shortWindow);
  const fMedium = frequency(train, 'reds', 35, config.mediumWindow);
  const fLong = frequency(train, 'reds', 35, config.longWindow);
  const recent = train.slice(-Math.min(config.balanceWindow, train.length));
  const recentZoneAverages = [0, 1, 2].map((zone) =>
    recent.reduce((total, draw) => total + draw.zones[zone], 0) / recent.length,
  );
  const longZoneAverages = [0, 1, 2].map((zone) =>
    train.reduce((total, draw) => total + draw.zones[zone], 0) / train.length,
  );
  const zoneDeficits = recentZoneAverages.map((value, zone) => longZoneAverages[zone] - value);
  const coldZone = zoneDeficits.indexOf(Math.max(...zoneDeficits));
  const recentOddAverage = recent.reduce((total, draw) => total + draw.odd, 0) / recent.length;
  const longOddAverage = train.reduce((total, draw) => total + draw.odd, 0) / train.length;
  const coldParity = recentOddAverage < longOddAverage ? 1 : 0;
  const previousReds = new Set(train.at(-1).reds);

  const candidates = Array.from({ length: 35 }, (_, index) => index + 1).map((number) => {
    const gap = omission(train, 'reds', number);
    const zone = zoneOf(number);
    const parity = number % 2;
    const score =
      config.shortWeight * (fShort.counts[number] / fShort.size) +
      config.mediumWeight * (fMedium.counts[number] / fMedium.size) +
      config.longWeight * (fLong.counts[number] / fLong.size) +
      config.omissionWeight * triangularPreference(gap, config.omissionCenter, config.omissionRadius) +
      config.repeatWeight * Number(previousReds.has(number)) +
      config.zoneWeight * Number(zone === coldZone) +
      config.parityWeight * Number(parity === coldParity);

    return { number, score, gap, zone, parity };
  });

  candidates.sort((a, b) => b.score - a.score || a.number - b.number);
  const first = candidates[0];
  const second = candidates
    .filter((candidate) => candidate.number !== first.number)
    .map((candidate) => ({
      ...candidate,
      adjustedScore:
        candidate.score +
        config.crossZoneWeight * Number(candidate.zone !== first.zone) +
        config.crossParityWeight * Number(candidate.parity !== first.parity),
    }))
    .sort((a, b) => b.adjustedScore - a.adjustedScore || a.number - b.number)[0];

  return [first.number, second.number].sort((a, b) => a - b);
}

function chooseBlue(train, config) {
  const fShort = frequency(train, 'blues', 12, config.shortWindow);
  const fMedium = frequency(train, 'blues', 12, config.mediumWindow);
  const fLong = frequency(train, 'blues', 12, config.longWindow);
  const previousBlues = new Set(train.at(-1).blues);

  return Array.from({ length: 12 }, (_, index) => index + 1)
    .map((number) => {
      const gap = omission(train, 'blues', number);
      const score =
        config.shortWeight * (fShort.counts[number] / fShort.size) +
        config.mediumWeight * (fMedium.counts[number] / fMedium.size) +
        config.longWeight * (fLong.counts[number] / fLong.size) +
        config.omissionWeight * triangularPreference(gap, config.omissionCenter, config.omissionRadius) +
        config.repeatWeight * Number(previousBlues.has(number));
      return { number, score, gap };
    })
    .sort((a, b) => b.score - a.score || a.number - b.number)[0].number;
}

function backtest(redConfig, blueConfig) {
  const validationStart = draws.length - 38;
  const rows = [];

  for (let targetIndex = validationStart; targetIndex < draws.length; targetIndex += 1) {
    const train = draws.slice(0, targetIndex);
    const actual = draws[targetIndex];
    const predictedReds = chooseReds(train, redConfig);
    const predictedBlue = chooseBlue(train, blueConfig);
    const redMatches = predictedReds.filter((number) => actual.reds.includes(number));
    const blueHit = actual.blues.includes(predictedBlue);
    const hit = redMatches.length > 0 || blueHit;
    rows.push({
      issue: actual.issue,
      predictedReds,
      predictedBlue,
      actualReds: actual.reds,
      actualBlues: actual.blues,
      redMatches,
      blueHit,
      hit,
    });
  }

  return {
    hitCount: rows.filter((row) => row.hit).length,
    redHitCount: rows.filter((row) => row.redMatches.length > 0).length,
    blueHitCount: rows.filter((row) => row.blueHit).length,
    bothHitCount: rows.filter((row) => row.redMatches.length > 0 && row.blueHit).length,
    rows,
  };
}

const baselineRed = {
  shortWindow: 5,
  mediumWindow: 10,
  longWindow: 20,
  balanceWindow: 10,
  shortWeight: 1,
  mediumWeight: 0.8,
  longWeight: 0.4,
  omissionWeight: 0.5,
  omissionCenter: 4,
  omissionRadius: 8,
  repeatWeight: 0.2,
  zoneWeight: 0.3,
  parityWeight: 0.2,
  crossZoneWeight: 0.08,
  crossParityWeight: 0.05,
};

const baselineBlue = {
  shortWindow: 5,
  mediumWindow: 12,
  longWindow: 24,
  shortWeight: 1,
  mediumWeight: 0.8,
  longWeight: 0.4,
  omissionWeight: 0.5,
  omissionCenter: 4,
  omissionRadius: 8,
  repeatWeight: 0.1,
};

const redVariants = [
  ['baseline', baselineRed],
  ['mediumHot', {
    ...baselineRed,
    shortWindow: 5,
    mediumWindow: 12,
    longWindow: 30,
    shortWeight: 0.8,
    mediumWeight: 1,
    longWeight: 0.6,
    omissionWeight: 0.3,
    repeatWeight: 0.25,
    zoneWeight: 0.15,
    parityWeight: 0.1,
    crossZoneWeight: 0.15,
    crossParityWeight: 0.1,
  }],
  ['moderateOmission', {
    ...baselineRed,
    shortWindow: 8,
    mediumWindow: 16,
    longWindow: 32,
    shortWeight: 0.6,
    mediumWeight: 0.8,
    longWeight: 0.5,
    omissionWeight: 0.8,
    omissionCenter: 6,
    omissionRadius: 8,
    repeatWeight: 0.15,
    zoneWeight: 0.25,
    parityWeight: 0.15,
  }],
  ['coldZoneRebound', {
    ...baselineRed,
    shortWindow: 6,
    mediumWindow: 14,
    longWindow: 30,
    shortWeight: 0.6,
    mediumWeight: 0.7,
    longWeight: 0.4,
    omissionWeight: 0.65,
    omissionCenter: 5,
    repeatWeight: -0.1,
    zoneWeight: 0.6,
    parityWeight: 0.3,
  }],
  ['antiRepeat', {
    ...baselineRed,
    omissionCenter: 6,
    omissionWeight: 0.65,
    repeatWeight: -0.25,
    zoneWeight: 0.2,
    parityWeight: 0.1,
  }],
  ['longHot', {
    ...baselineRed,
    shortWindow: 10,
    mediumWindow: 20,
    longWindow: 38,
    shortWeight: 0.6,
    mediumWeight: 0.8,
    longWeight: 0.8,
    omissionWeight: 0.3,
    repeatWeight: 0.15,
    zoneWeight: 0.2,
    parityWeight: 0.1,
  }],
  ['recentHot', {
    ...baselineRed,
    shortWindow: 5,
    mediumWindow: 10,
    longWindow: 20,
    shortWeight: 1.4,
    mediumWeight: 0.35,
    longWeight: 0.15,
    omissionWeight: 0.2,
    repeatWeight: 0.35,
    zoneWeight: 0.1,
    parityWeight: 0.05,
  }],
];

const blueVariants = [
  ['baseline', baselineBlue],
  ['recentHot', {
    ...baselineBlue,
    shortWindow: 4,
    mediumWindow: 8,
    longWindow: 20,
    shortWeight: 1.3,
    mediumWeight: 0.6,
    longWeight: 0.2,
    omissionWeight: 0.2,
    repeatWeight: 0.2,
  }],
  ['mediumHot', {
    ...baselineBlue,
    shortWindow: 6,
    mediumWindow: 12,
    longWindow: 24,
    shortWeight: 0.7,
    mediumWeight: 1,
    longWeight: 0.6,
    omissionWeight: 0.3,
    omissionCenter: 5,
    repeatWeight: 0,
  }],
  ['moderateOmission', {
    ...baselineBlue,
    shortWindow: 6,
    mediumWindow: 12,
    longWindow: 24,
    shortWeight: 0.4,
    mediumWeight: 0.6,
    longWeight: 0.3,
    omissionWeight: 1,
    omissionCenter: 6,
    omissionRadius: 6,
    repeatWeight: -0.1,
  }],
  ['overdue', {
    ...baselineBlue,
    shortWindow: 8,
    mediumWindow: 16,
    longWindow: 32,
    shortWeight: 0.3,
    mediumWeight: 0.4,
    longWeight: 0.2,
    omissionWeight: 1.2,
    omissionCenter: 8,
    omissionRadius: 10,
    repeatWeight: -0.2,
  }],
  ['repeat', {
    ...baselineBlue,
    omissionWeight: 0.25,
    repeatWeight: 0.8,
  }],
  ['antiRepeat', {
    ...baselineBlue,
    omissionWeight: 0.7,
    omissionCenter: 5,
    repeatWeight: -0.5,
  }],
];

const calibrationResults = redVariants.flatMap(([redName, redConfig]) =>
  blueVariants.map(([blueName, blueConfig]) => {
    const result = backtest(redConfig, blueConfig);
    return {
      redName,
      blueName,
      hitCount: result.hitCount,
      redHitCount: result.redHitCount,
      blueHitCount: result.blueHitCount,
      bothHitCount: result.bothHitCount,
      nextReds: chooseReds(draws, redConfig).map(formatNumber).join(' '),
      nextBlue: formatNumber(chooseBlue(draws, blueConfig)),
    };
  }),
).sort((a, b) => b.hitCount - a.hitCount || a.redName.localeCompare(b.redName) || a.blueName.localeCompare(b.blueName));

const errors = validateData();
const recentTen = draws.slice(-10);
const baseline = backtest(baselineRed, baselineBlue);
const finalRedConfig = redVariants.find(([name]) => name === 'longHot')[1];
const finalBlueConfig = blueVariants.find(([name]) => name === 'moderateOmission')[1];
const finalResult = backtest(finalRedConfig, finalBlueConfig);
const finalReds = chooseReds(draws, finalRedConfig);
const finalBlue = chooseBlue(draws, finalBlueConfig);

const recentSums = recentTen.map((draw) => draw.sum);
const sortedRecentSums = [...recentSums].sort((a, b) => a - b);
const recentMean = recentSums.reduce((total, value) => total + value, 0) / recentSums.length;
const recentVariance = recentSums.reduce((total, value) => total + (value - recentMean) ** 2, 0) / recentSums.length;
const zoneTotals = [0, 1, 2].map((zone) => recentTen.reduce((total, draw) => total + draw.zones[zone], 0));
const adjacentRepeats = recentTen.slice(1).map((draw, index) =>
  draw.reds.filter((number) => recentTen[index].reds.includes(number)),
);

function selectedRedDiagnostics(number) {
  return {
    number: formatNumber(number),
    count10: frequency(draws, 'reds', 35, 10).counts[number],
    count20: frequency(draws, 'reds', 35, 20).counts[number],
    count38: frequency(draws, 'reds', 35, 38).counts[number],
    omission: omission(draws, 'reds', number),
    zone: zoneOf(number) + 1,
    parity: number % 2 === 1 ? '奇' : '偶',
    previousRepeat: draws.at(-1).reds.includes(number),
  };
}

function selectedBlueDiagnostics(number) {
  return {
    number: formatNumber(number),
    count6: frequency(draws, 'blues', 12, 6).counts[number],
    count12: frequency(draws, 'blues', 12, 12).counts[number],
    count24: frequency(draws, 'blues', 12, 24).counts[number],
    omission: omission(draws, 'blues', number),
    previousRepeat: draws.at(-1).blues.includes(number),
  };
}

console.log(JSON.stringify({
  validation: {
    count: draws.length,
    firstIssue: draws[0].issue,
    lastIssue: draws.at(-1).issue,
    errorCount: errors.length,
    errors,
  },
  recentTen: recentTen.map((draw) => ({
    issue: draw.issue,
    reds: draw.reds.map(formatNumber).join(' '),
    oddEven: `${draw.odd}:${draw.even}`,
    sum: draw.sum,
    zones: draw.zones.join(':'),
    blues: draw.blues.map(formatNumber).join(' '),
  })),
  baseline: {
    hitCount: baseline.hitCount,
    redHitCount: baseline.redHitCount,
    blueHitCount: baseline.blueHitCount,
    bothHitCount: baseline.bothHitCount,
  },
  calibrationResults: calibrationResults.slice(0, 10),
  recentStats: {
    oddTotal: recentTen.reduce((total, draw) => total + draw.odd, 0),
    evenTotal: recentTen.reduce((total, draw) => total + draw.even, 0),
    sumMean: recentMean,
    sumMedian: (sortedRecentSums[4] + sortedRecentSums[5]) / 2,
    sumMin: Math.min(...recentSums),
    sumMax: Math.max(...recentSums),
    sumPopulationStdDev: Math.sqrt(recentVariance),
    zoneTotals,
    adjacentRepeatGroupsWithMatches: adjacentRepeats.filter((numbers) => numbers.length > 0).length,
    adjacentRepeatCount: adjacentRepeats.reduce((total, numbers) => total + numbers.length, 0),
    adjacentRepeats: adjacentRepeats.map((numbers) => numbers.map(formatNumber).join(' ')),
  },
  final: {
    hitCount: finalResult.hitCount,
    redHitCount: finalResult.redHitCount,
    blueHitCount: finalResult.blueHitCount,
    bothHitCount: finalResult.bothHitCount,
    nextReds: finalReds.map(formatNumber),
    nextBlue: formatNumber(finalBlue),
    redDiagnostics: finalReds.map(selectedRedDiagnostics),
    blueDiagnostics: selectedBlueDiagnostics(finalBlue),
    rows: finalResult.rows.map((row) => ({
      ...row,
      predictedReds: row.predictedReds.map(formatNumber).join(' '),
      predictedBlue: formatNumber(row.predictedBlue),
      actualReds: row.actualReds.map(formatNumber).join(' '),
      actualBlues: row.actualBlues.map(formatNumber).join(' '),
      redMatches: row.redMatches.map(formatNumber).join(' '),
    })),
  },
  allMetrics: draws.map((draw) => ({
    issue: draw.issue,
    reds: draw.reds.map(formatNumber).join(' '),
    oddEven: `${draw.odd}:${draw.even}`,
    sum: draw.sum,
    zones: draw.zones.join(':'),
    blues: draw.blues.map(formatNumber).join(' '),
  })),
  next: {
    reds: chooseReds(draws, baselineRed).map(formatNumber),
    blue: formatNumber(chooseBlue(draws, baselineBlue)),
  },
}, null, 2));
