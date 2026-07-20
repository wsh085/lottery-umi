#!/usr/bin/env python3
"""独立复核近100期跟随规律、严格门槛和V2融合，不调用Node主分析模块。"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_2025 = ROOT / "data" / "da_2025_data.json"
DATA_2026 = ROOT / "data" / "da_2026_data.json"
DATABASE = ROOT / "docs" / "lottery" / "大乐透近100期号码分布_2025130-2026079.json"
ANALYSIS = ROOT / "docs" / "lottery" / "大乐透近100期号码规律验证_2026080.json"
CANONICAL = ROOT / "docs" / "lottery" / "大乐透3胆5拖2蓝_预测方案综合复用版.md"

RANGE_START = 2025130
TRAIN_END = 2026049
VALIDATION_START = 2026050
RANGE_END = 2026079
TARGET_ISSUE = 2026080

RULES = (
    ("GAP_MIDDLE", "间隔号补中", (1, 2)),
    ("CONSECUTIVE_DERIVED", "连号区间衍生", (1, 2)),
    ("BLUE_0102_TO_RED_31_35", "蓝球01/02关联红球31—35", (1, 2)),
    ("COLD_LOW_REAPPEAR_T2", "小于30冷号间隔1期复开", (2,)),
    ("COLD_HIGH_REAPPEAR_T1", "30及以上冷号后续1期复开", (1,)),
    ("DIAGONAL_EXTENSION", "双向斜连延伸", (2,)),
    ("LONG_GAP_FILL", "长断区中点补位", (1,)),
    ("RED35_TO_RED0102", "红球35后首尾联动", (1,)),
)

V2_RED_PARAMS = {
    "L": (12, 15, 0.3, 0.2, -0.2, 0.05, 0.0),
    "M": (6, 15, 0.3, 0.2, -0.2, 0.0, 0.0),
    "H": (15, 38, 0.3, 0.2, -0.2, 0.2, 0.0),
    "X": (6, 30, 0.7, 0.2, 0.0, 0.2, -0.1),
}
BLUE_PARAMS = {
    "L": (12, 20, 0.8, 0.4, 0.5),
    "M": (4, 30, 0.8, 0.4, 0.5),
    "H": (10, 30, 0.6, 0.2, 0.3),
    "X": (10, 38, 0.2, 0.4, 0.1),
}

DYNAMIC = {
    "recent_long": 12,
    "recent_short": 6,
    "trial_minimum_support": 5,
    "trial_accuracy_long_minimum": 0.60,
    "trial_lift_long_minimum": 0.10,
    "trial_accuracy_short_minimum": 0.55,
    "consecutive_miss_stop": 3,
    "trial_per_rule_cap": 0.025,
    "trial_total_cap": 0.05,
    "core_per_rule_cap": 0.075,
    "all_rules_cap": 0.15,
    "alpha": 2,
    "beta": 2,
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def load_file(path: Path) -> list[dict]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    rows = []
    for item in raw:
        issue = int(item["期数"])
        reds = list(map(int, item["红球"].split()))
        blues = list(map(int, item["蓝球"].split()))
        require(len(reds) == 5 and len(set(reds)) == 5 and reds == sorted(reds), f"{issue}前区结构错误")
        require(len(blues) == 2 and len(set(blues)) == 2 and blues == sorted(blues), f"{issue}后区结构错误")
        require(all(1 <= n <= 35 for n in reds), f"{issue}前区越界")
        require(all(1 <= n <= 12 for n in blues), f"{issue}后区越界")
        require(sum(reds) == int(item["和值"]), f"{issue}和值错误")
        rows.append({"issue": issue, "reds": reds, "blues": blues})
    return rows


def load_all() -> list[dict]:
    rows_2025 = load_file(DATA_2025)
    rows_2026 = load_file(DATA_2026)
    require(len(rows_2025) == 150 and rows_2025[0]["issue"] == 2025001 and rows_2025[-1]["issue"] == 2025150, "2025范围错误")
    require(len(rows_2026) == 79 and rows_2026[0]["issue"] == 2026001 and rows_2026[-1]["issue"] == RANGE_END, "2026范围错误")
    rows = rows_2025 + rows_2026
    require(all(rows[index - 1]["issue"] < rows[index]["issue"] for index in range(1, len(rows))), "期号未递增")
    require(all(row["issue"] != TARGET_ISSUE for row in rows), "目标期已存在")
    return rows


def zone(number: int) -> int:
    return 0 if number <= 12 else 1 if number <= 24 else 2


def standardize(draws: list[dict]) -> list[dict]:
    last_seen: dict[int, int] = {}
    output = []
    for index, draw in enumerate(draws):
        omission_values = {
            number: index - last_seen[number] - 1 if number in last_seen else index
            for number in range(1, 36)
        }
        # JavaScript对象会先序列化"10"—"35"这类整数索引键，再序列化"01"—"09"。
        # 明确采用相同顺序，才能独立复算Node产物中的SHA-256。
        omissions = {
            f"{number:02d}": omission_values[number]
            for number in (*range(10, 36), *range(1, 10))
        }
        if RANGE_START <= draw["issue"] <= RANGE_END:
            odd = sum(number % 2 for number in draw["reds"])
            zones = [0, 0, 0]
            for number in draw["reds"]:
                zones[zone(number)] += 1
            output.append({
                "issue": draw["issue"],
                "reds": draw["reds"],
                "blues": draw["blues"],
                "redOmissionBefore": omissions,
                "redSum": sum(draw["reds"]),
                "oddEvenRatio": f"{odd}:{5 - odd}",
                "zoneRatio": ":".join(map(str, zones)),
                "sourceRange": f"{RANGE_START}-{RANGE_END}",
            })
        for number in draw["reds"]:
            last_seen[number] = index
    require(len(output) == 100 and output[0]["issue"] == RANGE_START and output[-1]["issue"] == RANGE_END, "100期标准化范围错误")
    return output


def uniq(values: list[int]) -> list[int]:
    return sorted({number for number in values if 1 <= number <= 35})


def diagonal(first: list[int], second: list[int]) -> list[int]:
    second_set = set(second)
    values = []
    for number in first:
        if number + 1 in second_set:
            values.extend((number + 2, number + 3))
        if number - 1 in second_set:
            values.extend((number - 2, number - 3))
    return uniq(values)


def long_gap(reds: list[int]) -> list[int]:
    values = []
    for left, right in zip(reds, reds[1:]):
        length = right - left - 1
        if length < 10:
            continue
        if length % 2:
            middle = left + 1 + length // 2
            local = (middle - 1, middle, middle + 1)
        else:
            first_middle = left + length // 2
            second_middle = first_middle + 1
            local = (first_middle - 1, first_middle, second_middle, second_middle + 1)
        values.extend(number for number in local if left < number < right)
    return uniq(values)


def candidates(rule_id: str, rows: list[dict], index: int) -> list[int]:
    row = rows[index]
    red_set = set(row["reds"])
    if rule_id == "GAP_MIDDLE":
        return [number + 1 for number in range(1, 34) if number in red_set and number + 2 in red_set]
    if rule_id == "CONSECUTIVE_DERIVED":
        values = []
        for number in range(1, 35):
            if number in red_set and number + 1 in red_set:
                values.extend(range(number - 1, number + 3))
        return uniq(values)
    if rule_id == "BLUE_0102_TO_RED_31_35":
        return [31, 32, 33, 34, 35] if set(row["blues"]) & {1, 2} else []
    if rule_id == "COLD_LOW_REAPPEAR_T2":
        return [number for number in row["reds"] if number < 30 and row["redOmissionBefore"][f"{number:02d}"] > 15]
    if rule_id == "COLD_HIGH_REAPPEAR_T1":
        return [number for number in row["reds"] if number >= 30 and row["redOmissionBefore"][f"{number:02d}"] > 15]
    if rule_id == "DIAGONAL_EXTENSION":
        return diagonal(row["reds"], rows[index + 1]["reds"]) if index + 1 < len(rows) else []
    if rule_id == "LONG_GAP_FILL":
        return long_gap(row["reds"])
    if rule_id == "RED35_TO_RED0102":
        return [1, 2] if 35 in row["reds"] else []
    raise AssertionError(rule_id)


def outcome_hit(rows: list[dict], index: int, offsets: tuple[int, ...], values: list[int]) -> bool:
    candidate_set = set(values)
    return any(candidate_set & set(rows[index + offset]["reds"]) for offset in offsets)


def events(rule_id: str, offsets: tuple[int, ...], rows: list[dict]) -> list[dict]:
    output = []
    for index in range(len(rows) - max(offsets)):
        values = candidates(rule_id, rows, index)
        if values:
            output.append({"index": index, "values": values, "success": outcome_hit(rows, index, offsets, values)})
    return output


def match_controls(rule_id: str, offsets: tuple[int, ...], rows: list[dict], source_events: list[dict]) -> list[dict]:
    trigger_indices = {event["index"] for event in source_events}
    unused = {
        index for index in range(len(rows) - max(offsets))
        if index not in trigger_indices and not candidates(rule_id, rows, index)
    }
    output = []
    for event in source_events:
        if not unused:
            break
        control = min(unused, key=lambda index: (abs(index - event["index"]), index))
        unused.remove(control)
        output.append({
            "trigger": event["index"],
            "triggerIssue": rows[event["index"]]["issue"],
            "control": control,
            "controlIssue": rows[control]["issue"],
            "triggerSuccess": event["success"],
            "controlSuccess": outcome_hit(rows, control, offsets, event["values"]),
        })
    return output


def fisher_greater(a: int, b: int, c: int, d: int) -> float:
    row_one = a + b
    total_success = a + c
    total = a + b + c + d
    if total == 0:
        return 1.0
    maximum = min(row_one, total_success)
    numerator = sum(math.comb(total_success, value) * math.comb(total - total_success, row_one - value) for value in range(a, maximum + 1))
    return numerator / math.comb(total, row_one)


def wilson(hits: int, total: int) -> list[float]:
    if total == 0:
        return [0.0, 1.0]
    z = 1.959963984540054
    proportion = hits / total
    denominator = 1 + z * z / total
    centre = (proportion + z * z / (2 * total)) / denominator
    margin = z * math.sqrt((proportion * (1 - proportion) + z * z / (4 * total)) / total) / denominator
    return [max(0.0, centre - margin), min(1.0, centre + margin)]


def evaluate(rule_id: str, offsets: tuple[int, ...], rows: list[dict]) -> dict:
    source_events = events(rule_id, offsets, rows)
    pairs = match_controls(rule_id, offsets, rows, source_events)
    support = len(pairs)
    hits = sum(pair["triggerSuccess"] for pair in pairs)
    control_hits = sum(pair["controlSuccess"] for pair in pairs)
    accuracy = hits / support if support else 0.0
    control_accuracy = control_hits / support if support else 0.0
    return {
        "rawTriggerCount": len(source_events),
        "support": support,
        "hits": hits,
        "misses": support - hits,
        "controlHits": control_hits,
        "controlMisses": support - control_hits,
        "accuracy": accuracy,
        "controlAccuracy": control_accuracy,
        "lift": accuracy - control_accuracy,
        "wilson95": wilson(hits, support),
        "fisherP": fisher_greater(hits, support - hits, control_hits, support - control_hits),
    }


def gate(train: dict, validation: dict) -> bool:
    return (validation["support"] >= 5 and validation["accuracy"] >= 0.5
            and train["lift"] > 0 and validation["lift"] > 0 and validation["fisherP"] < 0.05)


def active_candidates(rule_id: str, offsets: tuple[int, ...], rows: list[dict]) -> list[int]:
    values = []
    target_index = len(rows)
    for index in range(len(rows)):
        if any(index + offset == target_index for offset in offsets):
            values.extend(candidates(rule_id, rows, index))
    return uniq(values)


def clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return min(maximum, max(minimum, value))


def smoothed_rate(hits: int, total: int) -> float:
    return (hits + DYNAMIC["alpha"]) / (total + DYNAMIC["alpha"] + DYNAMIC["beta"])


def recent_metrics(pairs: list[dict]) -> dict:
    """只使用目标期之前已经完成结果观察的配对，独立计算12/6期动态指标。"""
    ordered = sorted(pairs, key=lambda pair: pair["trigger"])
    long_window = ordered[-DYNAMIC["recent_long"]:]
    short_window = long_window[-DYNAMIC["recent_short"]:]

    def summarize(window: list[dict]) -> dict:
        hits = sum(pair["triggerSuccess"] for pair in window)
        control_hits = sum(pair["controlSuccess"] for pair in window)
        accuracy = smoothed_rate(hits, len(window))
        control_accuracy = smoothed_rate(control_hits, len(window))
        return {
            "n": len(window), "hits": hits, "controlHits": control_hits,
            "accuracy": accuracy, "controlAccuracy": control_accuracy,
            "lift": accuracy - control_accuracy,
        }

    long = summarize(long_window)
    short = summarize(short_window)
    consecutive_misses = 0
    for pair in reversed(ordered):
        if pair["triggerSuccess"]:
            break
        consecutive_misses += 1
    return {
        "completedPairCount": len(ordered),
        "n12": long["n"], "hits12": long["hits"], "controlHits12": long["controlHits"],
        "a12": long["accuracy"], "c12": long["controlAccuracy"], "l12": long["lift"],
        "n6": short["n"], "hits6": short["hits"], "controlHits6": short["controlHits"],
        "a6": short["accuracy"], "c6": short["controlAccuracy"], "l6": short["lift"],
        "consecutiveMisses": consecutive_misses,
        "recentPairs": [{
            "triggerIssue": pair["triggerIssue"], "controlIssue": pair["controlIssue"],
            "triggerIndex": pair["trigger"], "triggerSuccess": pair["triggerSuccess"],
            "controlSuccess": pair["controlSuccess"],
        } for pair in long_window],
    }


def trial_decision(metrics: dict, values: list[int]) -> dict:
    reasons = []
    if metrics["n12"] < DYNAMIC["trial_minimum_support"]:
        reasons.append("近期完整事件数<5")
    if metrics["a12"] < DYNAMIC["trial_accuracy_long_minimum"]:
        reasons.append("A12<60%")
    if metrics["l12"] < DYNAMIC["trial_lift_long_minimum"]:
        reasons.append("L12<10个百分点")
    if metrics["a6"] < DYNAMIC["trial_accuracy_short_minimum"]:
        reasons.append("A6<55%")
    if not metrics["l6"] > 0:
        reasons.append("L6<=0")
    if metrics["consecutiveMisses"] >= DYNAMIC["consecutive_miss_stop"]:
        reasons.append("连续失误>=3")
    if not values:
        reasons.append("当前无目标期候选")
    return {"passed": not reasons, "reasons": reasons}


def dynamic_quality(metrics: dict) -> float:
    support_factor = min(metrics["n12"] / DYNAMIC["recent_long"], 1)
    accuracy_factor = clamp((metrics["a12"] - 0.50) / 0.25)
    lift_factor = clamp(metrics["l12"] / 0.25)
    trend_factor = clamp(0.5 + (metrics["a6"] - metrics["a12"]) / 0.20)
    misses = metrics["consecutiveMisses"]
    miss_factor = 0 if misses >= 3 else 0.5 if misses == 2 else 1
    return clamp(support_factor * (
        0.5 * accuracy_factor + 0.3 * lift_factor + 0.2 * trend_factor
    ) * miss_factor)


def scale_dynamic_weights(states: list[dict]) -> list[dict]:
    weighted = []
    for item in states:
        if not item["eligibility"]["passed"] or not item["candidates"] or not item["quality"] > 0:
            continue
        cap = DYNAMIC["core_per_rule_cap"] if item["tier"] == "CORE" else DYNAMIC["trial_per_rule_cap"]
        weighted.append({**item, "rawWeight": cap * item["quality"]})
    trial_raw = sum(item["rawWeight"] for item in weighted if item["tier"] == "TRIAL")
    trial_scale = DYNAMIC["trial_total_cap"] / trial_raw if trial_raw > DYNAMIC["trial_total_cap"] else 1
    for item in weighted:
        item["weight"] = item["rawWeight"] * trial_scale if item["tier"] == "TRIAL" else item["rawWeight"]
    trial_total = sum(item["weight"] for item in weighted if item["tier"] == "TRIAL")
    core_raw = sum(item["weight"] for item in weighted if item["tier"] == "CORE")
    core_available = max(0, DYNAMIC["all_rules_cap"] - trial_total)
    core_scale = core_available / core_raw if core_raw > core_available else 1
    for item in weighted:
        if item["tier"] == "CORE":
            item["weight"] *= core_scale
    return weighted


def state(history: list[dict]) -> str:
    total = sum(history[-1]["reds"])
    return "L" if total <= 75 else "M" if total <= 90 else "H" if total <= 105 else "X"


def weighted_frequency(history: list[dict], window: int, number: int) -> float:
    subset = history[-window:]
    return sum((0.5 if index == len(subset) - 1 else 1.0) for index, row in enumerate(subset) if number in row["reds"]) / len(subset)


def normal_frequency(history: list[dict], window: int, number: int, field: str) -> float:
    subset = history[-window:]
    return sum(number in row[field] for row in subset) / len(subset)


def gap(history: list[dict], number: int, field: str) -> int:
    for index in range(len(history) - 1, -1, -1):
        if number in history[index][field]:
            return len(history) - 1 - index
    return len(history)


def zone_averages(history: list[dict]) -> list[float]:
    counts = [0, 0, 0]
    for row in history:
        for number in row["reds"]:
            counts[zone(number)] += 1
    return [count / len(history) for count in counts]


def v2_scores(history: list[dict]) -> dict[int, float]:
    short, long, short_weight, long_weight, gap_weight, zone_weight, repeat_weight = V2_RED_PARAMS[state(history)]
    all_zones = zone_averages(history)
    recent_zones = zone_averages(history[-5:])
    previous = set(history[-1]["reds"])
    output = {}
    for number in range(1, 36):
        zone_delta = (all_zones[zone(number)] - recent_zones[zone(number)]) / 5
        output[number] = (short_weight * weighted_frequency(history, short, number)
                          + long_weight * weighted_frequency(history, long, number)
                          + gap_weight * min(max(gap(history, number, "reds"), 1), 12) / 12
                          + zone_weight * zone_delta + repeat_weight * int(number in previous))
    return output


def normalize(scores: dict[int, float]) -> dict[int, float]:
    minimum, maximum = min(scores.values()), max(scores.values())
    span = maximum - minimum
    return {number: (value - minimum) / span if span else 0.0 for number, value in scores.items()}


def select(scores: dict[int, float], history: list[dict]) -> dict:
    ranking = sorted(scores, key=lambda number: (-scores[number], number))
    previous = set(history[-1]["reds"])
    dan, deferred, dan_repeat = [], [], 0
    for number in ranking:
        is_repeat = number in previous
        if is_repeat and dan_repeat >= 1:
            deferred.append(number)
            continue
        dan.append(number)
        dan_repeat += int(is_repeat)
        if len(dan) == 3:
            break
    drag, skipped, all_repeat = [], [], dan_repeat
    for number in ranking:
        if number in dan:
            continue
        is_repeat = number in previous
        if is_repeat and all_repeat >= 2:
            skipped.append(number)
            continue
        drag.append(number)
        all_repeat += int(is_repeat)
        if len(drag) == 5:
            break
    all_numbers = sorted(dan + drag)
    return {
        "dan": sorted(dan), "drag": sorted(drag), "all": all_numbers,
        "selectedRepeats": [number for number in all_numbers if number in previous],
        "danRepeats": [number for number in dan if number in previous],
        "danDeferred": sorted(set(deferred) & set(drag)),
        "skippedRepeat": sorted(set(skipped)),
        "danRepeat": dan_repeat, "allRepeat": all_repeat,
    }


def predict_blue(history: list[dict]) -> list[int]:
    short, long, short_weight, long_weight, gap_weight = BLUE_PARAMS[state(history)]
    scores = {}
    for number in range(1, 13):
        scores[number] = (short_weight * normal_frequency(history, short, number, "blues")
                          + long_weight * normal_frequency(history, long, number, "blues")
                          + gap_weight * min(gap(history, number, "blues"), 10) / 10)
    return sorted(sorted(scores, key=lambda number: (-scores[number], number))[:2])


def dynamic_predict(history: list[dict], rule_rows: list[dict], core_rule_ids: list[str] | None = None) -> dict:
    """独立实现B双层门控；不读取Node输出中的分数、门槛或预测号码。"""
    core_ids = set(core_rule_ids or [])
    states = []
    for rule_id, label, offsets in RULES:
        source_events = events(rule_id, offsets, rule_rows)
        metrics = recent_metrics(match_controls(rule_id, offsets, rule_rows, source_events))
        values = active_candidates(rule_id, offsets, rule_rows)
        tier = "CORE" if rule_id in core_ids else "TRIAL"
        quality = dynamic_quality(metrics)
        if tier == "TRIAL":
            eligibility = trial_decision(metrics, values)
        else:
            reasons = []
            if not values:
                reasons.append("当前无目标期候选")
            if not quality > 0:
                reasons.append("动态质量为0")
            eligibility = {"passed": not reasons, "reasons": reasons}
        states.append({
            "id": rule_id, "label": label, "tier": tier, "metrics": metrics,
            "candidates": values, "eligibility": eligibility, "quality": quality,
        })

    weighted = scale_dynamic_weights(states)
    by_id = {item["id"]: item for item in weighted}
    rule_states = []
    for item in states:
        weighted_item = by_id.get(item["id"])
        rule_states.append({
            **item,
            "rawWeight": weighted_item["rawWeight"] if weighted_item else 0,
            "weight": weighted_item["weight"] if weighted_item else 0,
        })
    active_rules = [item for item in rule_states if item["weight"] > 0]
    trial_weight = sum(item["weight"] for item in active_rules if item["tier"] == "TRIAL")
    core_weight = sum(item["weight"] for item in active_rules if item["tier"] == "CORE")
    total_weight = trial_weight + core_weight
    require(trial_weight <= DYNAMIC["trial_total_cap"] + 1e-12, "独立复核试用层权重越界")
    require(total_weight <= DYNAMIC["all_rules_cap"] + 1e-12, "独立复核总规律权重越界")

    base_scores = v2_scores(history)
    normalized = normalize(base_scores)
    fused = {
        number: (1 - total_weight) * normalized[number]
        + sum(item["weight"] for item in active_rules if number in item["candidates"])
        for number in range(1, 36)
    }
    baseline = select(base_scores, history)
    final = select(fused, history)
    blues = predict_blue(history)
    baseline["blues"] = blues
    final["blues"] = blues
    return {
        "state": state(history), "ruleStates": rule_states, "activeRules": active_rules,
        "trialWeight": trial_weight, "coreWeight": core_weight, "totalRuleWeight": total_weight,
        "v2Weight": 1 - total_weight, "baselineV2": baseline, "final": final,
        "changedFromV2": baseline["dan"] != final["dan"] or baseline["all"] != final["all"],
    }


def prediction_hits(selection: dict, actual: dict) -> dict:
    actual_reds, actual_blues = set(actual["reds"]), set(actual["blues"])
    dan_hits = sum(number in actual_reds for number in selection["dan"])
    cover = sum(number in actual_reds for number in selection["all"])
    blue_hits = sum(number in actual_blues for number in selection["blues"])
    return {"danHits": dan_hits, "cover": cover, "blueHits": blue_hits,
            "unionHit": dan_hits >= 1 or blue_hits >= 1}


def rolling_dynamic(all_draws: list[dict], rows: list[dict]) -> dict:
    targets = [draw for draw in all_draws if 2026042 <= draw["issue"] <= RANGE_END]
    require(len(targets) == 38, "独立动态滚动目标不是38期")
    rolling_rows = []
    for target in targets:
        target_index = next(index for index, draw in enumerate(all_draws) if draw["issue"] == target["issue"])
        history = all_draws[:target_index]
        rule_history = [row for row in rows if row["issue"] < target["issue"]]
        require(history[-1]["issue"] < target["issue"] and rule_history[-1]["issue"] < target["issue"],
                f"{target['issue']}独立滚动出现数据泄漏")
        prediction = dynamic_predict(history, rule_history, [])
        baseline_hits = prediction_hits(prediction["baselineV2"], target)
        dynamic_hits = prediction_hits(prediction["final"], target)
        rolling_rows.append({
            "issue": target["issue"], "state": prediction["state"],
            "ruleHistoryEnd": rule_history[-1]["issue"],
            "trialWeight": prediction["trialWeight"], "coreWeight": prediction["coreWeight"],
            "totalRuleWeight": prediction["totalRuleWeight"], "v2Weight": prediction["v2Weight"],
            "changedFromV2": prediction["changedFromV2"], "ruleStates": prediction["ruleStates"],
            "baselineV2": {**{key: prediction["baselineV2"][key] for key in ("dan", "drag", "all", "blues")}, **baseline_hits},
            "dynamic": {**{key: prediction["final"][key] for key in ("dan", "drag", "all", "blues")}, **dynamic_hits},
            "actualReds": target["reds"], "actualBlues": target["blues"],
        })
    return {"rows": rolling_rows}


def compare_dynamic_state(local: dict, remote: dict, label: str) -> None:
    for key in ("id", "label", "tier", "candidates", "eligibility"):
        require(local[key] == remote[key], f"{label}.{key}不一致")
    for key in ("quality", "rawWeight", "weight"):
        compare_float(local[key], remote[key], f"{label}.{key}")
    local_metrics, remote_metrics = local["metrics"], remote["metrics"]
    for key in ("completedPairCount", "n12", "hits12", "controlHits12", "n6", "hits6",
                "controlHits6", "consecutiveMisses", "recentPairs"):
        require(local_metrics[key] == remote_metrics[key], f"{label}.metrics.{key}不一致")
    for key in ("a12", "c12", "l12", "a6", "c6", "l6"):
        compare_float(local_metrics[key], remote_metrics[key], f"{label}.metrics.{key}")


def compare_float(actual: float, expected: float, label: str) -> None:
    require(math.isclose(actual, expected, rel_tol=1e-12, abs_tol=1e-12), f"{label}不一致：{actual} != {expected}")


def main() -> None:
    all_draws = load_all()
    rows = standardize(all_draws)
    database = json.loads(DATABASE.read_text(encoding="utf-8"))
    analysis = json.loads(ANALYSIS.read_text(encoding="utf-8"))
    require(database["rows"] == rows, "标准化100期数据库与独立重建不一致")
    compact_rows = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    data_hash = hashlib.sha256(compact_rows.encode()).hexdigest()
    require(data_hash == database["meta"]["dataHash"] == analysis["data"]["dataHash"], "100期数据哈希不一致")
    require(long_gap([1, 9, 20, 25, 35]) == [13, 14, 15, 16], "双中点四码复核失败")
    require(diagonal([10], [9, 11]) == [7, 8, 12, 13], "双向斜连复核失败")

    train_rows = [row for row in rows if row["issue"] <= TRAIN_END]
    validation_rows = [row for row in rows if row["issue"] >= VALIDATION_START]
    require(len(train_rows) == 70 and len(validation_rows) == 30, "70/30切分错误")
    node_rules = {item["id"]: item for item in analysis["rules"]}
    accepted = []
    active = []
    for rule_id, label, offsets in RULES:
        train = evaluate(rule_id, offsets, train_rows)
        validation = evaluate(rule_id, offsets, validation_rows)
        node = node_rules[rule_id]
        require(node["label"] == label, f"{rule_id}标签不一致")
        for segment_name, local in (("train", train), ("validation", validation)):
            remote = node[segment_name]
            for key in ("rawTriggerCount", "support", "hits", "misses", "controlHits", "controlMisses"):
                require(local[key] == remote[key], f"{rule_id}.{segment_name}.{key}不一致")
            for key in ("accuracy", "controlAccuracy", "lift", "fisherP"):
                compare_float(local[key], remote[key], f"{rule_id}.{segment_name}.{key}")
            for index in range(2):
                compare_float(local["wilson95"][index], remote["wilson95"][index], f"{rule_id}.{segment_name}.wilson95[{index}]")
        passed = gate(train, validation)
        require(passed == node["gate"]["passed"], f"{rule_id}门槛裁决不一致")
        if passed:
            accepted.append(rule_id)
            values = active_candidates(rule_id, offsets, rows)
            if values:
                weight = (validation["accuracy"] * validation["lift"] * min(validation["support"] / 10, 1)
                          * min(-math.log10(max(validation["fisherP"], 1e-12)), 3) / 3)
                active.append({"id": rule_id, "values": values, "weight": weight})
    require(accepted == analysis["acceptedRuleIds"], "通过规律列表不一致")
    require(len(active) == len(analysis["prediction"]["activeRules"]), "活动规律数量不一致")

    base = v2_scores(all_draws)
    normalized = normalize(base)
    if active:
        total_weight = sum(item["weight"] for item in active)
        fused = {
            number: 0.85 * normalized[number] + 0.15 * sum(item["weight"] for item in active if number in item["values"]) / total_weight
            for number in range(1, 36)
        }
    else:
        fused = normalized
    prediction = select(fused, all_draws)
    prediction["blues"] = predict_blue(all_draws)
    remote_prediction = analysis["prediction"]["final"]
    for key in ("dan", "drag", "all", "selectedRepeats", "danRepeats", "danDeferred", "skippedRepeat", "danRepeat", "allRepeat", "blues"):
        require(prediction[key] == remote_prediction[key], f"最终预测{key}不一致")
    require(state(all_draws) == analysis["prediction"]["state"] == "M", "目标状态不一致")

    # 独立重算当前动态权重与最终号码。
    local_dynamic = dynamic_predict(all_draws, rows, accepted)
    remote_dynamic = analysis["dynamicGate"]["current"]
    require(local_dynamic["state"] == remote_dynamic["state"], "当前动态状态不一致")
    require(local_dynamic["changedFromV2"] == remote_dynamic["changedFromV2"], "当前动态换号标志不一致")
    for key in ("trialWeight", "coreWeight", "totalRuleWeight", "v2Weight"):
        compare_float(local_dynamic[key], remote_dynamic[key], f"currentDynamic.{key}")
    require(len(local_dynamic["ruleStates"]) == len(remote_dynamic["ruleStates"]) == len(RULES), "当前动态规律数不一致")
    for local_state, remote_state in zip(local_dynamic["ruleStates"], remote_dynamic["ruleStates"]):
        compare_dynamic_state(local_state, remote_state, f"currentDynamic.{local_state['id']}")
    for selection_name in ("baselineV2", "final"):
        for key in ("dan", "drag", "all", "blues", "selectedRepeats", "danRepeats", "danDeferred",
                    "skippedRepeat", "danRepeat", "allRepeat"):
            require(local_dynamic[selection_name][key] == remote_dynamic[selection_name][key],
                    f"currentDynamic.{selection_name}.{key}不一致")

    # 最近38期逐期重建：历史截止期、权重、号码和命中均逐行比对。
    local_rolling = rolling_dynamic(all_draws, rows)
    remote_rolling = analysis["dynamicGate"]["rolling38"]
    require(len(local_rolling["rows"]) == len(remote_rolling["rows"]) == 38, "动态滚动行数不一致")
    baseline_summary = {key: 0 for key in ("danAny", "danGe2", "coverGe1", "coverGe2", "coverGe3", "totalCover", "blueAny", "union")}
    dynamic_summary = dict(baseline_summary)
    activation_counts = {rule_id: 0 for rule_id, _, _ in RULES}
    for local_row, remote_row in zip(local_rolling["rows"], remote_rolling["rows"]):
        issue = local_row["issue"]
        for key in ("issue", "state", "ruleHistoryEnd", "changedFromV2", "actualReds", "actualBlues"):
            require(local_row[key] == remote_row[key], f"rolling.{issue}.{key}不一致")
        for key in ("trialWeight", "coreWeight", "totalRuleWeight", "v2Weight"):
            compare_float(local_row[key], remote_row[key], f"rolling.{issue}.{key}")
        for local_state, remote_state in zip(local_row["ruleStates"], remote_row["ruleStates"]):
            compare_dynamic_state(local_state, remote_state, f"rolling.{issue}.{local_state['id']}")
            if local_state["weight"] > 0:
                activation_counts[local_state["id"]] += 1
        for selection_name, summary in (("baselineV2", baseline_summary), ("dynamic", dynamic_summary)):
            local_selection, remote_selection = local_row[selection_name], remote_row[selection_name]
            for key in ("dan", "drag", "all", "blues", "danHits", "cover", "blueHits", "unionHit"):
                require(local_selection[key] == remote_selection[key], f"rolling.{issue}.{selection_name}.{key}不一致")
            summary["danAny"] += int(local_selection["danHits"] >= 1)
            summary["danGe2"] += int(local_selection["danHits"] >= 2)
            summary["coverGe1"] += int(local_selection["cover"] >= 1)
            summary["coverGe2"] += int(local_selection["cover"] >= 2)
            summary["coverGe3"] += int(local_selection["cover"] >= 3)
            summary["totalCover"] += local_selection["cover"]
            summary["blueAny"] += int(local_selection["blueHits"] >= 1)
            summary["union"] += int(local_selection["unionHit"])
    require(baseline_summary == remote_rolling["baseline"], "38期V2汇总不一致")
    require(dynamic_summary == remote_rolling["dynamic"], "38期动态汇总不一致")
    require({key: dynamic_summary[key] - baseline_summary[key] for key in dynamic_summary} == remote_rolling["difference"],
            "38期差异汇总不一致")
    require(activation_counts == remote_rolling["diagnostics"]["activationCounts"], "38期规律启用计数不一致")
    weights = [row["totalRuleWeight"] for row in local_rolling["rows"]]
    require(sum(value > 0 for value in weights) == remote_rolling["diagnostics"]["enabledPeriods"], "38期启用期数不一致")
    require(sum(row["changedFromV2"] for row in local_rolling["rows"]) == remote_rolling["diagnostics"]["changedPeriods"],
            "38期换号期数不一致")
    compare_float(sum(weights) / len(weights), remote_rolling["diagnostics"]["averageRuleWeight"], "rolling.averageRuleWeight")
    compare_float(max(weights), remote_rolling["diagnostics"]["maximumRuleWeight"], "rolling.maximumRuleWeight")

    markdown_files = sorted((ROOT / "docs" / "lottery").rglob("*.md"))
    require(markdown_files == [CANONICAL], f"docs/lottery应只保留唯一Markdown：{markdown_files}")
    canonical_text = CANONICAL.read_text(encoding="utf-8")
    marker = f"PATTERN_GATE_OK range={RANGE_START}-{RANGE_END} train={RANGE_START}-{TRAIN_END} validation={VALIDATION_START}-{RANGE_END} rules=8 accepted={len(accepted)} active={len(active)} decision=KEEP_V2"
    require(marker in canonical_text, "唯一综合文档缺少规律门控审计标记")
    independent_marker = f"INDEPENDENT_VERIFY_OK rows={len(rows)} rules={len(RULES)} accepted={len(accepted)} prediction_match=1 data_hash={data_hash}"
    require(independent_marker in canonical_text, "唯一综合文档缺少固定层独立复核标记")
    dynamic_marker = (f"DYNAMIC_INDEPENDENT_VERIFY_OK rows=38 active={len(local_dynamic['activeRules'])} "
                      f"prediction_match=1 data_hash={data_hash}")
    require(dynamic_marker in canonical_text, "唯一综合文档缺少动态独立复核标记")
    require("红球胆码（3个）：04、25、27" in canonical_text, "综合复用文档胆码不一致")
    require("红球拖码（5个）：01、13、20、26、32" in canonical_text, "综合复用文档拖码不一致")
    require("蓝球（2个）：02、11" in canonical_text, "综合复用文档蓝球不一致")

    print(f"DATA_REBUILD_OK rows={len(rows)} range={rows[0]['issue']}-{rows[-1]['issue']} hash={data_hash}")
    print(f"RULE_RECALC_OK rules={len(RULES)} accepted={len(accepted)} active={len(active)}")
    print("EVENT_DEFINITION_OK diagonal=bidirectional long_gap=missing>=10 even_midpoint=4")
    print(f"PREDICTION_RECALC_OK issue={TARGET_ISSUE} dan={','.join(f'{n:02d}' for n in prediction['dan'])} drag={','.join(f'{n:02d}' for n in prediction['drag'])} blue={','.join(f'{n:02d}' for n in prediction['blues'])}")
    print(f"DYNAMIC_RECALC_OK rows=38 active={len(local_dynamic['activeRules'])} enabled={remote_rolling['diagnostics']['enabledPeriods']} changed={remote_rolling['diagnostics']['changedPeriods']}")
    print("DOCUMENT_MATCH_OK canonical=1 analysis_json=1 single_markdown=1")
    print("DYNAMIC_INDEPENDENT_VERIFY_OK")


if __name__ == "__main__":
    main()
