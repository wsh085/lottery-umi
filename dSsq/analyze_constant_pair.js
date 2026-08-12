/**
 * 恒值数配对法验证脚本
 * 规则：每期红球中，存在两个号码相加等于34
 * 理论配对：(1,33),(2,32),(3,31),(4,30),(5,29),(6,28),(7,27),(8,26),
 *           (9,25),(10,24),(11,23),(12,22),(13,21),(14,20),(15,19),(16,18)
 * 注：17+17=34，但红球中同一号码不重复，所以不计入
 */

const fs = require("fs");
const path = require("path");

// 恒值34的所有可能配对
const CONSTANT_SUM = 34;
const ALL_PAIRS = [];
for (let i = 1; i <= 16; i++) {
  ALL_PAIRS.push([i, CONSTANT_SUM - i]);
}

/**
 * 解析红球字符串为数字数组
 * @param {string} redStr - 如 "02 03 17 18 22 33"
 * @returns {number[]}
 */
function parseRedBalls(redStr) {
  return redStr.trim().split(/\s+/).map(Number);
}

/**
 * 查找一期中所有和为34的配对
 * @param {number[]} balls - 6个红球号码
 * @returns {Array<[number, number]>} 找到的配对数组
 */
function findConstantPairs(balls) {
  const pairs = [];
  const ballSet = new Set(balls);

  for (const [a, b] of ALL_PAIRS) {
    if (ballSet.has(a) && ballSet.has(b)) {
      pairs.push([a, b]);
    }
  }
  return pairs;
}

/**
 * 分析单个数据文件
 * @param {string} filePath - JSON文件路径
 * @param {string} label - 标签名称
 */
function analyzeFile(filePath, label) {
  const rawData = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(rawData);

  let hitCount = 0; // 命中恒值配对的期数
  let totalPairs = 0; // 总共出现的配对数
  const pairFrequency = {}; // 各配对出现频次
  const hitDetails = []; // 命中详情
  const missCount = data.length - hitCount;

  // 初始化配对频次
  for (const [a, b] of ALL_PAIRS) {
    pairFrequency[
      `${a.toString().padStart(2, "0")}+${b.toString().padStart(2, "0")}`
    ] = 0;
  }

  for (const item of data) {
    const balls = parseRedBalls(item.红球);
    const pairs = findConstantPairs(balls);

    if (pairs.length > 0) {
      hitCount++;
      totalPairs += pairs.length;
      pairs.forEach(([a, b]) => {
        const key = `${a.toString().padStart(2, "0")}+${b.toString().padStart(2, "0")}`;
        pairFrequency[key]++;
      });
      hitDetails.push({
        期数: item.期数,
        红球: item.红球,
        配对: pairs.map(
          ([a, b]) =>
            `${a.toString().padStart(2, "0")}+${b.toString().padStart(2, "0")}=34`,
        ),
        配对数: pairs.length,
      });
    }
  }

  return {
    label,
    totalPeriods: data.length,
    hitCount,
    missCount: data.length - hitCount,
    hitRate: ((hitCount / data.length) * 100).toFixed(2),
    totalPairs,
    avgPairsPerHit: (totalPairs / hitCount).toFixed(2),
    pairFrequency,
    hitDetails,
  };
}

/**
 * 打印分析结果
 */
function printResult(result) {
  console.log("\n" + "=".repeat(70));
  console.log(`  ${result.label} 恒值数配对法验证结果`);
  console.log("=".repeat(70));
  console.log(`  总期数：${result.totalPeriods} 期`);
  console.log(`  命中期数：${result.hitCount} 期`);
  console.log(`  未命中期数：${result.missCount} 期`);
  console.log(`  命中率：${result.hitRate}%`);
  console.log(`  总配对出现次数：${result.totalPairs} 次`);
  console.log(`  命中期平均配对数：${result.avgPairsPerHit} 对/期`);
  console.log("-".repeat(70));
  console.log("  各配对出现频次：");
  console.log("-".repeat(70));

  const sorted = Object.entries(result.pairFrequency).sort(
    (a, b) => b[1] - a[1],
  );

  sorted.forEach(([pair, count], idx) => {
    const bar = "█".repeat(count) + "░".repeat(Math.max(0, 10 - count));
    console.log(
      `  ${(idx + 1).toString().padStart(2, "0")}. ${pair} = 34  出现 ${count.toString().padStart(3, "0")} 次  ${bar}`,
    );
  });

  console.log("-".repeat(70));
  console.log(`  命中详情（最近20期）：`);
  console.log("-".repeat(70));
  result.hitDetails.slice(-20).forEach((d) => {
    console.log(`  期数 ${d.期数} | 红球: ${d.红球} | ${d.配对.join(", ")}`);
  });
  console.log("=".repeat(70));
}

// ===== 主程序 =====
const dataDir = __dirname;
const file2025 = path.join(dataDir, "shuang_2025_data.json");
const file2026 = path.join(dataDir, "shuang_2026_data.json");

const result2025 = analyzeFile(file2025, "2025年");
const result2026 = analyzeFile(file2026, "2026年");

printResult(result2025);
printResult(result2026);

// 汇总统计
const totalAll = result2025.totalPeriods + result2026.totalPeriods;
const hitAll = result2025.hitCount + result2026.hitCount;
console.log("\n" + "=".repeat(70));
console.log("  汇总统计（2025 + 2026）");
console.log("=".repeat(70));
console.log(`  总期数：${totalAll} 期`);
console.log(`  命中期数：${hitAll} 期`);
console.log(`  总命中率：${((hitAll / totalAll) * 100).toFixed(2)}%`);
console.log("=".repeat(70) + "\n");
