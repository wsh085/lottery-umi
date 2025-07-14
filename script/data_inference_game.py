import json
import random
from collections import Counter

# 数据文件路径
DATA_FILE_PATH = '/Users/pupu/wsh_github/lottery-umi/dSsq/temp_all_history_data.json'

def load_data(file_path):
    """加载历史数据"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        # 数据是按期数降序排列的，我们将其反转，按时间升序
        return sorted(data, key=lambda x: x['期数'])
    except FileNotFoundError:
        print(f"错误: 数据文件未找到 at {file_path}")
        return None
    except json.JSONDecodeError:
        print(f"错误: JSON 文件格式不正确 at {file_path}")
        return None

def predict_next(history_data):
    if not history_data:
        return [], []

    # --- 参数定义 ---
    recent_draws_count = 10  # 定义“近期”为最近10期
    overall_freq_weight = 0.5  # 长期频率权重
    recent_freq_weight = 0.5   # 近期频率权重

    # --- 红球预测 ---
    red_ball_overall_counts = Counter()
    for item in history_data:
        red_ball_overall_counts.update(item['red_balls'])

    recent_history = history_data[-recent_draws_count:]
    red_ball_recent_counts = Counter()
    for item in recent_history:
        red_ball_recent_counts.update(item['red_balls'])

    red_ball_scores = {}
    for i in range(1, 34):
        num_str = f'{i:02d}'
        overall_freq = red_ball_overall_counts.get(num_str, 0) / len(history_data)
        recent_freq = red_ball_recent_counts.get(num_str, 0) / len(recent_history)
        score = (overall_freq * overall_freq_weight) + (recent_freq * recent_freq_weight)
        red_ball_scores[num_str] = score

    predicted_red_balls = [item[0] for item in sorted(red_ball_scores.items(), key=lambda x: x[1], reverse=True)[:7]]

    # --- 蓝球预测 ---
    blue_ball_overall_counts = Counter()
    for item in history_data:
        blue_ball_overall_counts.update([item['blue_ball']])

    recent_history = history_data[-recent_draws_count:]
    blue_ball_recent_counts = Counter()
    for item in recent_history:
        blue_ball_recent_counts.update([item['blue_ball']])

    blue_ball_scores = {}
    for i in range(1, 17):
        num_str = f'{i:02d}'
        overall_freq = blue_ball_overall_counts.get(num_str, 0) / len(history_data)
        recent_freq = blue_ball_recent_counts.get(num_str, 0) / len(recent_history)
        score = (overall_freq * overall_freq_weight) + (recent_freq * recent_freq_weight)
        blue_ball_scores[num_str] = score

    predicted_blue_balls = [item[0] for item in sorted(blue_ball_scores.items(), key=lambda x: x[1], reverse=True)[:2]]

    return sorted(predicted_red_balls), sorted(predicted_blue_balls)


def self_validate(full_data, num_validations=35):
    """
    自我验证函数
    """
    if len(full_data) < 11: # 需要至少10期历史数据来预测第11期
        print("数据不足，无法进行验证。")
        return

    print(f"开始自我验证，随机抽取 {num_validations} 期数据进行测试...")
    
    hit_counts = {'blue': 0}
    red_ball_hits = Counter()

    # 确保我们有足够的样本进行验证
    if len(full_data) - 10 < num_validations:
        num_validations = len(full_data) - 10
        print(f"警告: 数据量不足以进行35次验证，将使用 {num_validations} 次。")

    validation_indices = random.sample(range(10, len(full_data)), num_validations)

    for i in validation_indices:
        train_data = full_data[:i]
        actual_data = full_data[i]
        
        prediction = predict_next(train_data)
        
        actual_red = set(actual_data['红球'].split())
        predicted_red = set(prediction['red_balls'])
        
        actual_blue = actual_data['蓝球']
        predicted_blue = set(prediction['blue_balls'])

        red_matches = len(actual_red.intersection(predicted_red))
        blue_match = 1 if actual_blue in predicted_blue else 0
        
        red_ball_hits[red_matches] += 1
        if blue_match:
            hit_counts['blue'] += 1
            
    print("\n--- 自我验证结果 ---")
    total_red_hit_5_or_more = sum(count for hits, count in red_ball_hits.items() if hits >= 5)
    
    print(f"红球命中分布: {dict(sorted(red_ball_hits.items()))}")
    if num_validations > 0:
        print(f"红球命中5个及以上的次数: {total_red_hit_5_or_more} / {num_validations} ({(total_red_hit_5_or_more/num_validations)*100:.2f}%)")
        print(f"蓝球命中率: {hit_counts['blue']} / {num_validations} ({(hit_counts['blue']/num_validations)*100:.2f}%)")
    else:
        print("没有进行任何验证。")
    print("--------------------")


def main():
    """主函数"""
    all_data = load_data(DATA_FILE_PATH)
    if not all_data:
        return

    print(f"成功加载 {len(all_data)} 期历史数据。")
    
    # 步骤 1: 自我验证当前的预测模型
    self_validate(all_data)
    
    # 步骤 2: 基于完整历史数据进行最终预测
    print("\n正在生成最新一期的预测...")
    final_prediction = predict_next(all_data)
    
    print("\n--- 最终预测结果 ---")
    print(f"预测红球 (7个): {' '.join(final_prediction['red_balls'])}")
    print(f"预测蓝球 (2个): {' '.join(final_prediction['blue_balls'])}")
    print("--------------------")
    print("\n请注意：这只是基于数据分析的推理游戏，不构成任何投资建议。")


if __name__ == '__main__':
    main()