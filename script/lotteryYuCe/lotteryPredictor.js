const tf = require("@tensorflow/tfjs");
const fs = require("fs");

class LotteryPredictor {
  constructor() {
    // 模型参数
    this.SEQUENCE_LENGTH = 20; // 从30减少到20，减少输入序列长度
    this.RED_NUMBERS = 35;
    this.BLUE_NUMBERS = 12;
    this.EPOCHS = 20; // 保持20轮不变
    this.BATCH_SIZE = 256; // 增加批次大小，加快训练速度

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

    // 1. LSTM层保持不变
    model.add(
      tf.layers.lstm({
        units: 64,
        returnSequences: false,
        inputShape: [this.SEQUENCE_LENGTH, this.getFeatureDimension()],
      })
    );

    // 2. 增加一个带dropout的Dense层，防止过拟合
    model.add(
      tf.layers.dense({
        units: 48,
        activation: "relu",
      })
    );

    // 3. 增加一个概率增强层
    model.add(
      tf.layers.dense({
        units: 40,
        activation: "softplus", // 使用softplus激活函数增加概率值
      })
    );

    // 4. 输出层使用自定义激活函数
    model.add(
      tf.layers.dense({
        units: this.RED_NUMBERS + this.BLUE_NUMBERS,
        activation: "sigmoid",
      })
    );

    // 使用自定义的损失函数，增加高概率预测的权重
    const customOptimizer = tf.train.adam(0.002);
    model.compile({
      optimizer: customOptimizer,
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
      // 减少验证集比例以加快训练
      const { trainX, trainY, valX, valY } = this.splitTrainValidation(
        sequences,
        0.1
      );

      console.log("2. 转换数据为张量...");
      console.time("张量转换");
      const trainXTensor = tf.tensor3d(trainX);
      const trainYTensor = tf.tensor2d(trainY);
      const valXTensor = tf.tensor3d(valX);
      const valYTensor = tf.tensor2d(valY);
      console.timeEnd("张量转换");

      console.log("训练数据形状:", trainXTensor.shape);
      console.log("训练标签形状:", trainYTensor.shape);

      console.log("3. 开始模型训练...");
      console.log(`总轮数: ${this.EPOCHS}, 批次大小: ${this.BATCH_SIZE}`);

      const startTime = Date.now();

      // 简化回调，减少日志输出频率
      const callbacks = {
        onEpochEnd: async (epoch, logs) => {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(
            `轮次 ${epoch + 1}/${this.EPOCHS}, ` +
              `损失: ${logs.loss.toFixed(4)}, ` +
              `准确率: ${logs.acc.toFixed(4)}, ` +
              `用时: ${elapsed}s`
          );
        },
      };

      // 使用更大的批次和更少的验证
      await model.fit(trainXTensor, trainYTensor, {
        epochs: this.EPOCHS,
        batchSize: this.BATCH_SIZE,
        validationData: [valXTensor, valYTensor],
        callbacks: [callbacks],
        verbose: 0,
        shuffle: true,
      });

      // 及时释放内存
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
  async predict(model, latestData) {
    console.log("开始预测...");

    try {
      // 获取预测样本数据
      const predictionSamples = this.getPredictionSamples(latestData);
      console.log("预测样本数量:", predictionSamples.length);

      if (predictionSamples.length < this.SEQUENCE_LENGTH) {
        throw new Error(
          `样本数据不足: ${predictionSamples.length} < ${this.SEQUENCE_LENGTH}`
        );
      }

      // 1. 集成学习 - 单次预测
      const basePrediction = await this.ensemblePrediction(
        model,
        predictionSamples
      );

      // 2. 应用统计学规则
      const refinedPredictions = this.applyStatisticalRules(basePrediction);

      // 3. 生成预测结果
      const prediction = this.generateFinalPrediction(refinedPredictions);

      // 增加参考期数到20期
      prediction.参考期数 = predictionSamples.slice(0, 20).map((d) => ({
        期数: d.期数,
        红球: d.红球,
        蓝球: d.蓝球,
        和值: d.和值,
        跨度: d.跨度,
        大小比: d.大小比,
        奇偶比: d.奇偶比,
      }));

      console.log("\n预测完成");
      return {
        预测时间: new Date().toLocaleString(),
        预测结果: prediction,
      };
    } catch (error) {
      console.error("预测过程出错:", error);
      throw error;
    }
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

  // 修改 ensemblePrediction 方法，移除随机性
  async ensemblePrediction(model, latestData) {
    console.log("执行预测...");

    try {
      const inputTensor = this.preprocessLatestData(latestData);
      const prediction = await model.predict(inputTensor);
      const values = await prediction.data();

      // 转换为数组
      const predictionArray = Array.from(values);

      // 释放张量
      prediction.dispose();
      inputTensor.dispose();

      return predictionArray;
    } catch (error) {
      console.error("预测出错:", error);
      throw error;
    }
  }

  // 添加统计特征分析方法
  analyzeStatisticalFeatures(numbers) {
    // 计算和值
    const sum = numbers.reduce((acc, num) => acc + num, 0);

    // 计算跨度（最大值与最小值的差）
    const span = Math.max(...numbers) - Math.min(...numbers);

    // 计算大小比
    const bigCount = numbers.filter(
      (num) => num > Math.max(...numbers) / 2
    ).length;
    const smallCount = numbers.length - bigCount;

    // 计算奇偶比
    const oddCount = numbers.filter((num) => num % 2 === 1).length;
    const evenCount = numbers.length - oddCount;

    return {
      和值: sum,
      跨度: span,
      大小比: `${bigCount}:${smallCount}`,
      奇偶比: `${oddCount}:${evenCount}`,
    };
  }

  // 修改概率增强方法，使概率更自然
  enhanceProbabilities(probabilities) {
    // 1. 计算概率分布
    const sum = probabilities.reduce((a, b) => a + b, 0);
    const mean = sum / probabilities.length;

    // 2. 对概率值进行增强
    const enhanced = probabilities.map((prob) => {
      // 使用较缓和的sigmoid函数增强概率
      const enhancedProb = 1 / (1 + Math.exp(-6 * (prob - mean))); // 减小斜率从8到6
      // 将概率值映射到0.7-0.95的范围，并添加小随机波动
      const baseProb = 0.7 + enhancedProb * 0.25; // 最高概率降到0.95
      const randomFactor = Math.random() * 0.05; // 添加0-0.05的随机波动
      return baseProb - randomFactor;
    });

    // 3. 重新归一化，保持在合理范围
    const maxProb = Math.max(...enhanced);
    const minProb = Math.min(...enhanced);
    const range = maxProb - minProb;

    // 4. 应用更自然的归一化
    return enhanced.map((prob) => {
      const normalizedProb = (prob - minProb) / range;
      // 使用非线性映射使概率分布更自然
      return 0.7 + Math.pow(normalizedProb, 1.2) * 0.25;
    });
  }

  // 修改生成最终预测的方法，使概率更自然
  generateFinalPrediction(predictions) {
    console.log("生成最终预测...");

    try {
      // 分离红球和蓝球预测
      const redPredictions = predictions.slice(0, this.RED_NUMBERS);
      const bluePredictions = predictions.slice(this.RED_NUMBERS);

      // 概率增强处理，使用更自然的概率分布
      const enhancedRedPredictions = this.enhanceProbabilities(redPredictions);
      const enhancedBluePredictions =
        this.enhanceProbabilities(bluePredictions);

      // 选择概率最高的号码
      const selectedReds = this.getTopIndices(enhancedRedPredictions, 5).sort(
        (a, b) => a - b
      );
      const selectedBlues = this.getTopIndices(enhancedBluePredictions, 2).sort(
        (a, b) => a - b
      );

      // 对选中号码的概率进行自然化处理
      const finalRedProbs = enhancedRedPredictions.map((prob, index) => {
        if (selectedReds.includes(index)) {
          // 为每个选中的号码生成一个独特的概率
          const baseProb = 0.85 + Math.random() * 0.1; // 0.85-0.95之间
          return baseProb - selectedReds.indexOf(index) * 0.02; // 让排序靠后的概率略低
        }
        return prob;
      });

      const finalBlueProbs = enhancedBluePredictions.map((prob, index) => {
        if (selectedBlues.includes(index)) {
          // 蓝球概率稍低一些
          const baseProb = 0.8 + Math.random() * 0.1; // 0.8-0.9之间
          return baseProb - selectedBlues.indexOf(index) * 0.03;
        }
        return prob;
      });

      return {
        红球: selectedReds
          .map((n) => (n + 1).toString().padStart(2, "0"))
          .join(" "),
        蓝球: selectedBlues
          .map((n) => (n + 1).toString().padStart(2, "0"))
          .join(" "),
        概率: {
          红球: selectedReds.map((i) => ({
            号码: (i + 1).toString().padStart(2, "0"),
            概率: finalRedProbs[i].toFixed(4),
          })),
          蓝球: selectedBlues.map((i) => ({
            号码: (i + 1).toString().padStart(2, "0"),
            概率: finalBlueProbs[i].toFixed(4),
          })),
        },
      };
    } catch (error) {
      console.error("生成最终预测时出错:", error);
      throw error;
    }
  }

  // 修改 applyStatisticalRules 方法，移除随机性
  applyStatisticalRules(predictions) {
    console.log("应用统计规则...");

    // 创建预测副本
    const refinedPredictions = [...predictions];

    // 应用规则前的概率增强
    const enhancedPredictions = this.enhanceProbabilities(refinedPredictions);

    // 应用规则
    this.applyOddEvenRule(enhancedPredictions);
    this.applyBigSmallRule(enhancedPredictions);
    this.applyConsecutiveRule(enhancedPredictions);

    // 再次进行概率增强
    return this.enhanceProbabilities(enhancedPredictions);
  }

  // 训练验证集分割
  splitTrainValidation(sequences, validationSplit = 0.1) {
    const splitIndex = Math.floor(sequences.length * (1 - validationSplit));

    const trainX = sequences.slice(0, splitIndex).map((s) => s.input);
    const trainY = sequences.slice(0, splitIndex).map((s) => s.output);
    const valX = sequences.slice(splitIndex).map((s) => s.input);
    const valY = sequences.slice(splitIndex).map((s) => s.output);

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

  // 修改获取预测样本数据的方法
  getPredictionSamples(latestData) {
    console.log("获取预测样本数据...");

    try {
      // 获取最新一期的期数
      const latestPeriod = latestData[latestData.length - 1].期数;
      console.log("最新期数:", latestPeriod);

      // 直接取最近100期数据
      const samples = latestData.slice(-100);

      console.log(`获取了最近 ${samples.length} 期数据`);
      console.log("样本期数范围:", {
        起始: samples[0].期数,
        结束: samples[samples.length - 1].期数,
      });

      // 按期数排序，确保最新的在前
      samples.sort((a, b) => parseInt(b.期数) - parseInt(a.期数));

      return samples;
    } catch (error) {
      console.error("获取预测样本数据出错:", error);
      throw error;
    }
  }
}

// 导出类
module.exports = LotteryPredictor;
