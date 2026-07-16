#!/usr/bin/env python3
"""独立复核大乐透时间分块集成，不调用Node.js主计算脚本。"""

from __future__ import annotations

import hashlib
import json
import math
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_2025 = ROOT / "data" / "da_2025_data.json"
DATA_2026 = ROOT / "data" / "da_2026_data.json"
FREEZE = ROOT / "docs" / "lottery" / "大乐透8红三球覆盖开发冻结记录_2026080.json"
FREEZE_MD = ROOT / "docs" / "lottery" / "大乐透8红三球覆盖开发冻结记录_2026080.md"
FAIL_MD = ROOT / "docs" / "lottery" / "大乐透8红三球覆盖独立验证失败报告_2026080.md"
CANONICAL_MD = ROOT / "docs" / "lottery" / "大乐透3胆5拖2蓝_预测方案综合复用版.md"
ISSUE_MD = ROOT / "docs" / "lottery" / "大乐透2026080期_3胆5拖2蓝_严格滚动预测.md"

DEV_END = 2026041
DEV_TARGET_START = 2025039
VALIDATION_START = 2026042
VALIDATION_END = 2026079
BLOCKS = (("D1", 2025039, 2025089), ("D2", 2025090, 2025140), ("D3", 2025141, 2026041))

BLUE_PARAMS = {
    "L": (12, 20, 0.8, 0.4, 0.5),
    "M": (4, 30, 0.8, 0.4, 0.5),
    "H": (10, 30, 0.6, 0.2, 0.3),
    "X": (10, 38, 0.2, 0.4, 0.1),
}
V2_RED_PARAMS = {
    "L": (12, 15, 0.3, 0.2, -0.2, 0.05, 0),
    "M": (6, 15, 0.3, 0.2, -0.2, 0, 0),
    "H": (15, 38, 0.3, 0.2, -0.2, 0.2, 0),
    "X": (6, 30, 0.7, 0.2, 0, 0.2, -0.1),
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def load_file(path: Path) -> list[dict]:
    rows = json.loads(path.read_text(encoding="utf-8"))
    draws = []
    for row in rows:
        issue = int(row["期数"])
        reds = list(map(int, row["红球"].split()))
        blues = list(map(int, row["蓝球"].split()))
        require(len(reds) == 5 and len(set(reds)) == 5 and reds == sorted(reds), f"{issue}前区结构错误")
        require(len(blues) == 2 and len(set(blues)) == 2 and blues == sorted(blues), f"{issue}后区结构错误")
        require(all(1 <= n <= 35 for n in reds) and all(1 <= n <= 12 for n in blues), f"{issue}号码越界")
        require(sum(reds) == int(row["和值"]), f"{issue}和值错误")
        draws.append({"issue": issue, "reds": reds, "blues": blues})
    return draws


def state_of(history: list[dict]) -> str:
    total = sum(history[-1]["reds"])
    return "L" if total <= 75 else "M" if total <= 90 else "H" if total <= 105 else "X"


def zone_of(number: int) -> int:
    return 0 if number <= 12 else 1 if number <= 24 else 2


def weighted_frequency(history: list[dict], window: int, number: int) -> float:
    subset = history[-window:]
    if not subset:
        return 0.0
    total = sum((0.5 if index == len(subset) - 1 else 1.0) for index, draw in enumerate(subset) if number in draw["reds"])
    return total / len(subset)


def normal_frequency(history: list[dict], window: int, number: int, field: str) -> float:
    subset = history[-window:]
    return sum(number in draw[field] for draw in subset) / len(subset) if subset else 0.0


def actual_gap(history: list[dict], number: int, field: str = "reds") -> int:
    for index in range(len(history) - 1, -1, -1):
        if number in history[index][field]:
            return len(history) - 1 - index
    return len(history)


def zone_averages(history: list[dict]) -> list[float]:
    if not history:
        return [0.0, 0.0, 0.0]
    counts = [0, 0, 0]
    for draw in history:
        for number in draw["reds"]:
            counts[zone_of(number)] += 1
    return [count / len(history) for count in counts]


def odd_average(history: list[dict]) -> float:
    return sum(sum(number % 2 for number in draw["reds"]) for draw in history) / len(history) if history else 0.0


def gap_shape(shape: str, gap: int) -> float:
    effective = max(gap, 1)
    if shape == "ACTIVE":
        return math.exp(-effective / 3)
    if shape == "MILD_REBOUND":
        return math.exp(-abs(effective - 4) / 3)
    if shape == "MID_REBOUND":
        return math.exp(-abs(effective - 7) / 4)
    if shape == "LONG_PENALTY":
        return -min(effective, 12) / 12
    raise AssertionError(shape)


def conditional_state_frequency(history: list[dict], number: int, match_window: int | str) -> float:
    current_state = state_of(history)
    matched = []
    for index in range(1, len(history)):
        previous_total = sum(history[index - 1]["reds"])
        response_state = "L" if previous_total <= 75 else "M" if previous_total <= 90 else "H" if previous_total <= 105 else "X"
        if response_state == current_state:
            matched.append(history[index])
    subset = matched if match_window == "ALL" else matched[-int(match_window):]
    return sum(number in draw["reds"] for draw in subset) / len(subset) if subset else 0.0


def cooccurrence(history: list[dict], number: int, aggregate: str) -> float:
    previous_numbers = history[-1]["reds"]
    prior = history[:-1]
    if not prior:
        return 0.0
    rates = [sum(number in draw["reds"] and previous in draw["reds"] for draw in prior) / len(prior) for previous in previous_numbers]
    return max(rates) if aggregate == "MAX" else sum(rates) if aggregate == "SUM" else sum(rates) / len(rates)


def create_candidates() -> list[dict]:
    candidates = []

    def add(family: str, params: dict, complexity: int) -> None:
        candidates.append({"id": f"C{len(candidates) + 1:03d}", "family": family, "params": params, "complexity": complexity})

    for short in (4, 6, 8, 10, 12, 15):
        for medium in (20, 30):
            for long in (38, 60, 100):
                for weights in ([0.6, 0.3, 0.1], [0.4, 0.4, 0.2], [0.3, 0.3, 0.4]):
                    add("FREQUENCY", {"short": short, "medium": medium, "long": long, "weights": weights}, 4)
    for shape in ("ACTIVE", "MILD_REBOUND", "MID_REBOUND", "LONG_PENALTY"):
        add("GAP_SHAPE", {"shape": shape}, 1)
    for recent in (5, 10):
        add("ZONE_REBOUND", {"recentWindow": recent}, 1)
    add("ZONE_BLEND", {"recentWindows": [5, 10], "weights": [0.6, 0.4]}, 2)
    for recent in (5, 10):
        add("PARITY_REBOUND", {"recentWindow": recent}, 1)
    add("ZONE_PARITY_BLEND", {"recentWindow": 5, "zoneWeight": 0.7, "parityWeight": 0.3}, 3)
    for match_window in (20, 50, "ALL"):
        add("STATE_FREQUENCY", {"matchWindow": match_window}, 1)
    for aggregate in ("MEAN", "MAX", "SUM"):
        for repeat_weight in (-0.1, -0.05, 0):
            add("COOCCURRENCE", {"aggregate": aggregate, "repeatWeight": repeat_weight}, 2)
    add("BALANCED_V2", {"version": "V2"}, 7)
    require(len(candidates) == 131, "候选数错误")
    return candidates


def score(candidate: dict, history: list[dict], number: int) -> float:
    family = candidate["family"]
    params = candidate["params"]
    repeat = int(number in history[-1]["reds"])
    if family == "FREQUENCY":
        weights = params["weights"]
        return (weights[0] * weighted_frequency(history, params["short"], number)
                + weights[1] * weighted_frequency(history, params["medium"], number)
                + weights[2] * weighted_frequency(history, params["long"], number))
    if family == "GAP_SHAPE":
        return gap_shape(params["shape"], actual_gap(history, number))
    if family == "ZONE_REBOUND":
        long_avg, recent_avg = zone_averages(history), zone_averages(history[-params["recentWindow"]:])
        return (long_avg[zone_of(number)] - recent_avg[zone_of(number)]) / 5
    if family == "ZONE_BLEND":
        long_avg = zone_averages(history)
        return sum(weight * (long_avg[zone_of(number)] - zone_averages(history[-window:])[zone_of(number)]) / 5
                   for window, weight in zip(params["recentWindows"], params["weights"]))
    if family == "PARITY_REBOUND":
        deficit = odd_average(history) - odd_average(history[-params["recentWindow"]:])
        return deficit / 5 if number % 2 else -deficit / 5
    if family == "ZONE_PARITY_BLEND":
        recent = history[-params["recentWindow"]:]
        long_zones, recent_zones = zone_averages(history), zone_averages(recent)
        zone_score = (long_zones[zone_of(number)] - recent_zones[zone_of(number)]) / 5
        deficit = odd_average(history) - odd_average(recent)
        parity_score = deficit / 5 if number % 2 else -deficit / 5
        return params["zoneWeight"] * zone_score + params["parityWeight"] * parity_score
    if family == "STATE_FREQUENCY":
        return conditional_state_frequency(history, number, params["matchWindow"])
    if family == "COOCCURRENCE":
        return cooccurrence(history, number, params["aggregate"]) + params["repeatWeight"] * repeat
    if family == "BALANCED_V2":
        short, long, sw, lw, gw, zw, rw = V2_RED_PARAMS[state_of(history)]
        long_zones, recent_zones = zone_averages(history), zone_averages(history[-5:])
        zone_delta = (long_zones[zone_of(number)] - recent_zones[zone_of(number)]) / 5
        return (sw * weighted_frequency(history, short, number)
                + lw * weighted_frequency(history, long, number)
                + gw * min(max(actual_gap(history, number), 1), 12) / 12
                + zw * zone_delta + rw * repeat)
    raise AssertionError(family)


def ranking(candidate: dict, history: list[dict]) -> list[int]:
    return sorted(range(1, 36), key=lambda number: (-score(candidate, history, number), number))


def select(ranked_numbers: list[int], history: list[dict]) -> dict:
    previous = set(history[-1]["reds"])
    dan, dan_repeat = [], 0
    for number in ranked_numbers:
        is_repeat = number in previous
        if is_repeat and dan_repeat >= 1:
            continue
        dan.append(number)
        dan_repeat += int(is_repeat)
        if len(dan) == 3:
            break
    drag, all_repeat = [], dan_repeat
    for number in ranked_numbers:
        if number in dan:
            continue
        is_repeat = number in previous
        if is_repeat and all_repeat >= 2:
            continue
        drag.append(number)
        all_repeat += int(is_repeat)
        if len(drag) == 5:
            break
    return {"dan": sorted(dan), "drag": sorted(drag), "all": sorted(dan + drag), "danRepeat": dan_repeat, "allRepeat": all_repeat}


def ensemble_ranking(candidates: list[dict], history: list[dict]) -> list[int]:
    votes = Counter()
    for candidate in candidates:
        for rank_index, number in enumerate(ranking(candidate, history)):
            votes[number] += 1 / (1 + rank_index)
    return sorted(range(1, 36), key=lambda number: (-votes[number] / len(candidates), number))


def predict_blue(history: list[dict]) -> list[int]:
    short, long, sw, lw, gw = BLUE_PARAMS[state_of(history)]
    scored = []
    for number in range(1, 13):
        value = (sw * normal_frequency(history, short, number, "blues")
                 + lw * normal_frequency(history, long, number, "blues")
                 + gw * min(actual_gap(history, number, "blues"), 10) / 10)
        scored.append((number, value))
    return sorted(number for number, _ in sorted(scored, key=lambda item: (-item[1], item[0]))[:2])


def empty_metrics() -> dict:
    return {"rows": 0, "danAny": 0, "danGe2": 0, "coverGe1": 0, "coverGe2": 0, "coverGe3": 0, "totalCover": 0, "maxDanRepeat": 0, "maxAllRepeat": 0}


def record(metrics: dict, selected: dict, actual: dict) -> tuple[int, int]:
    actual_reds = set(actual["reds"])
    dan_hits = sum(number in actual_reds for number in selected["dan"])
    cover = sum(number in actual_reds for number in selected["all"])
    metrics["rows"] += 1
    metrics["danAny"] += dan_hits >= 1
    metrics["danGe2"] += dan_hits >= 2
    metrics["coverGe1"] += cover >= 1
    metrics["coverGe2"] += cover >= 2
    metrics["coverGe3"] += cover >= 3
    metrics["totalCover"] += cover
    metrics["maxDanRepeat"] = max(metrics["maxDanRepeat"], selected["danRepeat"])
    metrics["maxAllRepeat"] = max(metrics["maxAllRepeat"], selected["allRepeat"])
    return dan_hits, cover


def stability_key(result: dict) -> tuple:
    block_counts = [result["blocks"][block_id]["coverGe3"] for block_id, _, _ in BLOCKS]
    block_mean = sum(block_counts) / len(block_counts)
    block_variance = sum((value - block_mean) ** 2 for value in block_counts) / len(block_counts)
    overall = result["overall"]
    if "candidate" in result:
        complexity = result["candidate"]["complexity"]
        identifier = result["candidate"]["id"]
    else:
        complexity = result["ensembleSize"]
        identifier = f"E{result['ensembleSize']:02d}"
    return (-min(block_counts), block_variance, -overall["coverGe3"], -overall["totalCover"],
            -overall["coverGe2"], -overall["coverGe1"], -overall["danGe2"], -overall["danAny"], complexity, identifier)


def evaluate_bases(dev: list[dict], candidates: list[dict]) -> list[dict]:
    results = {candidate["id"]: {"candidate": candidate, "overall": empty_metrics(), "blocks": {item[0]: empty_metrics() for item in BLOCKS}} for candidate in candidates}
    for target_index, target in enumerate(dev):
        if target["issue"] < DEV_TARGET_START:
            continue
        history = dev[:target_index]
        block_id = next(block_id for block_id, start, end in BLOCKS if start <= target["issue"] <= end)
        for candidate in candidates:
            selected = select(ranking(candidate, history), history)
            record(results[candidate["id"]]["overall"], selected, target)
            record(results[candidate["id"]]["blocks"][block_id], selected, target)
    return sorted(results.values(), key=stability_key)


def evaluate_ensemble(dev: list[dict], candidates: list[dict]) -> dict:
    overall = empty_metrics()
    blocks = {item[0]: empty_metrics() for item in BLOCKS}
    for target_index, target in enumerate(dev):
        if target["issue"] < DEV_TARGET_START:
            continue
        history = dev[:target_index]
        selected = select(ensemble_ranking(candidates, history), history)
        block_id = next(block_id for block_id, start, end in BLOCKS if start <= target["issue"] <= end)
        record(overall, selected, target)
        record(blocks[block_id], selected, target)
    return {"ensembleSize": len(candidates), "overall": overall, "blocks": blocks}


def main() -> None:
    draws2025, draws2026 = load_file(DATA_2025), load_file(DATA_2026)
    require(len(draws2025) == 150 and len(draws2026) == 79, "数据行数错误")
    require((draws2025[0]["issue"], draws2025[-1]["issue"]) == (2025001, 2025150), "2025范围错误")
    require((draws2026[0]["issue"], draws2026[-1]["issue"]) == (2026001, 2026079), "2026范围错误")
    draws = draws2025 + draws2026
    require(all(draws[index - 1]["issue"] < draws[index]["issue"] for index in range(1, len(draws))), "合并顺序错误")
    require(not any(draw["issue"] == 2026080 for draw in draws), "目标期已存在")
    print("DATA_OK rows=229 range=2025001-2026079 target_absent=2026080")

    freeze = json.loads(FREEZE.read_text(encoding="utf-8"))
    require(freeze["status"] == "VALIDATION_OPENED_ONCE", "冻结状态错误")
    canonical = json.dumps(freeze["champion"], ensure_ascii=False, separators=(",", ":"))
    champion_hash = hashlib.sha256(canonical.encode()).hexdigest()
    require(champion_hash == freeze["championSha256"], "冠军哈希错误")
    print(f"FREEZE_HASH_OK sha256={champion_hash}")

    dev = [draw for draw in draws if draw["issue"] <= DEV_END]
    require(len(dev) == 191 and sum(draw["issue"] >= DEV_TARGET_START for draw in dev) == 153, "开发边界错误")
    require([sum(start <= draw["issue"] <= end for draw in dev) for _, start, end in BLOCKS] == [51, 51, 51], "开发块错误")

    candidates = create_candidates()
    ranked_bases = evaluate_bases(dev, candidates)
    ranking_ids = [result["candidate"]["id"] for result in ranked_bases]
    require(set(ranking_ids) == set(freeze["baseRankingIds"]), "131候选集合不一致")
    require(ranking_ids[:9] == freeze["baseRankingIds"][:9], "决定集成的前9名排序不一致")
    lower_differences = [(index + 1, left, right) for index, (left, right) in enumerate(zip(ranking_ids, freeze["baseRankingIds"])) if left != right]
    print(f"BASE_RANKING_TOP9_OK lower_float_order_differences={len(lower_differences)} first_difference={lower_differences[0][0] if lower_differences else 0}")
    ensembles = [evaluate_ensemble(dev, [result["candidate"] for result in ranked_bases[:size]]) for size in (3, 5, 7, 9)]
    champion = sorted(ensembles, key=stability_key)[0]
    require(champion["ensembleSize"] == 7, "独立开发冠军不是Top 7")
    expected_dev = freeze["championDevelopment"]
    require(champion["overall"] == expected_dev["overall"], "开发冠军汇总不一致")
    for block_id, _, _ in BLOCKS:
        require(champion["blocks"][block_id] == expected_dev["blocks"][block_id], f"{block_id}指标不一致")
    print("DEV_BOUNDARY_OK targets=153 blocks=51/51/51 candidates=131 champion=Top7 cover_ge3=20")

    champion_candidates = freeze["champion"]["baseStrategies"]
    stored_rows = freeze["validation"]["rows"]
    recomputed_rows = []
    summary = {**empty_metrics(), "blueAny": 0, "union": 0}
    for target in (draw for draw in draws if VALIDATION_START <= draw["issue"] <= VALIDATION_END):
        index = next(i for i, draw in enumerate(draws) if draw["issue"] == target["issue"])
        history = draws[:index]
        selected = select(ensemble_ranking(champion_candidates, history), history)
        blues = predict_blue(history)
        dan_hits, cover = record(summary, selected, target)
        blue_hits = sum(number in target["blues"] for number in blues)
        summary["blueAny"] += blue_hits >= 1
        summary["union"] += dan_hits >= 1 or blue_hits >= 1
        recomputed_rows.append({"issue": target["issue"], "state": state_of(history), "dan": selected["dan"], "drag": selected["drag"], "blues": blues,
                                "danHits": dan_hits, "cover": cover, "blueHits": blue_hits, "unionHit": int(dan_hits >= 1 or blue_hits >= 1),
                                "danRepeat": selected["danRepeat"], "allRepeat": selected["allRepeat"]})
    require(recomputed_rows == stored_rows, "38期逐行结果不一致")
    require(summary == freeze["validation"]["summary"], "38期汇总不一致")
    require(summary["coverGe3"] == 1 and freeze["validation"]["decision"] == "FAIL_KEEP_V2", "失败分支错误")
    print("VALIDATION_38_OK row_match=38/38 cover_ge3=1/38 decision=FAIL_KEEP_V2")
    print(f"REPEAT_CAP_OK max_dan_repeat={summary['maxDanRepeat']} max_all_repeat={summary['maxAllRepeat']}")

    final_selected = select(ensemble_ranking(champion_candidates, draws), draws)
    final = freeze["finalPrediction"]
    require(final_selected["dan"] == final["dan"] and final_selected["drag"] == final["drag"] and final_selected["all"] == final["all"], "失败候选2026080前区不一致")
    require(predict_blue(draws) == final["blues"], "失败候选2026080后区不一致")

    freeze_md = FREEZE_MD.read_text(encoding="utf-8")
    fail_md = FAIL_MD.read_text(encoding="utf-8")
    canonical_md = CANONICAL_MD.read_text(encoding="utf-8")
    issue_md = ISSUE_MD.read_text(encoding="utf-8")
    require("VALIDATION_OPENED_ONCE" in freeze_md and "FAIL_KEEP_V2" in fail_md, "冻结/失败文档标记缺失")
    require(sum(f"| {row['issue']} |" in fail_md for row in stored_rows) == 38, "失败报告未包含38期")
    require("当前正式方案：** **重号均衡V2" in canonical_md, "综合文档被错误晋级")
    require("红球胆码（3个）：04、25、27" in canonical_md and "红球胆码（3个）：04、25、27" in issue_md, "正式V2预测被错误替换")
    require("红球8码全集：01、04、13、20、25、26、27、32" in canonical_md, "正式V2 8红被错误替换")
    print("PROMOTION_BRANCH_OK canonical=V2 issue_report=V2 fail_report=created")
    print("INDEPENDENT_VERIFY_OK data=229 dev_targets=153 candidates=131 validation_rows=38 row_match=38/38 prediction_branch=V2")


if __name__ == "__main__":
    main()
