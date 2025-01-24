// 创建序列数据
createSequences(normalizedData) {
    console.log("创建序列数据...");
    const sequences = [];
    
    // 确保有足够的数据来创建序列
    if (normalizedData.length < this.SEQUENCE_LENGTH) {
        throw new Error(`数据量不足，需要至少${this.SEQUENCE_LENGTH}条数据`);
    }

    // 创建滑动窗口序列
    for (let i = 0; i <= normalizedData.length - this.SEQUENCE_LENGTH; i++) {
        const sequence = normalizedData.slice(i, i + this.SEQUENCE_LENGTH);
        const nextItem = normalizedData[i + this.SEQUENCE_LENGTH];
        
        if (!nextItem) continue; // 跳过最后一个序列，因为没有下一期数据

        // 准备输入数据
        const input = sequence.map(item => {
            const features = [];
            // 添加红球特征
            item.normalizedFeatures.redBalls.forEach(ball => features.push(ball));
            // 添加蓝球特征
            item.normalizedFeatures.blueBalls.forEach(ball => features.push(ball));
            // 添加频率特征
            item.normalizedFeatures.frequency.forEach(freq => features.push(freq));
            // 添加间隔特征
            item.normalizedFeatures.intervals.forEach(interval => features.push(interval));
            return features;
        });

        // 准备输出数据（下一期的号码）
        const output = [];
        // 添加红球
        nextItem.normalizedFeatures.redBalls.forEach(ball => output.push(ball));
        // 添加蓝球
        nextItem.normalizedFeatures.blueBalls.forEach(ball => output.push(ball));

        sequences.push({
            input: input,
            output: output
        });
    }

    console.log(`创建了 ${sequences.length} 个序列`);
    return sequences;
}

// 获取特征维度
getFeatureDimension() {
    // 计算每个时间步的特征数量
    return (
        5 +  // 红球数量
        2 +  // 蓝球数量
        (this.RED_NUMBERS + this.BLUE_NUMBERS) +  // 频率特征
        7    // 间隔特征
    );
}

// 预处理最新数据
preprocessLatestData(latestData) {
    // 确保数据长度正确
    if (latestData.length !== this.SEQUENCE_LENGTH) {
        throw new Error(`需要最近${this.SEQUENCE_LENGTH}期数据`);
    }

    // 对最新数据进行相同的预处理
    const normalizedData = this.normalizeData(
        this.engineerFeatures(
            this.cleanAndValidateData(latestData)
        )
    );

    // 转换为模型输入格式
    const input = normalizedData.map(item => {
        const features = [];
        // 添加红球特征
        item.normalizedFeatures.redBalls.forEach(ball => features.push(ball));
        // 添加蓝球特征
        item.normalizedFeatures.blueBalls.forEach(ball => features.push(ball));
        // 添加频率特征
        item.normalizedFeatures.frequency.forEach(freq => features.push(freq));
        // 添加间隔特征
        item.normalizedFeatures.intervals.forEach(interval => features.push(interval));
        return features;
    });

    return [input];
}

// 数据预处理
async preprocessData(rawData) {
    console.log("开始数据预处理...");
    
    if (!Array.isArray(rawData) || rawData.length === 0) {
        throw new Error('输入数据无效：数据为空或格式不正确');
    }

    try {
        // 1. 数据清洗和验证
        const cleanData = this.cleanAndValidateData(rawData);
        console.log(`清洗后的数据数量: ${cleanData.length}`);

        // 2. 特征工程
        const enhancedData = this.engineerFeatures(cleanData);
        console.log(`特征工程后的数据数量: ${enhancedData.length}`);

        // 3. 数据归一化
        const normalizedData = this.normalizeData(enhancedData);
        console.log(`归一化后的数据数量: ${normalizedData.length}`);

        // 4. 创建序列数据
        const sequences = this.createSequences(normalizedData);
        console.log(`创建的序列数量: ${sequences.length}`);

        return sequences;
    } catch (error) {
        console.error('数据预处理错误:', error);
        throw error;
    }
}

// 数据清洗和验证
cleanAndValidateData(rawData) {
    console.log("开始数据清洗和验证...");
    
    // 确保数据是数组
    if (!Array.isArray(rawData)) {
        throw new Error('输入数据必须是数组');
    }

    // 过滤并验证数据
    const cleanData = rawData.filter(item => {
        try {
            return this.validateDataItem(item);
        } catch (error) {
            console.warn('数据项验证失败:', error);
            return false;
        }
    });

    if (cleanData.length === 0) {
        throw new Error('没有有效的数据项');
    }

    return cleanData;
}

// 特征工程
engineerFeatures(cleanData) {
    console.log("开始特征工程...");
    
    return cleanData.map((item, index, array) => {
        try {
            const historicalData = array.slice(0, index);
            return {
                ...item,
                frequency: this.calculateFrequency(item),
                interval: this.calculateInterval(item, historicalData),
                hotCold: this.calculateHotCold(item, historicalData)
            };
        } catch (error) {
            console.error('特征工程处理失败:', error);
            return item;
        }
    });
}

// 数据归一化
normalizeData(data) {
    console.log("开始数据归一化...");
    
    if (!Array.isArray(data) || data.length === 0) {
        throw new Error('归一化数据无效');
    }

    return data.map(item => {
        try {
            return {
                ...item,
                normalizedFeatures: this.normalize(item)
            };
        } catch (error) {
            console.error('归一化处理失败:', error);
            throw error;
        }
    });
}

// 验证单条数据
validateDataItem(item) {
    if (!item) return false;

    try {
        // 验证期数
        if (!item.期数 || typeof item.期数 !== 'string') {
            console.warn('期数格式无效');
            return false;
        }

        // 验证红球
        if (!item.红球 || typeof item.红球 !== 'string') {
            console.warn('红球数据无效');
            return false;
        }

        // 验证蓝球
        if (!item.蓝球 || typeof item.蓝球 !== 'string') {
            console.warn('蓝球数据无效');
            return false;
        }

        const redBalls = item.红球.split(' ').map(Number);
        const blueBalls = item.蓝球.split(' ').map(Number);

        // 验证红球数量和范围
        if (redBalls.length !== 5 || !redBalls.every(n => n >= 1 && n <= 35)) {
            console.warn('红球数量或范围无效');
            return false;
        }

        // 验证蓝球数量和范围
        if (blueBalls.length !== 2 || !blueBalls.every(n => n >= 1 && n <= 12)) {
            console.warn('蓝球数量或范围无效');
            return false;
        }

        return true;
    } catch (error) {
        console.error('数据验证错误:', error);
        return false;
    }
}

// 计算号码频率
calculateFrequency(item) {
    if (!item || !item.红球 || !item.蓝球) {
        throw new Error('计算频率的数据项无效');
    }

    const frequency = new Map();
    
    // 处理红球
    const redBalls = item.红球.split(' ').map(Number);
    redBalls.forEach(num => {
        frequency.set(`red_${num}`, (frequency.get(`red_${num}`) || 0) + 1);
    });

    // 处理蓝球
    const blueBalls = item.蓝球.split(' ').map(Number);
    blueBalls.forEach(num => {
        frequency.set(`blue_${num}`, (frequency.get(`blue_${num}`) || 0) + 1);
    });

    return frequency;
}

console.log('原始数据示例:', rawData.slice(0, 2)); 