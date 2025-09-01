const fs = require("fs");
const path = require("path");

/**
 * 高级数据同步脚本
 * 功能：检测temp文件中的新增数据，并同步到目标文件（包括Word文档处理）
 * 注意：Word文档处理需要安装docx库：npm install docx
 */

// 尝试导入docx库，如果没有安装则使用备用方案
let Document, Packer, Paragraph, TextRun;
try {
  const docx = require("docx");
  Document = docx.Document;
  Packer = docx.Packer;
  Paragraph = docx.Paragraph;
  TextRun = docx.TextRun;
} catch (error) {
  console.log("⚠️  docx库未安装，将使用文本文件作为Word文档的替代方案");
  console.log("💡 如需真正的Word文档支持，请运行: pnpm add docx");
}

/**
 * 读取JSON文件
 * @param {string} filePath 文件路径
 * @returns {Array} JSON数据数组
 */
function readJsonFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8");
      return JSON.parse(content);
    }
    return [];
  } catch (error) {
    console.error(`读取文件失败: ${filePath}`, error);
    return [];
  }
}

/**
 * 写入JSON文件
 * @param {string} filePath 文件路径
 * @param {Array} data 数据数组
 */
function writeJsonFile(filePath, data) {
  try {
    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`✅ 文件更新成功: ${filePath}`);
  } catch (error) {
    console.error(`写入文件失败: ${filePath}`, error);
  }
}

/**
 * 检测新增数据
 * @param {Array} tempData temp文件数据
 * @param {Array} existingData 现有文件数据
 * @returns {Array} 新增的数据
 */
function detectNewData(tempData, existingData) {
  const existingPeriods = new Set(existingData.map((item) => item.期数));
  return tempData.filter((item) => !existingPeriods.has(item.期数));
}

/**
 * 创建Word文档内容
 * @param {Array} newData 新增数据
 * @param {string} title 文档标题
 * @returns {Document} Word文档对象
 */
function createWordDocument(newData, title) {
  if (!Document) {
    throw new Error("docx库未安装，无法创建Word文档");
  }

  const paragraphs = [
    new Paragraph({
      children: [
        new TextRun({
          text: title,
          bold: true,
          size: 28,
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `更新时间: ${new Date().toLocaleString("zh-CN")}`,
          size: 20,
        }),
      ],
    }),
    new Paragraph({ text: "" }), // 空行
  ];

  newData.forEach((item, index) => {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `第 ${index + 1} 条记录`,
            bold: true,
            size: 24,
          }),
        ],
      }),
      new Paragraph({
        children: [new TextRun({ text: `期数: ${item.期数}`, size: 20 })],
      }),
      new Paragraph({
        children: [new TextRun({ text: `红球: ${item.红球}`, size: 20 })],
      }),
      new Paragraph({
        children: [new TextRun({ text: `蓝球: ${item.蓝球}`, size: 20 })],
      }),
      new Paragraph({
        children: [new TextRun({ text: `和值: ${item.和值}`, size: 20 })],
      }),
      new Paragraph({
        children: [new TextRun({ text: `和尾: ${item.和尾}`, size: 20 })],
      }),
      new Paragraph({
        children: [new TextRun({ text: `跨度: ${item.跨度}`, size: 20 })],
      }),
      new Paragraph({
        children: [new TextRun({ text: `大小比: ${item.大小比}`, size: 20 })],
      }),
      new Paragraph({
        children: [new TextRun({ text: `奇偶比: ${item.奇偶比}`, size: 20 })],
      }),
      new Paragraph({
        children: [new TextRun({ text: `质合比: ${item.质合比}`, size: 20 })],
      }),
      new Paragraph({
        children: [new TextRun({ text: `012路: ${item["012路"]}`, size: 20 })],
      }),
      new Paragraph({
        children: [new TextRun({ text: `大中小: ${item.大中小}`, size: 20 })],
      }),
      new Paragraph({ text: "" }) // 空行分隔
    );
  });

  return new Document({
    sections: [
      {
        properties: {},
        children: paragraphs,
      },
    ],
  });
}

/**
 * 更新Word文档
 * @param {string} docPath Word文档路径
 * @param {Array} newData 新增数据
 * @param {string} title 文档标题
 */
async function updateWordDoc(docPath, newData, title) {
  try {
    if (newData.length === 0) {
      console.log(`📄 ${docPath} - 无新增数据需要更新`);
      return;
    }

    if (Document && Packer) {
      // 使用docx库创建真正的Word文档
      const doc = createWordDocument(newData, title);
      const buffer = await Packer.toBuffer(doc);

      // 创建新的Word文档（追加模式需要更复杂的处理）
      const newDocPath = docPath.replace(".docx", `_update_${Date.now()}.docx`);
      fs.writeFileSync(newDocPath, buffer);
      console.log(
        `📄 Word文档创建成功: ${newDocPath} (添加了 ${newData.length} 条新记录)`
      );
    } else {
      // 备用方案：创建文本文件
      let appendText = `\n\n=== ${title} - 新增数据 ===\n`;
      appendText += `更新时间: ${new Date().toLocaleString("zh-CN")}\n\n`;

      newData.forEach((item, index) => {
        appendText += `第 ${index + 1} 条记录:\n`;
        appendText += `期数: ${item.期数}\n`;
        appendText += `红球: ${item.红球}\n`;
        appendText += `蓝球: ${item.蓝球}\n`;
        appendText += `和值: ${item.和值}\n`;
        appendText += `和尾: ${item.和尾}\n`;
        appendText += `跨度: ${item.跨度}\n`;
        appendText += `大小比: ${item.大小比}\n`;
        appendText += `奇偶比: ${item.奇偶比}\n`;
        appendText += `质合比: ${item.质合比}\n`;
        appendText += `012路: ${item["012路"]}\n`;
        appendText += `大中小: ${item.大中小}\n`;
        appendText += "---\n";
      });

      const txtPath = docPath.replace(".docx", "_update.txt");
      fs.appendFileSync(txtPath, appendText, "utf8");
      console.log(
        `📄 文本文档更新成功: ${txtPath} (添加了 ${newData.length} 条新记录)`
      );
    }
  } catch (error) {
    console.error(`更新Word文档失败: ${docPath}`, error);
  }
}

/**
 * 同步大乐透数据
 */
async function syncDaLeTouData() {
  console.log("\n🎯 开始同步大乐透数据...");

  const tempPath = "./data/temp_all_history_data.json";
  const allHistoryPath = "./data/all_history_data.json";
  const da2025Path = "./data/da_2025_data.json";
  const docPath = "./data/da_2025_data.docx";

  // 读取temp数据
  const tempData = readJsonFile(tempPath);
  if (tempData.length === 0) {
    console.log("❌ temp文件为空或读取失败");
    return;
  }

  // 同步到all_history_data.json
  const allHistoryData = readJsonFile(allHistoryPath);
  const newDataForAll = detectNewData(tempData, allHistoryData);
  if (newDataForAll.length > 0) {
    const updatedAllData = [...allHistoryData, ...newDataForAll];
    writeJsonFile(allHistoryPath, updatedAllData);
  } else {
    console.log("📋 all_history_data.json - 无新增数据");
  }

  // 同步到da_2025_data.json（只同步2025年的数据）
  const da2025Data = readJsonFile(da2025Path);
  const temp2025Data = tempData.filter((item) => item.期数.startsWith("2025"));
  const newDataFor2025 = detectNewData(temp2025Data, da2025Data);
  if (newDataFor2025.length > 0) {
    const updated2025Data = [...da2025Data, ...newDataFor2025];
    writeJsonFile(da2025Path, updated2025Data);
  } else {
    console.log("📋 da_2025_data.json - 无新增数据");
  }

  // 更新Word文档
  // await updateWordDoc(docPath, newDataFor2025, '大乐透2025年新增数据');

  console.log(
    `✨ 大乐透数据同步完成！新增 ${newDataForAll.length} 条历史数据，${newDataFor2025.length} 条2025年数据`
  );
}

/**
 * 同步双色球数据
 */
async function syncShuangSeQiuData() {
  console.log("\n🎯 开始同步双色球数据...");

  const tempPath = "./dSsq/temp_all_history_data.json";
  const allHistoryPath = "./dSsq/all_history_data.json";
  const shuang2025Path = "./dSsq/shuang_2025_data.json";
  const docPath = "./dSsq/shuang_2025_data.docx";

  // 读取temp数据
  const tempData = readJsonFile(tempPath);
  if (tempData.length === 0) {
    console.log("❌ temp文件为空或读取失败");
    return;
  }

  // 同步到all_history_data.json
  const allHistoryData = readJsonFile(allHistoryPath);
  const newDataForAll = detectNewData(tempData, allHistoryData);
  if (newDataForAll.length > 0) {
    const updatedAllData = [...allHistoryData, ...newDataForAll];
    writeJsonFile(allHistoryPath, updatedAllData);
  } else {
    console.log("📋 all_history_data.json - 无新增数据");
  }

  // 同步到shuang_2025_data.json（只同步2025年的数据）
  const shuang2025Data = readJsonFile(shuang2025Path);
  const temp2025Data = tempData.filter((item) => item.期数.startsWith("2025"));
  const newDataFor2025 = detectNewData(temp2025Data, shuang2025Data);
  if (newDataFor2025.length > 0) {
    const updated2025Data = [...shuang2025Data, ...newDataFor2025];
    writeJsonFile(shuang2025Path, updated2025Data);
  } else {
    console.log("📋 shuang_2025_data.json - 无新增数据");
  }

  // 更新Word文档
  // await updateWordDoc(docPath, newDataFor2025, '双色球2025年新增数据');

  console.log(
    `✨ 双色球数据同步完成！新增 ${newDataForAll.length} 条历史数据，${newDataFor2025.length} 条2025年数据`
  );
}

/**
 * 主函数
 */
async function main() {
  console.log("🚀 开始执行高级数据同步任务...");
  console.log("=".repeat(50));

  try {
    // 同步大乐透数据
    await syncDaLeTouData();

    // 同步双色球数据
    await syncShuangSeQiuData();

    console.log("\n" + "=".repeat(50));
    console.log("🎉 所有数据同步任务完成！");
  } catch (error) {
    console.error("❌ 数据同步过程中发生错误:", error);
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main();
}

module.exports = {
  main,
  syncDaLeTouData,
  syncShuangSeQiuData,
};
