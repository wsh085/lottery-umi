const StatisticalPredictor = require("./statisticalPredictor.js");
const fs = require("fs").promises;
const path = require("path");

async function main() {
  const predictor = new StatisticalPredictor();

  try {
    // 读取历史数据
    const dataPath = path.resolve(
      __dirname,
      "../../dSsq/all_history_data.json"
    );
    const exists = await fs
      .access(dataPath)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      throw new Error(`文件不存在: ${dataPath}`);
    }

    const historyData = JSON.parse(await fs.readFile(dataPath, "utf8"));

    // 进行预测
    const prediction = await predictor.predict(historyData);

    // 格式化预测结果
    const formattedPrediction = {
      red: `红球：${[
        prediction.red1,
        prediction.red2,
        prediction.red3,
        prediction.red4,
        prediction.red5,
        prediction.red6,
      ].join("，")}`,
      blue: `蓝球：${prediction.blue}`,
    };

    // 保存预测结果
    await fs.writeFile(
      path.resolve(__dirname, "./predictions.json"),
      JSON.stringify(formattedPrediction, null, 2)
    );

    console.log("预测完成，结果已保存到 predictions.json");
    console.log(formattedPrediction.red);
    console.log(formattedPrediction.blue);
  } catch (error) {
    console.error("预测过程出错:", error);
    console.error("错误详情:", {
      message: error.message,
      stack: error.stack,
      path: error.path,
    });
  } finally {
    // 清理资源
    predictor.dispose();
  }
}

main();
