const tf = require("@tensorflow/tfjs");
const fs = require("fs");

class LotteryPredictor {
  constructor() {
    // 模型参数
    this.SEQUENCE_LENGTH = 30; // 从50减少到30，减少输入序列长度
    this.RED_NUMBERS = 35;
    this.BLUE_NUMBERS = 12;
    this.EPOCHS = 20; // 从50减少到20
    this.BATCH_SIZE = 128; // 从64增加到128，加快训练速度

    // 特征工程参数
    this.features = {
      frequency: new Map(), // 号码出现频率
      interval: new Map(), // 号码间隔
      hotCold: new Map(), // 冷热号码
      lastAppeared: new Map(), // 上次出现位置
    };
  }

  // 数据预处理
  async preprocessData(rawData) {
    console.log("开始数据预处理...");
    console.log("原始数据量:", rawData?.length || 0);

    try {
      // 1. 数据清洗和验证
      const cleanData = this.cleanAndValidateData(rawData);
      console.log("清洗后数据量:", cleanData.length);

      // 2. 特征工程
      const enhancedData = this.engineerFeatures(cleanData, cleanData);
      console.log("特征工程后数据量:", enhancedData.length);

      // 3. 数据归一化
      const normalizedData = this.normalizeData(enhancedData);
      console.log("归一化后数据量:", normalizedData.length);

      // 4. 创建序列数据
      const sequences = this.createSequences(normalizedData);
      console.log("创建序列数据完成，序列数量:", sequences.length);

      return sequences;
    } catch (error) {
      console.error("数据预处理出错:", error);
      throw error;
    }
  }

  // 创建深度学习模型
  createModel() {
    console.log("创建模型...");
    const model = tf.sequential();

    // 1. LSTM层，减少units数量
    model.add(
      tf.layers.lstm({
        units: 64, // 从128减少到64
        returnSequences: false,
        inputShape: [this.SEQUENCE_LENGTH, this.getFeatureDimension()],
      })
    );

    // 2. Dense层
    model.add(
      tf.layers.dense({
        units: 32, // 从64减少到32
        activation: "relu",
      })
    );

    // 3. 输出层
    model.add(
      tf.layers.dense({
        units: this.RED_NUMBERS + this.BLUE_NUMBERS,
        activation: "sigmoid",
      })
    );

    // 使用更快的优化器
    model.compile({
      optimizer: tf.train.rmsprop(0.002), // 使用RMSprop和更大的学习率
      loss: "binaryCrossentropy",
      metrics: ["accuracy"],
    });

    console.log("模型创建完成");
    return model;
  }

  // 训练模型
  async trainModel(model, sequences) {
    console.log("开始训练模型...");

    try {
      console.log("1. 准备训练数据...");
      const { trainX, trainY, valX, valY } =
        this.splitTrainValidation(sequences);

      console.log("2. 转换数据为张量...");
      console.time("张量转换");
      const trainXTensor = tf.tensor3d(trainX);
      const trainYTensor = tf.tensor2d(trainY);
      const valXTensor = tf.tensor3d(valX);
      const valYTensor = tf.tensor2d(valY);
      console.timeEnd("张量转换");

      console.log("训练数据形状:", trainXTensor.shape);
      console.log("训练标签形状:", trainYTensor.shape);
      console.log("验证数据形状:", valXTensor.shape);
      console.log("验证标签形状:", valYTensor.shape);

      // 修改回调对象，添加更多进度信息
      const callbacks = {
        onTrainBegin: async () => {
          console.log("训练开始...");
          this.trainingStartTime = Date.now();
        },
        onEpochBegin: async (epoch) => {
          console.log(`开始第 ${epoch + 1} 轮训练...`);
          this.epochStartTime = Date.now();
        },
        onBatchEnd: async (batch, logs) => {
          if (batch % 10 === 0) {
            // 每10个批次输出一次进度
            const elapsed = ((Date.now() - this.epochStartTime) / 1000).toFixed(
              1
            );
            console.log(
              `  批次 ${batch}, 损失: ${logs.loss.toFixed(4)}, ` +
                `准确率: ${logs.acc.toFixed(4)}, ` +
                `用时: ${elapsed}s`
            );
          }
        },
        onEpochEnd: async (epoch, logs) => {
          const elapsed = (
            (Date.now() - this.trainingStartTime) /
            1000
          ).toFixed(1);
          console.log(
            `完成第 ${epoch + 1}/${this.EPOCHS} 轮, ` +
              `损失: ${logs.loss.toFixed(4)}, ` +
              `准确率: ${logs.acc.toFixed(4)}, ` +
              `验证损失: ${logs.val_loss.toFixed(4)}, ` +
              `验证准确率: ${logs.val_acc.toFixed(4)}, ` +
              `总用时: ${elapsed}s`
          );
        },
        onTrainEnd: async () => {
          const totalTime = (
            (Date.now() - this.trainingStartTime) /
            1000
          ).toFixed(1);
          console.log(`训练结束，总用时: ${totalTime}s`);
        },
      };

      // 训练模型
      await model.fit(trainXTensor, trainYTensor, {
        epochs: this.EPOCHS,
        batchSize: this.BATCH_SIZE,
        validationData: [valXTensor, valYTensor],
        callbacks: [callbacks],
        verbose: 0,
        shuffle: true,
      });

      console.log("4. 释放张量内存...");
      trainXTensor.dispose();
      trainYTensor.dispose();
      valXTensor.dispose();
      valYTensor.dispose();

      console.log("模型训练完成");
    } catch (error) {
      console.error("训练模型时出错:", error);
      throw error;
    }
  }

  // 预测下一期号码
  async predict(model, latestData, numGroups = 5) {
    console.log("开始预测...");
    console.log(`将生成 ${numGroups} 组预测数据...`);

    const predictions = [];
    const usedCombinations = new Set(); // 用于记录已生成的组合

    for (let i = 0; i < numGroups; i++) {
      console.log(`\n生成第 ${i + 1} 组预测...`);

      let attempt = 0;
      let prediction;

      // 尝试生成不重复的预测结果
      do {
        // 1. 集成学习 - 多次预测取平均
        const basePrediction = await this.ensemblePrediction(
          model,
          latestData,
          10
        );

        // 2. 应用统计学规则
        const refinedPredictions = this.applyStatisticalRules(basePrediction);

        // 3. 生成预测结果
        prediction = this.generateFinalPrediction(refinedPredictions);

        // 创建组合键
        const combinationKey = `${prediction.红球}-${prediction.蓝球}`;

        // 检查是否是新的组合
        if (!usedCombinations.has(combinationKey)) {
          usedCombinations.add(combinationKey);
          prediction.组号 = i + 1;
          predictions.push(prediction);
          break;
        }

        attempt++;
      } while (attempt < 10); // 最多尝试10次

      if (attempt >= 10) {
        console.log(`警告：第 ${i + 1} 组预测未能生成不同组合`);
        break;
      }
    }

    // 4. 添加统计信息
    const summary = this.generatePredictionSummary(predictions);

    console.log("\n预测完成");
    return {
      预测时间: new Date().toLocaleString(),
      预测组数: predictions.length,
      预测结果: predictions,
      统计信息: summary,
    };
  }

  // 辅助方法
  cleanAndValidateData(rawData) {
    // 实现数据清洗和验证逻辑
    return rawData.filter((item) => {
      return this.validateDataItem(item);
    });
  }

  engineerFeatures(cleanData, historicalData) {
    // 实现特征工程逻辑，现在传入historicalData
    return cleanData.map((item) => {
      return {
        ...item,
        frequency: this.calculateFrequency(item),
        interval: this.calculateInterval(item, historicalData),
        hotCold: this.calculateHotCold(item, historicalData),
      };
    });
  }

  normalizeData(data) {
    // 实现数据归一化逻辑
    return data.map((item) => {
      return {
        ...item,
        normalizedFeatures: this.normalize(item),
      };
    });
  }

  // 验证单条数据
  validateDataItem(item) {
    try {
      console.log("验证数据项:", item);

      // 验证期数格式
      if (!/^\d{7}$/.test(item.期数)) {
        console.log("期数格式错误:", item.期数);
        return false;
      }

      // 验证红球数据
      const redBalls = item.红球.split(" ").map(Number);
      if (redBalls.length !== 5) {
        console.log("红球数量错误:", redBalls.length);
        return false;
      }
      if (!redBalls.every((n) => n >= 1 && n <= 35)) {
        console.log("红球范围错误:", redBalls);
        return false;
      }
      if (new Set(redBalls).size !== redBalls.length) {
        console.log("红球重复:", redBalls);
        return false;
      }

      // 验证蓝球数据
      const blueBalls = item.蓝球.split(" ").map(Number);
      if (blueBalls.length !== 2) {
        console.log("蓝球数量错误:", blueBalls.length);
        return false;
      }
      if (!blueBalls.every((n) => n >= 1 && n <= 12)) {
        console.log("蓝球范围错误:", blueBalls);
        return false;
      }

      return true;
    } catch (error) {
      console.error("数据验证错误:", error);
      console.error("错误数据项:", item);
      return false;
    }
  }

  // 计算号码频率
  calculateFrequency(data, windowSize = 30) {
    const frequency = new Map();

    // 初始化频率表
    for (let i = 1; i <= this.RED_NUMBERS; i++) {
      frequency.set(`red_${i}`, 0);
    }
    for (let i = 1; i <= this.BLUE_NUMBERS; i++) {
      frequency.set(`blue_${i}`, 0);
    }

    // 统计最近windowSize期的出现次数
    const redBalls = data.红球.split(" ").map(Number);
    const blueBalls = data.蓝球.split(" ").map(Number);

    redBalls.forEach((num) => {
      frequency.set(`red_${num}`, frequency.get(`red_${num}`) + 1);
    });

    blueBalls.forEach((num) => {
      frequency.set(`blue_${num}`, frequency.get(`blue_${num}`) + 1);
    });

    return frequency;
  }

  // 计算号码间隔
  calculateInterval(currentData, historicalData) {
    const intervals = new Map();

    if (!historicalData?.length) return intervals;

    // 预处理历史数据
    const historyMap = new Map();
    historicalData.forEach((data, index) => {
      const redBalls = new Set(data.红球.split(" ").map(Number));
      const blueBalls = new Set(data.蓝球.split(" ").map(Number));
      historyMap.set(index, { redBalls, blueBalls });
    });

    // 计算红球间隔
    const currentRedBalls = currentData.红球.split(" ").map(Number);
    currentRedBalls.forEach((num) => {
      let interval = 0;
      for (let i = historicalData.length - 1; i >= 0; i--) {
        if (historyMap.get(i).redBalls.has(num)) break;
        interval++;
      }
      intervals.set(`red_${num}`, interval);
    });

    // 计算蓝球间隔
    const currentBlueBalls = currentData.蓝球.split(" ").map(Number);
    currentBlueBalls.forEach((num) => {
      let interval = 0;
      for (let i = historicalData.length - 1; i >= 0; i--) {
        if (historyMap.get(i).blueBalls.has(num)) break;
        interval++;
      }
      intervals.set(`blue_${num}`, interval);
    });

    return intervals;
  }

  // 计算冷热号码
  calculateHotCold(data, historicalData, threshold = 10) {
    const hotCold = new Map();
    const frequency = this.calculateFrequency(data);

    // 判断红球冷热
    for (let i = 1; i <= this.RED_NUMBERS; i++) {
      const freq = frequency.get(`red_${i}`) || 0;
      hotCold.set(`red_${i}`, freq >= threshold ? "hot" : "cold");
    }

    // 判断蓝球冷热
    for (let i = 1; i <= this.BLUE_NUMBERS; i++) {
      const freq = frequency.get(`blue_${i}`) || 0;
      hotCold.set(`blue_${i}`, freq >= threshold ? "hot" : "cold");
    }

    return hotCold;
  }

  // 数据归一化
  normalize(item) {
    const normalized = {
      期数: item.期数,
      红球: item.红球,
      蓝球: item.蓝球,
      frequency: item.frequency,
      interval: item.interval,
      hotCold: item.hotCold,
    };

    return normalized;
  }

  // 修改 ensemblePrediction 方法，增加随机性
  async ensemblePrediction(model, latestData, numPredictions = 10) {
    try {
      const inputTensor = this.preprocessLatestData(latestData);

      const predictions = [];
      for (let i = 0; i < numPredictions; i++) {
        const prediction = await model.predict(inputTensor);
        const values = await prediction.data();

        // 增加随机性
        const valuesWithNoise = Array.from(values).map((v) => {
          const noise = (Math.random() - 0.5) * 0.3; // 增加随机波动范围
          return Math.max(0, Math.min(1, v + noise));
        });

        predictions.push(valuesWithNoise);
        prediction.dispose();
      }

      inputTensor.dispose();

      // 计算加权平均预测值
      const avgPrediction = new Array(
        this.RED_NUMBERS + this.BLUE_NUMBERS
      ).fill(0);

      for (let i = 0; i < predictions.length; i++) {
        const weight = Math.random() * 1.5 + 0.5; // 增加权重范围
        for (let j = 0; j < avgPrediction.length; j++) {
          avgPrediction[j] += predictions[i][j] * weight;
        }
      }

      // 归一化
      const totalWeight = predictions.length;
      for (let i = 0; i < avgPrediction.length; i++) {
        avgPrediction[i] = Math.max(
          0,
          Math.min(1, avgPrediction[i] / totalWeight)
        );
      }

      return avgPrediction;
    } catch (error) {
      console.error("集成预测出错:", error);
      throw error;
    }
  }

  // 修改 generateFinalPrediction 方法，增加随机选择
  generateFinalPrediction(predictions) {
    console.log("生成最终预测...");

    try {
      // 分离红球和蓝球预测
      const redPredictions = predictions.slice(0, this.RED_NUMBERS);
      const bluePredictions = predictions.slice(this.RED_NUMBERS);

      // 使用轮盘赌选择法选择号码
      const selectedReds = this.rouletteWheelSelection(redPredictions, 5);
      const selectedBlues = this.rouletteWheelSelection(bluePredictions, 2);

      return {
        红球: selectedReds
          .sort((a, b) => a - b)
          .map((n) => (n + 1).toString().padStart(2, "0"))
          .join(" "),
        蓝球: selectedBlues
          .sort((a, b) => a - b)
          .map((n) => (n + 1).toString().padStart(2, "0"))
          .join(" "),
        概率: {
          红球: selectedReds.map((i) => ({
            号码: (i + 1).toString().padStart(2, "0"),
            概率: redPredictions[i].toFixed(4),
          })),
          蓝球: selectedBlues.map((i) => ({
            号码: (i + 1).toString().padStart(2, "0"),
            概率: bluePredictions[i].toFixed(4),
          })),
        },
      };
    } catch (error) {
      console.error("生成最终预测时出错:", error);
      throw error;
    }
  }

  // 添加轮盘赌选择法
  rouletteWheelSelection(probabilities, count) {
    const selected = new Set();
    const totalProb = probabilities.reduce((sum, prob) => sum + prob, 0);

    while (selected.size < count) {
      let r = Math.random() * totalProb;
      let sum = 0;

      for (let i = 0; i < probabilities.length; i++) {
        sum += probabilities[i];
        if (r <= sum && !selected.has(i)) {
          selected.add(i);
          break;
        }
      }
    }

    return Array.from(selected);
  }

  // 修改 applyStatisticalRules 方法，增加随机性
  applyStatisticalRules(predictions) {
    console.log("应用统计规则...");

    // 创建预测副本
    const refinedPredictions = [...predictions];

    // 随机决定是否应用每个规则
    if (Math.random() < 0.8) this.applyOddEvenRule(refinedPredictions);
    if (Math.random() < 0.8) this.applyBigSmallRule(refinedPredictions);
    if (Math.random() < 0.8) this.applyConsecutiveRule(refinedPredictions);

    // 添加随机扰动
    for (let i = 0; i < refinedPredictions.length; i++) {
      const noise = (Math.random() - 0.5) * 0.1; // ±5%的随机波动
      refinedPredictions[i] = Math.max(
        0,
        Math.min(1, refinedPredictions[i] + noise)
      );
    }

    return refinedPredictions;
  }

  // 训练验证集分割
  splitTrainValidation(sequences, validationSplit = 0.2) {
    if (!sequences || sequences.length === 0) {
      throw new Error("没有可用的训练序列");
    }

    console.log("序列数量:", sequences.length);
    console.log("序列示例:", sequences[0]);

    const splitIndex = Math.floor(sequences.length * (1 - validationSplit));

    // 确保数据格式正确
    const trainX = sequences.slice(0, splitIndex).map((s) => s.input);
    const trainY = sequences.slice(0, splitIndex).map((s) => s.output);
    const valX = sequences.slice(splitIndex).map((s) => s.input);
    const valY = sequences.slice(splitIndex).map((s) => s.output);

    // 打印数据形状
    console.log("训练数据X大小:", trainX.length, trainX[0]?.length);
    console.log("训练数据Y大小:", trainY.length, trainY[0]?.length);

    return { trainX, trainY, valX, valY };
  }

  // 创建序列数据
  createSequences(normalizedData) {
    console.log("创建序列数据...");
    console.time("序列创建");

    const sequences = [];
    const dataLength = normalizedData.length;

    if (dataLength < this.SEQUENCE_LENGTH) {
      console.warn(`数据量不足: ${dataLength} < ${this.SEQUENCE_LENGTH}`);
      return sequences;
    }

    // 预先计算所有特征
    console.log("预计算特征...");
    const allFeatures = normalizedData.map((data) =>
      this.extractFeatures(data)
    );

    console.log("创建序列...");
    const totalSequences = dataLength - this.SEQUENCE_LENGTH;
    let processedCount = 0;
    const reportInterval = Math.max(1, Math.floor(totalSequences / 10));

    for (let i = 0; i <= totalSequences - 1; i++) {
      try {
        const sequence = {
          input: allFeatures.slice(i, i + this.SEQUENCE_LENGTH),
          output: this.createTargetVector(
            normalizedData[i + this.SEQUENCE_LENGTH]
          ),
        };

        if (sequence.input.length === this.SEQUENCE_LENGTH) {
          sequences.push(sequence);
        }

        // 报告进度
        processedCount++;
        if (processedCount % reportInterval === 0) {
          const progress = ((processedCount / totalSequences) * 100).toFixed(1);
          console.log(`处理进度: ${progress}%`);
        }
      } catch (error) {
        console.error(`处理序列 ${i} 时出错:`, error);
      }
    }

    console.timeEnd("序列创建");
    console.log(`创建了 ${sequences.length} 个序列`);
    return sequences;
  }

  // 提取特征
  extractFeatures(data) {
    const features = [];

    // 添加红球特征
    const redBalls = data.红球.split(" ").map(Number);
    redBalls.forEach((num) => {
      // 归一化的号码值
      features.push(num / this.RED_NUMBERS);
      // 频率特征
      features.push(data.frequency.get(`red_${num}`) / 30);
      // 间隔特征
      features.push(data.interval.get(`red_${num}`) / 50);
    });

    // 添加蓝球特征
    const blueBalls = data.蓝球.split(" ").map(Number);
    blueBalls.forEach((num) => {
      // 归一化的号码值
      features.push(num / this.BLUE_NUMBERS);
      // 频率特征
      features.push(data.frequency.get(`blue_${num}`) / 30);
      // 间隔特征
      features.push(data.interval.get(`blue_${num}`) / 50);
    });

    return features;
  }

  // 创建目标向量
  createTargetVector(data) {
    const target = new Array(this.RED_NUMBERS + this.BLUE_NUMBERS).fill(0);

    try {
      // 设置红球位置为1
      const redBalls = data.红球.split(" ").map(Number);
      redBalls.forEach((num) => {
        if (num >= 1 && num <= this.RED_NUMBERS) {
          target[num - 1] = 1;
        }
      });

      // 设置蓝球位置为1
      const blueBalls = data.蓝球.split(" ").map(Number);
      blueBalls.forEach((num) => {
        if (num >= 1 && num <= this.BLUE_NUMBERS) {
          target[this.RED_NUMBERS + num - 1] = 1;
        }
      });
    } catch (error) {
      console.error("创建目标向量时出错:", error);
      console.error("数据:", data);
    }

    return target;
  }

  // 获取特征维度
  getFeatureDimension() {
    // 每个红球3个特征（号码值、频率、间隔）* 5个红球
    // 每个蓝球3个特征（号码值、频率、间隔）* 2个蓝球
    return 5 * 3 + 2 * 3;
  }

  // 预处理最新数据用于预测
  preprocessLatestData(latestData) {
    // 确保数据格式正确
    if (
      !Array.isArray(latestData) ||
      latestData.length < this.SEQUENCE_LENGTH
    ) {
      throw new Error(`需要至少 ${this.SEQUENCE_LENGTH} 期数据进行预测`);
    }

    // 对最新数据进行特征工程
    const enhancedData = this.engineerFeatures(latestData, latestData);

    // 归一化数据
    const normalizedData = this.normalizeData(enhancedData);

    // 创建预测用的输入序列
    const inputSequence = [];
    for (
      let i = normalizedData.length - this.SEQUENCE_LENGTH;
      i < normalizedData.length;
      i++
    ) {
      const features = this.extractFeatures(normalizedData[i]);
      inputSequence.push(features);
    }

    // 转换为张量
    return tf.tensor3d([inputSequence]);
  }

  // 确保号码不重复
  ensureNoRepetition(predictions) {
    const redPredictions = predictions.slice(0, this.RED_NUMBERS);
    const bluePredictions = predictions.slice(this.RED_NUMBERS);

    // 对红球预测进行排序和去重
    const sortedRedIndices = this.getTopIndices(
      redPredictions,
      this.RED_NUMBERS
    );
    const uniqueRedIndices = Array.from(new Set(sortedRedIndices));

    // 对蓝球预测进行排序和去重
    const sortedBlueIndices = this.getTopIndices(
      bluePredictions,
      this.BLUE_NUMBERS
    );
    const uniqueBlueIndices = Array.from(new Set(sortedBlueIndices));

    return [...uniqueRedIndices, ...uniqueBlueIndices];
  }

  // 应用奇偶比例规则
  applyOddEvenRule(predictions) {
    const redPredictions = predictions.slice(0, this.RED_NUMBERS);

    // 计算奇偶比例
    const oddCount = redPredictions.filter(
      (_, idx) => (idx + 1) % 2 === 1
    ).length;
    const evenCount = redPredictions.filter(
      (_, idx) => (idx + 1) % 2 === 0
    ).length;

    // 调整概率值使奇偶比例更合理
    if (Math.abs(oddCount - evenCount) > 2) {
      // 如果奇偶差距过大，适当调整概率值
      const adjustFactor = 0.1;
      for (let i = 0; i < redPredictions.length; i++) {
        if ((i + 1) % 2 === (oddCount > evenCount ? 1 : 0)) {
          redPredictions[i] *= 1 - adjustFactor;
        } else {
          redPredictions[i] *= 1 + adjustFactor;
        }
      }
    }
  }

  // 应用大小比例规则
  applyBigSmallRule(predictions) {
    const redPredictions = predictions.slice(0, this.RED_NUMBERS);
    const midPoint = Math.floor(this.RED_NUMBERS / 2);

    // 计算大小号码比例
    const smallCount = redPredictions.slice(0, midPoint).length;
    const bigCount = redPredictions.slice(midPoint).length;

    // 调整概率值使大小比例更合理
    if (Math.abs(smallCount - bigCount) > 2) {
      const adjustFactor = 0.1;
      for (let i = 0; i < redPredictions.length; i++) {
        if (i < midPoint === smallCount > bigCount) {
          redPredictions[i] *= 1 - adjustFactor;
        } else {
          redPredictions[i] *= 1 + adjustFactor;
        }
      }
    }
  }

  // 应用连号规则
  applyConsecutiveRule(predictions) {
    const redPredictions = predictions.slice(0, this.RED_NUMBERS);

    // 检测连号
    for (let i = 1; i < redPredictions.length; i++) {
      if (Math.abs(redPredictions[i] - redPredictions[i - 1]) === 1) {
        // 如果检测到连号，降低其概率
        redPredictions[i] *= 0.9;
        redPredictions[i - 1] *= 0.9;
      }
    }
  }

  // 获取前N个最大值的索引
  getTopIndices(array, count) {
    return array
      .map((value, index) => ({ value, index }))
      .sort((a, b) => b.value - a.value)
      .slice(0, count)
      .map((item) => item.index);
  }

  // 添加预测结果统计方法
  generatePredictionSummary(predictions) {
    // 统计号码出现频率
    const redFrequency = new Map();
    const blueFrequency = new Map();

    predictions.forEach((pred) => {
      // 统计红球
      pred.红球.split(" ").forEach((num) => {
        const count = redFrequency.get(num) || 0;
        redFrequency.set(num, count + 1);
      });

      // 统计蓝球
      pred.蓝球.split(" ").forEach((num) => {
        const count = blueFrequency.get(num) || 0;
        blueFrequency.set(num, count + 1);
      });
    });

    // 转换为数组并排序
    const redStats = Array.from(redFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([num, count]) => ({
        号码: num,
        出现次数: count,
        出现概率: (count / predictions.length).toFixed(2),
      }));

    const blueStats = Array.from(blueFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([num, count]) => ({
        号码: num,
        出现次数: count,
        出现概率: (count / predictions.length).toFixed(2),
      }));

    return {
      红球统计: redStats,
      蓝球统计: blueStats,
      热门号码: {
        红球: redStats
          .slice(0, 5)
          .map((s) => s.号码)
          .join(" "),
        蓝球: blueStats
          .slice(0, 2)
          .map((s) => s.号码)
          .join(" "),
      },
    };
  }
}

// 导出类
module.exports = LotteryPredictor;
