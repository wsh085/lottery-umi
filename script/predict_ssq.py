import json
from collections import Counter

def predict_lottery_numbers(history_data_path):
    with open(history_data_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    red_ball_counts = Counter()
    blue_ball_counts = Counter()

    for entry in data:
        red_balls_str = entry['红球']
        red_balls = [int(x) for x in red_balls_str.split(' ')]
        for ball in red_balls:
            red_ball_counts[ball] += 1

        blue_ball = int(entry['蓝球'])
        blue_ball_counts[blue_ball] += 1

    # 预测红球：选择出现频率最高的7个数字
    # 确保红球不重复
    predicted_red_balls = []
    for ball, count in red_ball_counts.most_common():
        if len(predicted_red_balls) < 7:
            predicted_red_balls.append(ball)
        else:
            break
    predicted_red_balls.sort()

    # 预测蓝球：选择出现频率最高的2个数字
    # 确保蓝球不重复
    predicted_blue_balls = []
    for ball, count in blue_ball_counts.most_common():
        if len(predicted_blue_balls) < 2:
            predicted_blue_balls.append(ball)
        else:
            break
    predicted_blue_balls.sort()

    return predicted_red_balls, predicted_blue_balls

if __name__ == "__main__":
    history_file = '/Users/pupu/wsh_github/lottery-umi/dSsq/temp_all_history_data.json'
    predicted_red, predicted_blue = predict_lottery_numbers(history_file)

    print(f"最有可能出现的红球数字: {predicted_red}")
    print(f"最有可能出现的蓝球数字: {predicted_blue}")