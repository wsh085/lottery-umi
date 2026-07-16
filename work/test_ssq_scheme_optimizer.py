import json
import sys
import unittest
from pathlib import Path

# 固定将测试文件所在目录加入模块搜索路径，确保从项目根目录或 work 目录启动都能导入主脚本。
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ssq_scheme_optimizer import (
    BLUE_DEFAULT_TEMPERATURE,
    BLUE_NUMBERS,
    BLUE_PARAMETER_GRID,
    Draw,
    RED_NUMBERS,
    blue_multiclass_probabilities,
    blue_zone,
    load_draws,
    localize_output,
    next_issue_id,
    predict_at,
    predict_blue_fusion,
    predict_red_fusion,
    run_full_analysis,
    validate_draws,
)


DATA_PATH = Path("/Users/pupu/wsh_github/lottery-umi/dSsq/all_history_data.json")


class TestSsqSchemeOptimizer(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.draws = load_draws(DATA_PATH)

    def test_validate_draws(self) -> None:
        summary = validate_draws(self.draws)
        self.assertEqual(summary["draw_count"], 202)
        self.assertEqual(summary["first_issue"], 2025030)
        self.assertEqual(summary["last_issue"], 2026080)

        with self.assertRaisesRegex(ValueError, "红球未升序排列"):
            validate_draws([Draw(issue="2026001", reds=(2, 1, 3, 4, 5, 6), blue=1)])

    def test_red_prediction_constraints(self) -> None:
        prediction = predict_red_fusion(self.draws[:-1])["numbers"]
        self.assertEqual(len(prediction), 2)
        self.assertEqual(len(set(prediction)), 2)
        self.assertTrue(all(number in RED_NUMBERS for number in prediction))

    def test_blue_prediction_constraints(self) -> None:
        result = predict_blue_fusion(self.draws[:-1])
        prediction = result["numbers"]
        self.assertEqual(len(prediction), 4)
        self.assertEqual(len(set(prediction)), 4)
        self.assertTrue(all(number in BLUE_NUMBERS for number in prediction))
        self.assertGreaterEqual(len({blue_zone(number) for number in prediction}), 2)
        self.assertEqual(result["model_name"], "blue_multiclass_softmax_normalized_auto_tuned")
        self.assertEqual(result["probability_status"], "softmax_normalized_not_calibrated")
        self.assertEqual(len(result["bayes_scores"]), 16)
        self.assertAlmostEqual(sum(result["multiclass_probabilities"].values()), 1.0, places=9)
        selected = result["selected_params"]
        self.assertIn(
            (
                selected["recent_window"],
                selected["prior_strength"],
                selected["ml_weight"],
            ),
            BLUE_PARAMETER_GRID,
        )
        self.assertEqual(selected["temperature"], BLUE_DEFAULT_TEMPERATURE)

    def test_no_lookahead_leakage(self) -> None:
        target_idx = len(self.draws) - 10
        before = predict_at(self.draws, target_idx)

        mutated = list(self.draws)
        for idx in range(target_idx, len(mutated)):
            issue = mutated[idx].issue
            mutated[idx] = type(mutated[idx])(
                issue=issue,
                reds=(1, 2, 3, 4, 5, 6),
                blue=16,
            )

        self.assertEqual(before, predict_at(mutated, target_idx))

    def test_temperature_changes_distribution_but_not_top_four_order(self) -> None:
        history = self.draws[:80]
        cold = blue_multiclass_probabilities(
            history,
            recent_window=30,
            prior_strength=4.0,
            ml_weight=0.15,
            temperature=0.75,
        )
        warm = blue_multiclass_probabilities(
            history,
            recent_window=30,
            prior_strength=4.0,
            ml_weight=0.15,
            temperature=1.2,
        )

        self.assertEqual(cold["numbers"], warm["numbers"])
        self.assertNotEqual(cold["multiclass_probabilities"], warm["multiclass_probabilities"])

    def test_next_issue_supports_explicit_year_rollover(self) -> None:
        self.assertEqual(next_issue_id("2026079"), "2026080")
        self.assertEqual(next_issue_id("2025151", year_last_issue=151), "2026001")

    def test_user_facing_output_uses_chinese_labels(self) -> None:
        localized = localize_output(
            {
                "red": {
                    "model_status": "rule_champion_active; logistic_fusion_challenger_not_promoted",
                    "champion": {"model_name": "strict_rule_adaptive_champion"},
                    "challenger": {"model_name": "logistic_rule_fusion_challenger"},
                },
                "blue": {
                    "model_name": "blue_multiclass_softmax_normalized_auto_tuned",
                    "probability_status": "softmax_normalized_not_calibrated",
                },
            }
        )

        self.assertEqual(localized["红球"]["主模型"]["模型名称"], "严格规则自适应主模型")
        self.assertEqual(localized["红球"]["候选模型"]["模型名称"], "逻辑回归规则融合候选模型")
        self.assertEqual(localized["红球"]["模型状态"], "规则自适应主模型启用；逻辑回归融合候选模型未晋级")
        self.assertEqual(localized["蓝球"]["概率状态"], "指数归一化分数，未经概率校准")

        rendered = json.dumps(localized, ensure_ascii=False)
        for english_label in ("champion", "challenger", "softmax", "calibrated", "model_name"):
            self.assertNotIn(english_label, rendered)

    def test_first_frozen_forward_audit(self) -> None:
        # 2026080 是参数冻结于 2026079 后的首个真实前向审计点，预测必须来自前201期。
        history = self.draws[:-1]
        actual = self.draws[-1]
        prediction = predict_at(history, len(history))

        self.assertEqual(actual.issue, "2026080")
        self.assertEqual(prediction["red_champion"]["numbers"], [1, 24])
        self.assertEqual(prediction["red_challenger"]["numbers"], [9, 24])
        self.assertEqual(prediction["blue"]["numbers"], [1, 2, 4, 8])
        self.assertFalse(set(prediction["red_champion"]["numbers"]) & set(actual.reds))
        self.assertFalse(set(prediction["red_challenger"]["numbers"]) & set(actual.reds))
        self.assertIn(actual.blue, prediction["blue"]["numbers"])

    def test_analysis_windows_are_consistent(self) -> None:
        result = run_full_analysis(DATA_PATH)
        self.assertEqual(result["data_summary"]["draw_count"], len(self.draws))
        self.assertEqual(
            result["data_summary"]["sha256"],
            "2a216a63e38da9dbac343a96ff5804684f4ef569934c19b902ec3285d5226dd8",
        )
        self.assertEqual(result["next_issue"], "2026081")
        self.assertEqual(result["red"]["prediction"], [11, 19])
        self.assertEqual(result["red"]["champion"]["prediction"], [11, 19])
        self.assertEqual(result["red"]["challenger"]["prediction"], [11, 23])
        self.assertEqual(result["red"]["champion"]["windows"]["38"]["hits"], 19)
        self.assertEqual(result["red"]["challenger"]["windows"]["38"]["hits"], 15)
        self.assertEqual(
            result["red"]["paired_comparison_38"],
            {
                "both": 12,
                "champion_only": 7,
                "challenger_only": 3,
                "neither": 16,
                "mcnemar_exact_two_sided": 0.34375,
            },
        )
        self.assertEqual(result["blue"]["prediction"], [1, 2, 4, 8])
        self.assertEqual(result["blue"]["windows"]["38"]["hits"], 14)
        self.assertEqual(result["blue"]["probability_status"], "softmax_normalized_not_calibrated")
        self.assertEqual(result["metadata"]["ml_training_target_lookback"], 72)
        self.assertEqual(result["metadata"]["blue_parameter_grid_size"], 27)

        for model in (result["red"]["champion"], result["red"]["challenger"], result["blue"]):
            for window in ("20", "38", "60"):
                metrics = model["windows"][window]
                self.assertEqual(metrics["total"], int(window))
                self.assertEqual(len(metrics["rows"]), int(window))
                self.assertGreaterEqual(metrics["hit_rate"], 0.0)
                self.assertLessEqual(metrics["hit_rate"], 1.0)
                self.assertGreaterEqual(metrics["random_upper_tail_probability"], 0.0)
                self.assertLessEqual(metrics["random_upper_tail_probability"], 1.0)


if __name__ == "__main__":
    unittest.main()
