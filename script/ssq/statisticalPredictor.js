const tf = require("@tensorflow/tfjs");
const fs = require("fs");
const path = require("path");

class StatisticalPredictor {
  constructor() {
    this.model = null;
  }

  async createModel() {
    try {
      // 创建一个简单的神经网络模型
      const model = tf.sequential();

      // 添加输入层和隐藏层
      model.add(
        tf.layers.dense({
          inputShape: [9], // 9个输入特征
          units: 64,
          activation: "relu",
        })
      );

      // 添加隐藏层
      model.add(
        tf.layers.dense({
          units: 32,
          activation: "relu",
        })
      );

      // 添加输出层
      model.add(
        tf.layers.dense({
          units: 7, // 7个输出（6个红球+1个蓝球）
          activation: "sigmoid", // 使用sigmoid确保输出在0-1之间
        })
      );

      // 编译模型
      model.compile({
        optimizer: "adam",
        loss: "meanSquaredError",
      });

      this.model = model;
      return true;
    } catch (error) {
      console.error("创建模型失败:", error);
      return false;
    }
  }

  async saveModel() {
    try {
      if (!this.model) {
        throw new Error("没有可保存的模型");
      }

      // 创建模型目录
      const modelDir = path.resolve(__dirname, "./model/ssq_model");
      if (!fs.existsSync(modelDir)) {
        fs.mkdirSync(modelDir, { recursive: true });
      }

      // 获取模型的配置
      const modelConfig = this.model.toJSON();

      // 保存模型配置
      fs.writeFileSync(
        path.join(modelDir, "model.json"),
        JSON.stringify(modelConfig)
      );

      // 获取模型的权重
      const weights = this.model.getWeights();
      const weightData = weights.map((w) => w.arraySync());

      // 保存权重数据
      fs.writeFileSync(
        path.join(modelDir, "weights.json"),
        JSON.stringify(weightData)
      );

      return true;
    } catch (error) {
      console.error("保存模型失败:", error);
      return false;
    }
  }

  async loadModel() {
    try {
      const modelDir = path.resolve(__dirname, "./model/ssq_model");

      // 如果模型目录不存在，创建新模型
      if (!fs.existsSync(modelDir)) {
        console.log("模型不存在，创建新模型...");
        const success = await this.createModel();
        if (!success) {
          throw new Error("创建模型失败");
        }
        await this.saveModel();
        return true;
      }

      try {
        // 创建新模型实例
        this.model = tf.sequential();

        // 添加输入层和隐藏层
        this.model.add(
          tf.layers.dense({
            inputShape: [9],
            units: 64,
            activation: "relu",
          })
        );

        // 添加隐藏层
        this.model.add(
          tf.layers.dense({
            units: 32,
            activation: "relu",
          })
        );

        // 添加输出层
        this.model.add(
          tf.layers.dense({
            units: 7,
            activation: "sigmoid",
          })
        );

        // 读取权重数据
        const weightsPath = path.join(modelDir, "weights.json");
        const weightData = JSON.parse(fs.readFileSync(weightsPath, "utf8"));

        // 加载权重
        const weights = weightData.map((w) => tf.tensor(w));
        this.model.setWeights(weights);

        // 编译模型
        this.model.compile({
          optimizer: "adam",
          loss: "meanSquaredError",
        });

        return true;
      } catch (loadError) {
        console.error("加载已有模型失败，创建新模型:", loadError);
        const success = await this.createModel();
        if (!success) {
          throw new Error("创建模型失败");
        }
        await this.saveModel();
        return true;
      }
    } catch (error) {
      console.error("模型初始化失败:", error);
      return false;
    }
  }

  async predict(historyData) {
    let inputTensor = null;
    let prediction = null;

    try {
      // 加载模型
      if (!this.model) {
        const success = await this.loadModel();
        if (!success) {
          throw new Error("模型加载失败");
        }
      }

      // 数据预处理：只保留最近30期数据
      const recentData = historyData.slice(-30);

      // 提取红球号码和蓝球号码
      const processedData = recentData.map((item) => {
        // 确保只提取需要的9个特征，并进行归一化处理
        return [
          parseInt(item.red1) / 33, // 红球最大值33
          parseInt(item.red2) / 33,
          parseInt(item.red3) / 33,
          parseInt(item.red4) / 33,
          parseInt(item.red5) / 33,
          parseInt(item.red6) / 33,
          parseInt(item.blue) / 16, // 蓝球最大值16
          parseInt(item.period) / 10000, // 归一化期号
          item.date ? new Date(item.date).getTime() / 1e12 : 0, // 归一化日期
        ];
      });

      // 转换为tensor
      inputTensor = tf.tensor2d(processedData);

      // 进行预测
      prediction = this.model.predict(inputTensor);

      // 将预测结果转换为数组
      const predictionData = await prediction.array();

      // 确保我们有预测结果
      if (!predictionData || !predictionData[0]) {
        throw new Error("预测结果无效");
      }

      // 处理预测结果，反归一化并转为整数
      const result = predictionData[predictionData.length - 1].map(
        (num, index) => {
          // 确保数值在有效范围内，处理 null 或 undefined 的情况
          const value = Math.max(0.001, Math.min(0.999, num || 0.5));

          if (index === 6) {
            // 蓝球 (1-16)
            const blueNum = Math.round(value * 16);
            return Math.max(1, Math.min(16, blueNum));
          }
          // 红球 (1-33)
          const redNum = Math.round(value * 33);
          return Math.max(1, Math.min(33, redNum));
        }
      );

      // 处理红球
      const redBalls = result.slice(0, 6);
      let finalRedBalls = new Set(redBalls);

      // 如果有重复的红球，使用确定性策略替换
      while (finalRedBalls.size < 6) {
        const existingNums = Array.from(finalRedBalls);
        const usedZones = new Set(
          existingNums.map((num) => Math.floor((num - 1) / 6))
        ); // 将1-33分成6个区域

        // 在未使用的区域中选择中间值
        for (let zone = 0; zone < 6 && finalRedBalls.size < 6; zone++) {
          if (!usedZones.has(zone)) {
            const zoneStart = zone * 6 + 1;
            const zoneEnd = Math.min(33, (zone + 1) * 6);
            const availableNums = [];

            // 收集该区域内未使用的数字
            for (let i = zoneStart; i <= zoneEnd; i++) {
              if (!finalRedBalls.has(i)) {
                availableNums.push(i);
              }
            }

            if (availableNums.length > 0) {
              // 选择区域内的中间值
              const middleIndex = Math.floor(availableNums.length / 2);
              finalRedBalls.add(availableNums[middleIndex]);
            }
          }
        }

        // 如果还不够6个，选择与现有数字距离最远的数字
        if (finalRedBalls.size < 6) {
          const remainingNums = new Map(); // 数字到其最小距离的映射

          for (let i = 1; i <= 33; i++) {
            if (!finalRedBalls.has(i)) {
              // 计算与现有数字的最小距离
              const minDistance = Math.min(
                ...Array.from(finalRedBalls).map((num) => Math.abs(num - i))
              );
              remainingNums.set(i, minDistance);
            }
          }

          // 选择距离最远的数字
          if (remainingNums.size > 0) {
            let maxDistance = 0;
            let selectedNum = null;

            remainingNums.forEach((distance, num) => {
              if (distance > maxDistance) {
                maxDistance = distance;
                selectedNum = num;
              }
            });

            if (selectedNum !== null) {
              finalRedBalls.add(selectedNum);
            }
          }
        }
      }

      // 转换为数组并排序
      finalRedBalls = Array.from(finalRedBalls).sort((a, b) => a - b);

      // 确保蓝球在有效范围内，使用确定性计算
      const blueBall = Math.max(1, Math.min(16, Math.ceil(result[6] * 16)));

      // 返回预测结果
      return {
        red1: finalRedBalls[0],
        red2: finalRedBalls[1],
        red3: finalRedBalls[2],
        red4: finalRedBalls[3],
        red5: finalRedBalls[4],
        red6: finalRedBalls[5],
        blue: blueBall,
      };
    } catch (error) {
      console.error("预测过程中出错:", error);
      throw new Error(`预测失败: ${error.message}`);
    } finally {
      // 清理临时张量
      if (inputTensor) {
        inputTensor.dispose();
      }
      if (prediction) {
        prediction.dispose();
      }
    }
  }

  // 清理资源
  dispose() {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
    if (tf.memory().numTensors > 0) {
      tf.disposeVariables();
    }
  }
}

module.exports = StatisticalPredictor;
