const StatisticalPredictor = require("./statisticalPredictor.js");
const fs = require("fs");
const path = require("path");

async function main() {
  try {
    // 读取历史数据
    const dataPath = path.join(__dirname, "../../data/all_history_data.json");
    const historyData = JSON.parse(fs.readFileSync(dataPath, "utf8"));

    // 创建预测器实例
    const predictor = new StatisticalPredictor();

    // 进行预测
    const prediction = await predictor.predict(historyData);

    // 保存预测结果
    await fs.writeFile(
      "../../predictions.json",
      JSON.stringify(prediction, null, 2)
    );

    console.log("预测完成，结果已保存到 predictions.json");
  } catch (error) {
    console.error("预测过程出错:", error);
  }
}

main();
