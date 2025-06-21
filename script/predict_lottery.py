import json
from collections import Counter

def predict_numbers(history_data_path):
    with open(history_data_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    red_balls = []
    blue_balls = []

    for entry in data:
        # 红球是空格分隔的字符串，需要转换为整数列表
        red_balls.extend([int(x) for x in entry['红球'].split(' ')])
        # 蓝球是空格分隔的字符串，需要转换为整数列表
        blue_balls.extend([int(x) for x in entry['蓝球'].split(' ')])

    # 统计红球和蓝球的出现频率
    red_ball_counts = Counter(red_balls)
    blue_ball_counts = Counter(blue_balls)

    # 按照出现频率降序排列，并获取最常出现的数字
    # 红球选6个，蓝球选3个
    predicted_red_balls = [num for num, count in red_ball_counts.most_common(6)]
    predicted_blue_balls = [num for num, count in blue_ball_counts.most_common(3)]

    # 确保红球和蓝球数字不重复
    predicted_red_balls = sorted(list(set(predicted_red_balls)))
    predicted_blue_balls = sorted(list(set(predicted_blue_balls)))

    # 如果预测的红球数量不足6个，或者蓝球数量不足3个，则补充
    # 补充策略：从所有可能的数字中选择出现频率次高的，直到达到所需数量
    all_red_numbers = set(range(1, 36))
    all_blue_numbers = set(range(1, 13))

    # 补充红球
    if len(predicted_red_balls) < 6:
        remaining_red_candidates = sorted([num for num, count in red_ball_counts.most_common() if num not in predicted_red_balls], key=lambda x: red_ball_counts[x], reverse=True)
        for num in remaining_red_candidates:
            if len(predicted_red_balls) < 6:
                predicted_red_balls.append(num)
            else:
                break
        predicted_red_balls = sorted(list(set(predicted_red_balls)))

    # 补充蓝球
    if len(predicted_blue_balls) < 3:
        remaining_blue_candidates = sorted([num for num, count in blue_ball_counts.most_common() if num not in predicted_blue_balls], key=lambda x: blue_ball_counts[x], reverse=True)
        for num in remaining_blue_candidates:
            if len(predicted_blue_balls) < 3:
                predicted_blue_balls.append(num)
            else:
                break
        predicted_blue_balls = sorted(list(set(predicted_blue_balls)))

    return predicted_red_balls, predicted_blue_balls

if __name__ == '__main__':
    history_data_file = '/Users/pupu/wsh_github/lottery-umi/data/temp_all_history_data.json'
    red_balls, blue_balls = predict_numbers(history_data_file)
    print(f"最有可能出现的红球数字: {red_balls}")
    print(f"最有可能出现的蓝球数字: {blue_balls}")