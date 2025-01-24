const LotteryPredictor = require("./lotteryPredictor.js");
const fs = require("fs").promises;
const path = require("path");

async function main() {
  try {
    // 1. 加载历史数据
    const dataPath = path.resolve(
      __dirname,
      "../../data/all_history_data.json"
    );
    console.log("正在读取数据文件:", dataPath);

    let rawData;
    try {
      const fileContent = await fs.readFile(dataPath, "utf8");
      console.log("文件内容长度:", fileContent.length);
      rawData = JSON.parse(fileContent);
      console.log("解析后数据条数:", rawData.length);

      // 打印几条样本数据
      console.log("数据样本:");
      console.log(rawData.slice(0, 2));
    } catch (error) {
      console.error("读取或解析数据文件失败:", error);
      if (error.code === "ENOENT") {
        console.error("数据文件不存在，请确保文件路径正确");
      }
      return;
    }

    // 验证数据格式
    if (!Array.isArray(rawData)) {
      console.error("数据格式错误：期望数组，实际获得", typeof rawData);
      return;
    }

    if (rawData.length === 0) {
      console.error("数据为空");
      return;
    }

    // 检查数据格式
    const isValidFormat = rawData.every(
      (item) =>
        item.期数 &&
        item.红球 &&
        item.蓝球 &&
        typeof item.期数 === "string" &&
        typeof item.红球 === "string" &&
        typeof item.蓝球 === "string"
    );

    if (!isValidFormat) {
      console.error("数据格式不正确，请检查数据结构");
      console.log("第一条数据:", rawData[0]);
      return;
    }

    // 2. 初始化预测器
    console.log("初始化预测器...");
    const predictor = new LotteryPredictor();

    // 3. 数据预处理
    console.log("开始数据预处理...");
    const sequences = await predictor.preprocessData(rawData);

    // 4. 创建模型
    console.log("创建模型...");
    const model = predictor.createModel();

    // 5. 训练模型
    console.log("开始训练模型...");
    await predictor.trainModel(model, sequences);

    // 6. 预测下一期号码
    console.log("开始预测...");
    const latestData = rawData.slice(-50); // 获取最近50期数据
    const prediction = await predictor.predict(model, latestData);

    // 7. 输出预测结果
    console.log("预测结果:", prediction);

    // 8. 保存预测结果
    const predictionsPath = path.resolve(__dirname, "../../predictions.json");
    await fs.writeFile(predictionsPath, JSON.stringify(prediction, null, 2));
    console.log("预测结果已保存到:", predictionsPath);
  } catch (error) {
    console.error("预测过程出错:", error);
    console.error("错误堆栈:", error.stack);
  }
}

main();
