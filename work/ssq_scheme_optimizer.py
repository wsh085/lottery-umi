from __future__ import annotations

import json
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from statistics import mean
from typing import Callable


RED_NUMBERS = tuple(range(1, 34))
BLUE_NUMBERS = tuple(range(1, 17))
RED_RANDOM_HIT_RATE = 1.0 - math.comb(31, 6) / math.comb(33, 6)
BLUE_RANDOM_HIT_RATE = 4 / 16
BLUE_DEFAULT_BAYES_WINDOW = 30
BLUE_DEFAULT_PRIOR_STRENGTH = 4.0
BLUE_DEFAULT_ML_WEIGHT = 0.15
BLUE_DEFAULT_TEMPERATURE = 0.9
BLUE_PARAMETER_SWITCH_MARGIN = 0.09
BLUE_PARAMETER_GRID = tuple(
    (bayes_window, prior_strength, ml_weight, temperature)
    for bayes_window in (24, 30, 36)
    for prior_strength in (4.0, 6.0, 8.0)
    for ml_weight in (0.15, 0.22, 0.3)
    for temperature in (0.75, 0.9, 1.05, 1.2)
)


@dataclass(frozen=True)
class Draw:
    issue: str
    reds: tuple[int, ...]
    blue: int


class SimpleLogisticModel:
    def __init__(self) -> None:
        self.weights: list[float] = []
        self.bias = 0.0
        self.means: list[float] = []
        self.stds: list[float] = []
        self.constant_probability: float | None = None

    def fit(
        self,
        samples: list[list[float]],
        labels: list[int],
        *,
        epochs: int = 50,
        lr: float = 0.08,
        l2: float = 0.001,
    ) -> "SimpleLogisticModel":
        if not samples:
            self.constant_probability = 0.0
            return self
        positives = sum(labels)
        if positives == 0 or positives == len(labels):
            self.constant_probability = positives / max(len(labels), 1)
            return self

        dimension = len(samples[0])
        self.means = [mean(row[idx] for row in samples) for idx in range(dimension)]
        self.stds = []
        for idx in range(dimension):
            variance = mean((row[idx] - self.means[idx]) ** 2 for row in samples)
            self.stds.append(math.sqrt(variance) or 1.0)

        normalized = [self._normalize(row) for row in samples]
        self.weights = [0.0] * dimension
        self.bias = math.log(positives / (len(labels) - positives))
        positive_weight = (len(labels) - positives) / positives

        for epoch in range(epochs):
            step = lr / (1.0 + epoch * 0.03)
            for features, label in zip(normalized, labels):
                probability = self._sigmoid(
                    self.bias + sum(w * x for w, x in zip(self.weights, features))
                )
                weight = positive_weight if label == 1 else 1.0
                error = (probability - label) * weight
                self.bias -= step * error
                for idx, value in enumerate(features):
                    self.weights[idx] -= step * (error * value + l2 * self.weights[idx])
        return self

    def predict_probability(self, features: list[float]) -> float:
        if self.constant_probability is not None:
            return self.constant_probability
        normalized = self._normalize(features)
        logit = self.bias + sum(w * x for w, x in zip(self.weights, normalized))
        return self._sigmoid(logit)

    def _normalize(self, values: list[float]) -> list[float]:
        if not self.means:
            return values
        return [
            (value - self.means[idx]) / self.stds[idx]
            for idx, value in enumerate(values)
        ]

    @staticmethod
    def _sigmoid(value: float) -> float:
        if value >= 0:
            exp_value = math.exp(-value)
            return 1.0 / (1.0 + exp_value)
        exp_value = math.exp(value)
        return exp_value / (1.0 + exp_value)


class BlueSoftmaxModel:
    def __init__(self) -> None:
        self.weights: list[float] = []
        self.bias = 0.0
        self.means: list[float] = []
        self.stds: list[float] = []

    def fit(
        self,
        grouped_samples: list[list[list[float]]],
        labels: list[int],
        *,
        epochs: int = 45,
        lr: float = 0.05,
        l2: float = 0.001,
    ) -> "BlueSoftmaxModel":
        if not grouped_samples:
            return self

        dimension = len(grouped_samples[0][0])
        flattened = [features for group in grouped_samples for features in group]
        self.means = [mean(row[idx] for row in flattened) for idx in range(dimension)]
        self.stds = []
        for idx in range(dimension):
            variance = mean((row[idx] - self.means[idx]) ** 2 for row in flattened)
            self.stds.append(math.sqrt(variance) or 1.0)

        normalized_groups = [
            [self._normalize(features) for features in group] for group in grouped_samples
        ]
        self.weights = [0.0] * dimension
        self.bias = 0.0

        for epoch in range(epochs):
            step = lr / (1.0 + epoch * 0.03)
            for group, label in zip(normalized_groups, labels):
                logits = [
                    self.bias + sum(weight * value for weight, value in zip(self.weights, features))
                    for features in group
                ]
                probabilities = self._softmax(logits)
                for class_index, features in enumerate(group):
                    target = 1.0 if class_index == label else 0.0
                    error = probabilities[class_index] - target
                    self.bias -= step * error / len(group)
                    for idx, value in enumerate(features):
                        self.weights[idx] -= step * (
                            error * value / len(group) + l2 * self.weights[idx]
                        )
        return self

    def predict_probabilities(self, grouped_features: list[list[float]]) -> list[float]:
        normalized = [self._normalize(features) for features in grouped_features]
        logits = [
            self.bias + sum(weight * value for weight, value in zip(self.weights, features))
            for features in normalized
        ]
        return self._softmax(logits)

    def _normalize(self, values: list[float]) -> list[float]:
        if not self.means:
            return values
        return [
            (value - self.means[idx]) / self.stds[idx]
            for idx, value in enumerate(values)
        ]

    @staticmethod
    def _softmax(logits: list[float]) -> list[float]:
        maximum = max(logits)
        exps = [math.exp(value - maximum) for value in logits]
        total = sum(exps) or 1.0
        return [value / total for value in exps]


def load_draws(path: str | Path) -> list[Draw]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    draws: list[Draw] = []
    for item in raw:
        reds = tuple(sorted(int(value) for value in item["红球"].split()))
        blue = int(item["蓝球"])
        draws.append(Draw(issue=str(item["期数"]), reds=reds, blue=blue))
    return draws


def validate_draws(draws: list[Draw]) -> dict[str, int]:
    last_issue = ""
    for index, draw in enumerate(draws):
        if draw.issue <= last_issue:
            raise ValueError(f"期号未按升序排列: {draw.issue}")
        last_issue = draw.issue
        if len(draw.reds) != 6:
            raise ValueError(f"红球数量错误: {draw.issue}")
        if tuple(sorted(draw.reds)) != draw.reds:
            raise ValueError(f"红球未升序排列: {draw.issue}")
        if len(set(draw.reds)) != 6:
            raise ValueError(f"红球存在重复: {draw.issue}")
        if any(number < 1 or number > 33 for number in draw.reds):
            raise ValueError(f"红球范围错误: {draw.issue}")
        if draw.blue < 1 or draw.blue > 16:
            raise ValueError(f"蓝球范围错误: {draw.issue}")
        if index > 0 and draws[index - 1].issue == draw.issue:
            raise ValueError(f"期号重复: {draw.issue}")
    return {
        "draw_count": len(draws),
        "first_issue": int(draws[0].issue),
        "last_issue": int(draws[-1].issue),
    }


def red_zone(number: int) -> int:
    if number <= 11:
        return 0
    if number <= 22:
        return 1
    return 2


def blue_zone(number: int) -> int:
    if number <= 5:
        return 0
    if number <= 11:
        return 1
    return 2


def window_frequency(
    history: list[Draw],
    candidate: int,
    *,
    window: int,
    blue: bool = False,
) -> float:
    recent = history[-window:]
    if not recent:
        return 0.0
    if blue:
        count = sum(1 for draw in recent if draw.blue == candidate)
        return count / len(recent)
    count = sum(1 for draw in recent if candidate in draw.reds)
    return count / len(recent)


def omission_gap(history: list[Draw], candidate: int, *, blue: bool = False) -> int:
    for offset, draw in enumerate(reversed(history)):
        if (draw.blue == candidate) if blue else (candidate in draw.reds):
            return offset
    return len(history) + 1


def exp_gap_score(gap: int, *, target: float, scale: float) -> float:
    return math.exp(-abs(gap - target) / scale)


def red_recent_zone_bias(history: list[Draw], zone: int, window: int = 12) -> float:
    recent = history[-window:]
    if not recent:
        return 0.0
    counts = [0, 0, 0]
    for draw in recent:
        for number in draw.reds:
            counts[red_zone(number)] += 1
    average = sum(counts) / 3
    return (average - counts[zone]) / max(sum(counts), 1)


def blue_recent_zone_bias(history: list[Draw], zone: int, window: int = 12) -> float:
    recent = history[-window:]
    if not recent:
        return 0.0
    counts = [0, 0, 0]
    for draw in recent:
        counts[blue_zone(draw.blue)] += 1
    average = sum(counts) / 3
    return (average - counts[zone]) / max(sum(counts), 1)


def recent_parity_bias(
    history: list[Draw], *, candidate: int, blue: bool = False, window: int = 12
) -> float:
    recent = history[-window:]
    if not recent:
        return 0.0
    if blue:
        odd_count = sum(1 for draw in recent if draw.blue % 2 == 1)
        even_count = len(recent) - odd_count
        average = len(recent) / 2
        target_count = odd_count if candidate % 2 == 1 else even_count
        return (average - target_count) / max(len(recent), 1)
    odd_count = sum(sum(1 for number in draw.reds if number % 2 == 1) for draw in recent)
    total = len(recent) * 6
    even_count = total - odd_count
    average = total / 2
    target_count = odd_count if candidate % 2 == 1 else even_count
    return (average - target_count) / max(total, 1)


def recent_blue_values(history: list[Draw], window: int) -> list[int]:
    return [draw.blue for draw in history[-window:]]


def normalized_center_closeness(candidate: int, center: float, scale: float) -> float:
    return max(0.0, 1.0 - abs(candidate - center) / scale)


def range_neighborhood_score(candidate: int, values: list[int], *, padding: int, scale: float) -> float:
    if not values:
        return 0.0
    lower = min(values) - padding
    upper = max(values) + padding
    if lower <= candidate <= upper:
        return 1.0
    distance = min(abs(candidate - lower), abs(candidate - upper))
    return max(0.0, 1.0 - distance / scale)


def min_recent_blue_distance(history: list[Draw], candidate: int, window: int) -> float:
    values = recent_blue_values(history, window)
    if not values:
        return 1.0
    return min(abs(candidate - value) for value in values) / 15


def recent_neighbor_density(history: list[Draw], candidate: int, window: int) -> float:
    values = recent_blue_values(history, window)
    if not values:
        return 0.0
    count = sum(1 for value in values if abs(candidate - value) <= 1)
    return count / len(values)


def hot_cold_transition_score(
    history: list[Draw], candidate: int, *, short_window: int, long_window: int
) -> float:
    short_freq = window_frequency(history, candidate, window=short_window, blue=True)
    long_freq = window_frequency(history, candidate, window=long_window, blue=True)
    return short_freq - long_freq


def red_feature_vector(history: list[Draw], candidate: int) -> list[float]:
    gap = omission_gap(history, candidate)
    last_draw = history[-1] if history else None
    freq5 = window_frequency(history, candidate, window=5)
    freq10 = window_frequency(history, candidate, window=10)
    freq20 = window_frequency(history, candidate, window=20)
    freq50 = window_frequency(history, candidate, window=50)
    freq100 = window_frequency(history, candidate, window=100)
    last_neighbors = 0.0
    if last_draw:
        last_neighbors = max(0.0, 1.0 - min(abs(candidate - value) for value in last_draw.reds) / 6)
    return [
        candidate / 33,
        freq5,
        freq10,
        freq20,
        freq50,
        freq100,
        min(gap, 60) / 60,
        exp_gap_score(gap, target=6, scale=4),
        1.0 if last_draw and candidate in last_draw.reds else 0.0,
        last_neighbors,
        red_recent_zone_bias(history, red_zone(candidate)),
        recent_parity_bias(history, candidate=candidate),
    ]


def blue_feature_vector(history: list[Draw], candidate: int) -> list[float]:
    gap = omission_gap(history, candidate, blue=True)
    last_draw = history[-1] if history else None
    values6 = recent_blue_values(history, 6)
    values12 = recent_blue_values(history, 12)
    mean6 = mean(values6) if values6 else candidate
    mean12 = mean(values12) if values12 else candidate
    last_blue = last_draw.blue if last_draw else candidate
    short_long_shift = hot_cold_transition_score(
        history, candidate, short_window=6, long_window=24
    )
    medium_long_shift = hot_cold_transition_score(
        history, candidate, short_window=12, long_window=48
    )
    reactivation_score = exp_gap_score(gap, target=3, scale=2) * (
        1.0 - window_frequency(history, candidate, window=6, blue=True)
    )
    return [
        candidate / 16,
        window_frequency(history, candidate, window=3, blue=True),
        window_frequency(history, candidate, window=6, blue=True),
        window_frequency(history, candidate, window=12, blue=True),
        window_frequency(history, candidate, window=24, blue=True),
        window_frequency(history, candidate, window=48, blue=True),
        min(gap, 40) / 40,
        exp_gap_score(gap, target=6, scale=4),
        decay_score(history, candidate),
        1.0 if last_draw and candidate == last_draw.blue else 0.0,
        1.0 if last_draw and abs(candidate - last_blue) == 1 else 0.0,
        normalized_center_closeness(candidate, mean6, 8),
        normalized_center_closeness(candidate, mean12, 8),
        range_neighborhood_score(candidate, values12, padding=1, scale=6),
        1.0 - min_recent_blue_distance(history, candidate, 8),
        recent_neighbor_density(history, candidate, 8),
        short_long_shift,
        medium_long_shift,
        reactivation_score,
        blue_recent_zone_bias(history, blue_zone(candidate)),
        recent_parity_bias(history, candidate=candidate, blue=True),
    ]


def build_training_samples(
    history: list[Draw],
    *,
    blue: bool,
    lookback_targets: int = 72,
    min_history: int = 24,
) -> tuple[list[list[float]], list[int]]:
    start = max(min_history, len(history) - lookback_targets)
    samples: list[list[float]] = []
    labels: list[int] = []
    for target_idx in range(start, len(history)):
        sample_history = history[:target_idx]
        if blue:
            for number in BLUE_NUMBERS:
                samples.append(blue_feature_vector(sample_history, number))
                labels.append(1 if history[target_idx].blue == number else 0)
        else:
            actual = set(history[target_idx].reds)
            for number in RED_NUMBERS:
                samples.append(red_feature_vector(sample_history, number))
                labels.append(1 if number in actual else 0)
    return samples, labels


def build_blue_grouped_training_samples(
    history: list[Draw],
    *,
    lookback_targets: int = 72,
    min_history: int = 24,
) -> tuple[list[list[list[float]]], list[int]]:
    start = max(min_history, len(history) - lookback_targets)
    grouped_samples: list[list[list[float]]] = []
    labels: list[int] = []
    for target_idx in range(start, len(history)):
        sample_history = history[:target_idx]
        grouped_samples.append(
            [blue_feature_vector(sample_history, number) for number in BLUE_NUMBERS]
        )
        labels.append(history[target_idx].blue - 1)
    return grouped_samples, labels


def score_candidates_with_model(
    history: list[Draw], *, blue: bool
) -> dict[int, float]:
    samples, labels = build_training_samples(history, blue=blue)
    model = SimpleLogisticModel().fit(samples, labels)
    if blue:
        return {
            number: model.predict_probability(blue_feature_vector(history, number))
            for number in BLUE_NUMBERS
        }
    return {
        number: model.predict_probability(red_feature_vector(history, number))
        for number in RED_NUMBERS
    }


@lru_cache(maxsize=None)
def cached_blue_softmax_scores(signature: tuple[int, ...]) -> tuple[tuple[int, float], ...]:
    history = list(cached_blue_history(signature))
    grouped_samples, labels = build_blue_grouped_training_samples(history)
    model = BlueSoftmaxModel().fit(grouped_samples, labels)
    probabilities = model.predict_probabilities(
        [blue_feature_vector(history, number) for number in BLUE_NUMBERS]
    )
    return tuple(
        sorted(
            (number, probabilities[number - 1]) for number in BLUE_NUMBERS
        )
    )


def normalize_scores(scores: dict[int, float]) -> dict[int, float]:
    values = list(scores.values())
    minimum = min(values)
    maximum = max(values)
    if math.isclose(minimum, maximum):
        return {key: 0.0 for key in scores}
    return {key: (value - minimum) / (maximum - minimum) for key, value in scores.items()}


def sorted_numbers(scores: dict[int, float]) -> list[int]:
    return sorted(scores, key=lambda key: (-scores[key], key))


def select_with_zone_coverage(scores: dict[int, float], count: int) -> list[int]:
    ordered = sorted_numbers(scores)
    chosen: list[int] = []
    covered: set[int] = set()
    for number in ordered:
        zone = blue_zone(number)
        if zone not in covered:
            chosen.append(number)
            covered.add(zone)
        if len(chosen) == min(count, 3):
            break
    for number in ordered:
        if number not in chosen:
            chosen.append(number)
        if len(chosen) == count:
            break
    return sorted(chosen)


def red_base_scores(history: list[Draw]) -> tuple[dict[int, float], dict[int, float], dict[int, float]]:
    hot: dict[int, float] = {}
    gap_map: dict[int, float] = {}
    mix: dict[int, float] = {}
    for number in RED_NUMBERS:
        hot[number] = (
            1.0 * window_frequency(history, number, window=5)
            + 0.7 * window_frequency(history, number, window=10)
            + 0.4 * window_frequency(history, number, window=20)
            + 0.2 * window_frequency(history, number, window=50)
        )
        gap = omission_gap(history, number)
        gap_map[number] = exp_gap_score(gap, target=6, scale=4) + 0.2 * window_frequency(
            history, number, window=50
        )
        mix[number] = 0.6 * hot[number] + 0.4 * gap_map[number]
    return hot, gap_map, mix


def red_strategy_hot(history: list[Draw]) -> list[int]:
    hot, _, _ = red_base_scores(history)
    return sorted(sorted_numbers(hot)[:2])


def red_strategy_gap(history: list[Draw]) -> list[int]:
    _, gap_map, _ = red_base_scores(history)
    return sorted(sorted_numbers(gap_map)[:2])


def red_strategy_mix(history: list[Draw]) -> list[int]:
    _, _, mix = red_base_scores(history)
    return sorted(sorted_numbers(mix)[:2])


def red_strategy_repeat(history: list[Draw]) -> list[int]:
    last = history[-1]
    hot, _, _ = red_base_scores(history)
    scores = {
        number: hot[number] + (1.2 if number in last.reds else 0.0) - 0.01 * omission_gap(history, number)
        for number in RED_NUMBERS
    }
    return sorted(sorted_numbers(scores)[:2])


def red_strategy_zone(history: list[Draw]) -> list[int]:
    hot, gap_map, _ = red_base_scores(history)
    scores = {
        number: 0.5 * hot[number]
        + 0.3 * gap_map[number]
        + 1.2 * red_recent_zone_bias(history, red_zone(number))
        for number in RED_NUMBERS
    }
    return sorted(sorted_numbers(scores)[:2])


def red_strategy_structure(history: list[Draw]) -> list[int]:
    hot, gap_map, _ = red_base_scores(history)
    center_bonus = {number: 1.0 - abs(number - 17) / 16 for number in RED_NUMBERS}
    scores = {
        number: 0.45 * hot[number]
        + 0.25 * gap_map[number]
        + 0.9 * red_recent_zone_bias(history, red_zone(number))
        + 0.7 * recent_parity_bias(history, candidate=number)
        + 0.2 * center_bonus[number]
        for number in RED_NUMBERS
    }
    return sorted(sorted_numbers(scores)[:2])


RED_STRATEGIES: dict[str, Callable[[list[Draw]], list[int]]] = {
    "近期热号": red_strategy_hot,
    "适中遗漏": red_strategy_gap,
    "冷热混合": red_strategy_mix,
    "重号延续": red_strategy_repeat,
    "分区回补": red_strategy_zone,
    "结构均衡": red_strategy_structure,
}


def decay_score(history: list[Draw], candidate: int) -> float:
    total = 0.0
    for age, draw in enumerate(reversed(history)):
        if draw.blue == candidate:
            total += 0.88**age
    return total


def blue_hot_scores(history: list[Draw]) -> dict[int, float]:
    return {
        number: (
            1.0 * window_frequency(history, number, window=5, blue=True)
            + 0.7 * window_frequency(history, number, window=12, blue=True)
            + 0.3 * window_frequency(history, number, window=30, blue=True)
        )
        for number in BLUE_NUMBERS
    }


def blue_gap_scores(history: list[Draw]) -> dict[int, float]:
    return {
        number: exp_gap_score(omission_gap(history, number, blue=True), target=6, scale=4)
        + 0.25 * window_frequency(history, number, window=30, blue=True)
        for number in BLUE_NUMBERS
    }


def blue_prior(history: list[Draw], candidate: int) -> float:
    count = sum(1 for draw in history if draw.blue == candidate)
    return (count + 1) / (len(history) + 16)


def safe_probability(value: float, epsilon: float = 1e-6) -> float:
    return min(max(value, epsilon), 1.0 - epsilon)


def safe_logit(value: float) -> float:
    clipped = safe_probability(value)
    return math.log(clipped / (1.0 - clipped))


def softmax_probabilities(scores: dict[int, float], temperature: float) -> dict[int, float]:
    adjusted = {number: value / temperature for number, value in scores.items()}
    maximum = max(adjusted.values())
    exps = {number: math.exp(value - maximum) for number, value in adjusted.items()}
    total = sum(exps.values()) or 1.0
    return {number: exps[number] / total for number in scores}


def history_blue_signature(history: list[Draw]) -> tuple[int, ...]:
    return tuple(draw.blue for draw in history)


@lru_cache(maxsize=None)
def cached_blue_history(signature: tuple[int, ...]) -> tuple[Draw, ...]:
    return tuple(
        Draw(issue=f"B{index:04d}", reds=tuple(), blue=blue)
        for index, blue in enumerate(signature, start=1)
    )


@lru_cache(maxsize=None)
def cached_blue_ml_scores(signature: tuple[int, ...]) -> tuple[tuple[int, float], ...]:
    return cached_blue_softmax_scores(signature)


@lru_cache(maxsize=None)
def cached_blue_legacy_bundle(
    signature: tuple[int, ...]
) -> tuple[tuple[tuple[int, float], ...], tuple[tuple[str, float], ...]]:
    history = list(cached_blue_history(signature))
    scores, ranking = blue_legacy_scores(history)
    return tuple(sorted(scores.items())), tuple(ranking)


@lru_cache(maxsize=None)
def cached_blue_bayes_scores(
    signature: tuple[int, ...],
    recent_window: int,
    prior_strength: float,
) -> tuple[tuple[int, float], ...]:
    history = list(cached_blue_history(signature))
    recent = history[-recent_window:]
    scores = {}
    for number in BLUE_NUMBERS:
        count_recent = sum(1 for draw in recent if draw.blue == number)
        prior = blue_prior(history, number)
        scores[number] = (count_recent + prior_strength * prior) / (
            len(recent) + prior_strength
        )
    return tuple(sorted(scores.items()))


def blue_strategy_hot(history: list[Draw]) -> list[int]:
    return sorted(sorted_numbers(blue_hot_scores(history))[:4])


def blue_strategy_decay(history: list[Draw]) -> list[int]:
    scores = {number: decay_score(history, number) for number in BLUE_NUMBERS}
    return sorted(sorted_numbers(scores)[:4])


def blue_strategy_gap(history: list[Draw]) -> list[int]:
    return sorted(sorted_numbers(blue_gap_scores(history))[:4])


def blue_strategy_bayes(history: list[Draw]) -> list[int]:
    scores = {}
    recent = history[-30:]
    for number in BLUE_NUMBERS:
        count30 = sum(1 for draw in recent if draw.blue == number)
        scores[number] = (count30 + 6 * blue_prior(history, number)) / (len(recent) + 6)
    return sorted(sorted_numbers(scores)[:4])


def blue_strategy_zone(history: list[Draw]) -> list[int]:
    scores = {}
    for number in BLUE_NUMBERS:
        scores[number] = (
            0.8 * window_frequency(history, number, window=12, blue=True)
            + 0.4 * window_frequency(history, number, window=30, blue=True)
            + 0.35 * exp_gap_score(omission_gap(history, number, blue=True), target=6, scale=4)
            + 0.8 * blue_recent_zone_bias(history, blue_zone(number))
        )
    return select_with_zone_coverage(scores, 4)


def blue_strategy_mix(history: list[Draw]) -> list[int]:
    hot_scores = blue_hot_scores(history)
    gap_scores = blue_gap_scores(history)
    mix = {number: 0.6 * hot_scores[number] + 0.4 * gap_scores[number] for number in BLUE_NUMBERS}
    return sorted(sorted_numbers(mix)[:4])


BLUE_STRATEGIES: dict[str, Callable[[list[Draw]], list[int]]] = {
    "近期热度": blue_strategy_hot,
    "时间衰减": blue_strategy_decay,
    "适中遗漏": blue_strategy_gap,
    "贝叶斯平滑": blue_strategy_bayes,
    "三区平衡": blue_strategy_zone,
    "冷热混合": blue_strategy_mix,
}


def evaluate_red_strategy(history: list[Draw], strategy: Callable[[list[Draw]], list[int]]) -> float:
    rates = []
    for window in (12, 24):
        start = max(24, len(history) - window)
        hits = 0
        total = 0
        for target_idx in range(start, len(history)):
            sample_history = history[:target_idx]
            if len(sample_history) < 24:
                continue
            predicted = set(strategy(sample_history))
            if predicted & set(history[target_idx].reds):
                hits += 1
            total += 1
        rates.append(hits / total if total else 0.0)
    return 0.7 * rates[0] + 0.3 * rates[1]


def evaluate_blue_strategy(history: list[Draw], strategy: Callable[[list[Draw]], list[int]]) -> float:
    rates = []
    for window in (12, 24):
        start = max(24, len(history) - window)
        hits = 0
        total = 0
        for target_idx in range(start, len(history)):
            sample_history = history[:target_idx]
            if len(sample_history) < 24:
                continue
            predicted = strategy(sample_history)
            if history[target_idx].blue in predicted:
                hits += 1
            total += 1
        rates.append(hits / total if total else 0.0)
    return 0.7 * rates[0] + 0.3 * rates[1]


def red_legacy_scores(history: list[Draw]) -> tuple[dict[int, float], list[tuple[str, float]]]:
    ranking = sorted(
        ((name, evaluate_red_strategy(history, strategy)) for name, strategy in RED_STRATEGIES.items()),
        key=lambda item: (-item[1], item[0]),
    )
    weights = [3, 2, 1]
    votes = {number: 0.0 for number in RED_NUMBERS}
    for weight, (name, _) in zip(weights, ranking[:3]):
        for number in RED_STRATEGIES[name](history):
            votes[number] += weight
    return votes, ranking


def blue_legacy_scores(history: list[Draw]) -> tuple[dict[int, float], list[tuple[str, float]]]:
    ranking = sorted(
        ((name, evaluate_blue_strategy(history, strategy)) for name, strategy in BLUE_STRATEGIES.items()),
        key=lambda item: (-item[1], item[0]),
    )
    weights = [3, 2, 1]
    votes = {number: 0.0 for number in BLUE_NUMBERS}
    for weight, (name, _) in zip(weights, ranking[:3]):
        for number in BLUE_STRATEGIES[name](history):
            votes[number] += weight
    return votes, ranking


def blue_bayes_posterior_scores(
    history: list[Draw],
    *,
    recent_window: int = BLUE_DEFAULT_BAYES_WINDOW,
    prior_strength: float = BLUE_DEFAULT_PRIOR_STRENGTH,
) -> dict[int, float]:
    signature = history_blue_signature(history)
    return dict(cached_blue_bayes_scores(signature, recent_window, prior_strength))


def blue_multiclass_probabilities(
    history: list[Draw],
    *,
    recent_window: int,
    prior_strength: float,
    ml_weight: float,
    temperature: float = BLUE_DEFAULT_TEMPERATURE,
) -> dict[str, object]:
    signature = history_blue_signature(history)
    ml_scores = dict(cached_blue_ml_scores(signature))
    legacy_items, ranking = cached_blue_legacy_bundle(signature)
    legacy_scores = dict(legacy_items)
    bayes_scores = dict(cached_blue_bayes_scores(signature, recent_window, prior_strength))

    legacy_weight = 0.08
    bayes_weight = max(0.0, 1.0 - ml_weight - legacy_weight)
    ml_norm = normalize_scores(ml_scores)
    bayes_norm = normalize_scores(bayes_scores)
    legacy_norm = normalize_scores(legacy_scores)
    calibrated_scores = {}

    for number in BLUE_NUMBERS:
        zone_bonus = 0.03 * blue_recent_zone_bias(history, blue_zone(number))
        calibrated_scores[number] = (
            bayes_weight * bayes_norm[number]
            + ml_weight * ml_norm[number]
            + legacy_weight * legacy_norm[number]
            + zone_bonus
        )

    multiclass_probabilities = softmax_probabilities(calibrated_scores, temperature)
    picks = sorted(
        sorted(multiclass_probabilities, key=lambda number: (-multiclass_probabilities[number], number))[:4]
    )
    return {
        "numbers": picks,
        "ml_scores": ml_scores,
        "bayes_scores": bayes_scores,
        "legacy_scores": legacy_scores,
        "strategy_ranking": list(ranking),
        "calibrated_logits": calibrated_scores,
        "multiclass_probabilities": multiclass_probabilities,
        "selected_params": {
            "recent_window": recent_window,
            "prior_strength": prior_strength,
            "ml_weight": ml_weight,
            "temperature": temperature,
            "bayes_weight": bayes_weight,
            "legacy_weight": legacy_weight,
        },
    }


def evaluate_blue_parameter_set(
    history: list[Draw],
    *,
    recent_window: int,
    prior_strength: float,
    ml_weight: float,
    temperature: float,
) -> float:
    signature = history_blue_signature(history)
    return cached_evaluate_blue_parameter_set(
        signature, recent_window, prior_strength, ml_weight, temperature
    )


def blue_parameter_window_rate(
    history: list[Draw],
    *,
    recent_window: int,
    prior_strength: float,
    ml_weight: float,
    temperature: float,
    evaluation_window: int,
) -> float:
    signature = history_blue_signature(history)
    return cached_blue_parameter_window_rate(
        signature,
        recent_window,
        prior_strength,
        ml_weight,
        temperature,
        evaluation_window,
    )


@lru_cache(maxsize=None)
def cached_blue_parameter_window_rate(
    signature: tuple[int, ...],
    recent_window: int,
    prior_strength: float,
    ml_weight: float,
    temperature: float,
    evaluation_window: int,
) -> float:
    history = list(cached_blue_history(signature))
    start = max(24, len(history) - evaluation_window)
    hits = 0
    total = 0
    for target_idx in range(start, len(history)):
        sample_history = history[:target_idx]
        if len(sample_history) < 24:
            continue
        prediction = blue_multiclass_probabilities(
            sample_history,
            recent_window=recent_window,
            prior_strength=prior_strength,
            ml_weight=ml_weight,
            temperature=temperature,
        )["numbers"]
        if history[target_idx].blue in prediction:
            hits += 1
        total += 1
    return hits / total if total else 0.0


@lru_cache(maxsize=None)
def cached_evaluate_blue_parameter_set(
    signature: tuple[int, ...],
    recent_window: int,
    prior_strength: float,
    ml_weight: float,
    temperature: float,
) -> float:
    # 用时间切片交叉验证评估参数，而不是只看单一回看窗口。
    slice_plan = ((12, 0.45), (24, 0.35), (36, 0.20))
    score = 0.0
    for evaluation_window, weight in slice_plan:
        score += weight * cached_blue_parameter_window_rate(
            signature,
            recent_window,
            prior_strength,
            ml_weight,
            temperature,
            evaluation_window,
        )
    return score


def search_blue_parameters(history: list[Draw]) -> dict[str, float]:
    if len(history) < 36:
        return {
            "recent_window": BLUE_DEFAULT_BAYES_WINDOW,
            "prior_strength": BLUE_DEFAULT_PRIOR_STRENGTH,
            "ml_weight": BLUE_DEFAULT_ML_WEIGHT,
            "temperature": BLUE_DEFAULT_TEMPERATURE,
        }

    default_rates = {
        window: blue_parameter_window_rate(
            history,
            recent_window=BLUE_DEFAULT_BAYES_WINDOW,
            prior_strength=BLUE_DEFAULT_PRIOR_STRENGTH,
            ml_weight=BLUE_DEFAULT_ML_WEIGHT,
            temperature=BLUE_DEFAULT_TEMPERATURE,
            evaluation_window=window,
        )
        for window in (12, 24, 36)
    }
    best_params = (
        BLUE_DEFAULT_BAYES_WINDOW,
        BLUE_DEFAULT_PRIOR_STRENGTH,
        BLUE_DEFAULT_ML_WEIGHT,
        BLUE_DEFAULT_TEMPERATURE,
    )
    best_gain = 0.0
    default_cv_score = evaluate_blue_parameter_set(
        history,
        recent_window=BLUE_DEFAULT_BAYES_WINDOW,
        prior_strength=BLUE_DEFAULT_PRIOR_STRENGTH,
        ml_weight=BLUE_DEFAULT_ML_WEIGHT,
        temperature=BLUE_DEFAULT_TEMPERATURE,
    )
    for recent_window, prior_strength, ml_weight, temperature in BLUE_PARAMETER_GRID:
        if (
            recent_window == BLUE_DEFAULT_BAYES_WINDOW
            and prior_strength == BLUE_DEFAULT_PRIOR_STRENGTH
            and ml_weight == BLUE_DEFAULT_ML_WEIGHT
            and temperature == BLUE_DEFAULT_TEMPERATURE
        ):
            continue
        score = evaluate_blue_parameter_set(
            history,
            recent_window=recent_window,
            prior_strength=prior_strength,
            ml_weight=ml_weight,
            temperature=temperature,
        )
        if score < default_cv_score:
            continue
        candidate_rates = {
            window: blue_parameter_window_rate(
                history,
                recent_window=recent_window,
                prior_strength=prior_strength,
                ml_weight=ml_weight,
                temperature=temperature,
                evaluation_window=window,
            )
            for window in (12, 24, 36)
        }
        if not all(
            candidate_rates[window] >= default_rates[window] + BLUE_PARAMETER_SWITCH_MARGIN
            for window in (12, 24, 36)
        ):
            continue
        gain = sum(candidate_rates[window] - default_rates[window] for window in (12, 24, 36))
        if gain > best_gain:
            best_gain = gain
            best_params = (recent_window, prior_strength, ml_weight, temperature)

    return {
        "recent_window": best_params[0],
        "prior_strength": best_params[1],
        "ml_weight": best_params[2],
        "temperature": best_params[3],
    }


@lru_cache(maxsize=None)
def cached_search_blue_parameters(signature: tuple[int, ...]) -> tuple[int, float, float, float]:
    history = list(cached_blue_history(signature))
    params = search_blue_parameters(history)
    return (
        int(params["recent_window"]),
        float(params["prior_strength"]),
        float(params["ml_weight"]),
        float(params["temperature"]),
    )


def predict_red_fusion(history: list[Draw]) -> dict[str, object]:
    ml_scores = score_candidates_with_model(history, blue=False)
    legacy_scores, ranking = red_legacy_scores(history)
    ml_norm = normalize_scores(ml_scores)
    legacy_norm = normalize_scores(legacy_scores)
    final_scores = {}
    for number in RED_NUMBERS:
        final_scores[number] = 0.65 * ml_norm[number] + 0.35 * legacy_norm[number]
    picks = sorted(sorted_numbers(final_scores)[:2])
    return {
        "numbers": picks,
        "ml_scores": ml_scores,
        "legacy_scores": legacy_scores,
        "strategy_ranking": ranking,
        "final_scores": final_scores,
    }


def predict_blue_fusion(history: list[Draw]) -> dict[str, object]:
    signature = history_blue_signature(history)
    recent_window, prior_strength, ml_weight, temperature = cached_search_blue_parameters(signature)
    result = blue_multiclass_probabilities(
        history,
        recent_window=recent_window,
        prior_strength=prior_strength,
        ml_weight=ml_weight,
        temperature=temperature,
    )
    return {
        **result,
        "model_name": "blue_multiclass_calibrated_auto_tuned",
        "final_scores": result["multiclass_probabilities"],
    }


def wilson_interval(hits: int, total: int, z: float = 1.96) -> tuple[float, float]:
    if total == 0:
        return (0.0, 0.0)
    phat = hits / total
    denominator = 1 + z * z / total
    center = (phat + z * z / (2 * total)) / denominator
    margin = (
        z
        * math.sqrt((phat * (1 - phat) + z * z / (4 * total)) / total)
        / denominator
    )
    return (center - margin, center + margin)


def backtest_red(draws: list[Draw], *, window: int) -> dict[str, object]:
    start = len(draws) - window
    rows = []
    hits = 0
    for target_idx in range(start, len(draws)):
        history = draws[:target_idx]
        prediction = predict_red_fusion(history)
        actual = set(draws[target_idx].reds)
        hit_numbers = sorted(actual & set(prediction["numbers"]))
        hit = bool(hit_numbers)
        hits += int(hit)
        rows.append(
            {
                "issue": draws[target_idx].issue,
                "prediction": prediction["numbers"],
                "actual": list(draws[target_idx].reds),
                "hit_numbers": hit_numbers,
                "hit": hit,
            }
        )
    low, high = wilson_interval(hits, window)
    return {
        "window": window,
        "hits": hits,
        "total": window,
        "hit_rate": hits / window,
        "baseline": RED_RANDOM_HIT_RATE,
        "wilson_low": low,
        "wilson_high": high,
        "rows": rows,
    }


def backtest_blue(draws: list[Draw], *, window: int) -> dict[str, object]:
    start = len(draws) - window
    rows = []
    hits = 0
    for target_idx in range(start, len(draws)):
        history = draws[:target_idx]
        prediction = predict_blue_fusion(history)
        hit = draws[target_idx].blue in prediction["numbers"]
        hits += int(hit)
        rows.append(
            {
                "issue": draws[target_idx].issue,
                "prediction": prediction["numbers"],
                "actual": draws[target_idx].blue,
                "hit": hit,
            }
        )
    low, high = wilson_interval(hits, window)
    return {
        "window": window,
        "hits": hits,
        "total": window,
        "hit_rate": hits / window,
        "baseline": BLUE_RANDOM_HIT_RATE,
        "wilson_low": low,
        "wilson_high": high,
        "rows": rows,
    }


def run_full_analysis(data_path: str | Path) -> dict[str, object]:
    draws = load_draws(data_path)
    summary = validate_draws(draws)
    red_prediction = predict_red_fusion(draws)
    blue_prediction = predict_blue_fusion(draws)
    return {
        "data_summary": summary,
        "next_issue": str(int(draws[-1].issue) + 1),
        "red": {
            "prediction": red_prediction["numbers"],
            "strategy_ranking": red_prediction["strategy_ranking"],
            "windows": {
                "20": backtest_red(draws, window=20),
                "38": backtest_red(draws, window=38),
                "60": backtest_red(draws, window=60),
            },
        },
        "blue": {
            "prediction": blue_prediction["numbers"],
            "strategy_ranking": blue_prediction["strategy_ranking"],
            "windows": {
                "20": backtest_blue(draws, window=20),
                "38": backtest_blue(draws, window=38),
                "60": backtest_blue(draws, window=60),
            },
        },
    }


def main() -> None:
    base = Path("/Users/pupu/wsh_github/lottery-umi")
    data_path = base / "dSsq" / "all_history_data.json"
    result = run_full_analysis(data_path)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
