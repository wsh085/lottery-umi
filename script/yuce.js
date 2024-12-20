const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs');

// 添加常量定义
const HISTORY_PERIODS = 50;    // 使用最近50期数据
const TRAINING_EPOCHS = 200;   // 训练200轮
const PREDICTION_TIMES = 10;   // 预测10次取平均
const MIN_CONFIDENCE = 90;     // 最低置信度要求

// 添加数据归一化函数
function normalizeData(value, min, max) {
  return (value - min) / (max - min);
}

// 反归一化函数
function denormalizeData(value, min, max) {
  return Math.round(value * (max - min) + min);
}

// 添加数据验证函数
function validateNumber(num, min, max) {
  const n = Number(num);
  if (isNaN(n)) return min;
  return Math.min(Math.max(n, min), max);
}

function parseNumbers(str) {
  // 将字符串转换为数字数组
  return str.trim().split(/\s+/).map(Number);
}

// 数据预处理函数
function prepareData(historyData, sequenceLength = 5) {
  console.log('开始数据预处理...');
  console.log('原始数据样本:', historyData[0]);
  
  const features = [];
  const labels = [];
  
  const RED_MIN = 1, RED_MAX = 35;  // 修改红球范围
  const BLUE_MIN = 1, BLUE_MAX = 12;
  
  for (let i = sequenceLength; i < historyData.length; i++) {
    const sequence = historyData.slice(i - sequenceLength, i);
    const nextNumbers = historyData[i];
    
    try {
      // 处理特征数据
      const sequenceFeatures = sequence.map(item => {
        // 处理红球
        const redNumbers = parseNumbers(item.红球);
        
        // 处理蓝球 - 可能有多个蓝球，我们只取第一个
        const blueNumbers = parseNumbers(item.蓝球);
        const blueNumber = blueNumbers[0];
        
        // 验证数据
        const validRedNumbers = redNumbers
          .map(n => validateNumber(n, RED_MIN, RED_MAX))
          .slice(0, 6);
          
        // 补全红球到6个
        while (validRedNumbers.length < 6) {
          validRedNumbers.push(RED_MIN);
        }
        
        // 归一化
        const normalizedRed = validRedNumbers.map(num => 
          (num - RED_MIN) / (RED_MAX - RED_MIN)
        );
        const normalizedBlue = (blueNumber - BLUE_MIN) / (BLUE_MAX - BLUE_MIN);
        
        return [...normalizedRed, normalizedBlue];
      });
      
      // 处理标签数据
      const nextRed = parseNumbers(nextNumbers.红球);
      const nextBlue = parseNumbers(nextNumbers.蓝球)[0];
      
      // 验证和补全红球
      const validNextRed = nextRed
        .map(n => validateNumber(n, RED_MIN, RED_MAX))
        .slice(0, 6);
        
      while (validNextRed.length < 6) {
        validNextRed.push(RED_MIN);
      }
      
      // 归一化标签
      const normalizedNextRed = validNextRed.map(num => 
        (num - RED_MIN) / (RED_MAX - RED_MIN)
      );
      const normalizedNextBlue = (nextBlue - BLUE_MIN) / (BLUE_MAX - BLUE_MIN);
      
      features.push(sequenceFeatures);
      labels.push([...normalizedNextRed, normalizedNextBlue]);
      
    } catch (error) {
      console.error('数据处理错误:', error);
      console.error('问题数据:', sequence, nextNumbers);
      continue;
    }
  }
  
  // 验证数据
  console.log('处理后的特征数据示例:', features[0]);
  console.log('处理后的标签数据示例:', labels[0]);
  console.log('特征数据形状:', [features.length, features[0].length, features[0][0].length]);
  console.log('标签数据形状:', [labels.length, labels[0].length]);
  
  // 检查数据中是否有NaN或无效值
  const hasInvalidData = features.some(seq => 
    seq.some(step => step.some(val => isNaN(val) || val === undefined))) ||
    labels.some(label => label.some(val => isNaN(val) || val === undefined));
    
  if (hasInvalidData) {
    console.error('警告：数据中包含无效值！');
    throw new Error('数据包含无效值');
  }
  
  return {
    features: tf.tensor3d(features),
    labels: tf.tensor2d(labels)
  };
}

// 创建模型
function createModel() {
  const model = tf.sequential();
  
  // 优化模型结构
  model.add(tf.layers.dense({
    units: 256,
    activation: 'relu',
    inputShape: [5, 7]
  }));
  
  model.add(tf.layers.flatten());
  
  model.add(tf.layers.dense({
    units: 128,
    activation: 'relu'
  }));
  
  model.add(tf.layers.dropout(0.3));
  
  model.add(tf.layers.dense({
    units: 64,
    activation: 'relu'
  }));
  
  model.add(tf.layers.dropout(0.2));
  
  model.add(tf.layers.dense({
    units: 32,
    activation: 'relu'
  }));
  
  model.add(tf.layers.dense({
    units: 7,
    activation: 'sigmoid'
  }));
  
  // 使用更小的学习率以提高稳定性
  const optimizer = tf.train.adam(0.00005);
  
  model.compile({
    optimizer: optimizer,
    loss: 'meanSquaredError',
  });
  
  return model;
}

// 训练模型
async function trainModel(historyData) {
  console.log('开始训练模型...');
  
  // 使用常量
  const recentData = historyData.slice(-HISTORY_PERIODS);
  console.log(`使用最近 ${HISTORY_PERIODS} 期数据进行训练`);
  
  const { features, labels } = prepareData(recentData);
  const model = createModel();
  
  const callbacks = {
    onEpochEnd: async (epoch, logs) => {
      // 每20轮输出一次训练进度
      if ((epoch + 1) % 20 === 0) {
        console.log(
          `第 ${epoch + 1}/${TRAINING_EPOCHS} 轮结束: ` +
          `loss = ${logs.loss.toFixed(6)}, ` +
          `val_loss = ${logs.val_loss ? logs.val_loss.toFixed(6) : 'N/A'}`
        );
      }
    }
  };

  await model.fit(features, labels, {
    epochs: TRAINING_EPOCHS,
    batchSize: 10,
    validationSplit: 0.2,
    shuffle: true,
    callbacks: callbacks,
    verbose: 0
  });
  
  return model;
}

// 预测下一号码
async function predictNextNumbers(historyData) {
  try {
    const recentData = historyData.slice(-HISTORY_PERIODS);
    const model = await trainModel(recentData);
    
    console.log('\n最近5期数据:');
    recentData.slice(-5).forEach(item => {
      console.log(`期数: ${item.期数}, 红球: ${item.红球}, 蓝球: ${item.蓝球}`);
    });
    
    const predictions = [];
    const latestData = recentData.slice(-5);
    
    // 使用常量控制预测次数
    for (let i = 0; i < PREDICTION_TIMES; i++) {
      const inputFeatures = latestData.map(item => {
        const redNumbers = parseNumbers(item.红球)
          .map(n => validateNumber(n, 1, 35))
          .slice(0, 5);
          
        while (redNumbers.length < 5) {
          redNumbers.push(1);
        }
        
        const blueNumbers = parseNumbers(item.蓝球)
          .map(n => validateNumber(n, 1, 12))
          .slice(0, 2);
        
        while (blueNumbers.length < 2) {
          blueNumbers.push(1);
        }
        
        const normalizedRed = redNumbers.map(num => (num - 1) / (35 - 1));
        const normalizedBlue = blueNumbers.map(num => (num - 1) / (12 - 1));
        
        return [...normalizedRed, ...normalizedBlue];
      });
      
      const inputTensor = tf.tensor3d([inputFeatures]);
      const prediction = await model.predict(inputTensor).array();
      predictions.push(prediction[0]);
    }
    
    // 计算加权平均预测值
    const weights = Array(PREDICTION_TIMES).fill(1).map((_, i) => 1 + i / PREDICTION_TIMES);
    const weightSum = weights.reduce((a, b) => a + b, 0);
    
    const avgPrediction = predictions.reduce((acc, curr, idx) => {
      return curr.map((val, i) => acc[i] + val * weights[idx] / weightSum);
    }, new Array(7).fill(0));
    
    // 处理预测结果
    const predictedRed = avgPrediction.slice(0, 5)
      .map(num => Math.round(num * (35 - 1) + 1))
      .filter(num => num >= 1 && num <= 35);
      
    const predictedBlue = avgPrediction.slice(5, 7)
      .map(num => Math.round(num * (12 - 1) + 1))
      .filter(num => num >= 1 && num <= 12);
    
    // 确保红球不重复
    const uniqueRed = [...new Set(predictedRed)];
    while (uniqueRed.length < 5) {
      const newNum = Math.floor(Math.random() * 35) + 1;
      if (!uniqueRed.includes(newNum)) {
        uniqueRed.push(newNum);
      }
    }
    
    // 确保蓝球不重复
    let uniqueBlue = [...new Set(predictedBlue)];
    while (uniqueBlue.length < 2) {
      const newNum = Math.floor(Math.random() * 12) + 1;
      if (!uniqueBlue.includes(newNum)) {
        uniqueBlue.push(newNum);
      }
    }
    uniqueBlue = uniqueBlue.slice(0, 2);
    
    const result = {
      predictedRed: uniqueRed.slice(0, 5).sort((a, b) => a - b),
      predictedBlue: uniqueBlue.sort((a, b) => a - b)
    };
    
    // 计算置信度
    const confidence = calculateConfidence(predictions, result);
    
    console.log('\n预测结果:');
    console.log('红球:', result.predictedRed.join(' '));
    console.log('蓝球:', result.predictedBlue.join(' '));
    console.log(`模型置信度: ${confidence.toFixed(2)}%`);
    
    // 使用常量检查置信度
    if (confidence < MIN_CONFIDENCE) {
      console.log(`置信度 ${confidence.toFixed(2)}% 不足 ${MIN_CONFIDENCE}%，重新预测...`);
      return await predictNextNumbers(historyData);
    }
    
    // 显示统计信息
    const stats = analyzeRecentTrends(recentData);
    console.log(`\n号码统计 (最近${HISTORY_PERIODS}期):`);
    console.log('热门红球:', stats.hotRed.join(' '));
    console.log('热门蓝球:', stats.hotBlue.join(' '));
    console.log('冷门红球:', stats.coldRed.join(' '));
    console.log('冷门蓝球:', stats.coldBlue.join(' '));
    
    return result;
  } catch (error) {
    console.error('预测错误:', error);
    throw error;
  }
}

// 添加置信度计算函数
function calculateConfidence(predictions, result) {
  // 计算预测的一致性
  const consistency = predictions.reduce((acc, pred) => {
    const redMatch = pred.slice(0, 5).map(num => 
      Math.round(num * (35 - 1) + 1)
    ).filter(num => 
      result.predictedRed.includes(num)
    ).length / 5;
    
    const blueMatch = pred.slice(5, 7).map(num =>
      Math.round(num * (12 - 1) + 1)
    ).filter(num =>
      result.predictedBlue.includes(num)
    ).length / 2;
    
    return acc + (redMatch * 0.7 + blueMatch * 0.3);
  }, 0) / predictions.length * 100;
  
  return consistency;
}

// 添加数据分析函数
function analyzeRecentTrends(data) {
  const redFreq = {};
  const blueFreq = {};
  
  for (let i = 1; i <= 35; i++) redFreq[i] = 0;
  for (let i = 1; i <= 12; i++) blueFreq[i] = 0;
  
  data.forEach(item => {
    const reds = parseNumbers(item.红球);
    const blues = parseNumbers(item.蓝球);
    
    reds.forEach(num => {
      redFreq[num] = (redFreq[num] || 0) + 1;
    });
    
    blues.forEach(num => {
      blueFreq[num] = (blueFreq[num] || 0) + 1;
    });
  });
  
  const hotRed = Object.entries(redFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(item => Number(item[0]))
    .sort((a, b) => a - b);
    
  const hotBlue = Object.entries(blueFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(item => Number(item[0]))
    .sort((a, b) => a - b);
  
  const coldRed = Object.entries(redFreq)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 5)
    .map(item => Number(item[0]))
    .sort((a, b) => a - b);
    
  const coldBlue = Object.entries(blueFreq)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2)
    .map(item => Number(item[0]))
    .sort((a, b) => a - b);
  
  return { 
    hotRed, 
    hotBlue,
    coldRed,
    coldBlue,
    redFreq,
    blueFreq
  };
}

// 主函数
async function main() {
  try {
    const dataPath = path.join(__dirname, '../data/all_history_data.json');
    const historyData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    
    console.log('开始训练模型...');
    const prediction = await predictNextNumbers(historyData);
    
    console.log('\n预测结果:');
    console.log('红球:', prediction.predictedRed.join(', '));
    console.log('蓝球:', prediction.predictedBlue);
  } catch (error) {
    console.error('程序执行错误:', error);
  }
}

main();
