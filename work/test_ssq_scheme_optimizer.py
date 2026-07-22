import json
import re
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
    build_analysis_metadata,
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
GUIDE_PATH = Path("/Users/pupu/wsh_github/lottery-umi/docs/ssq/双色球最新预测与复用指南.md")


class TestSsqSchemeOptimizer(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.draws = load_draws(DATA_PATH)

    def test_validate_draws(self) -> None:
        summary = validate_draws(self.draws)
        self.assertEqual(summary["draw_count"], 204)
        self.assertEqual(summary["first_issue"], 2025030)
        self.assertEqual(summary["last_issue"], 2026082)

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

    def test_parameter_freeze_follows_latest_data(self) -> None:
        metadata = build_analysis_metadata(self.draws)
        latest_issue = self.draws[-1].issue
        following_issue = next_issue_id(latest_issue)

        self.assertEqual(metadata["parameter_freeze_issue"], latest_issue)
        self.assertEqual(
            metadata["evidence_status"],
            f"当前模型版本冻结于{latest_issue}；{following_issue}及以后新增开奖才构成前向审计",
        )

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

    def test_latest_completed_forward_audit_before_refreeze(self) -> None:
        # 2026082 的预测必须只来自前203期；本次重算后再把模型版本冻结于2026082。
        history = self.draws[:-1]
        actual = self.draws[-1]
        prediction = predict_at(history, len(history))

        self.assertEqual(actual.issue, "2026082")
        self.assertEqual(prediction["red_champion"]["numbers"], [24, 27])
        self.assertEqual(prediction["red_challenger"]["numbers"], [24, 33])
        self.assertEqual(prediction["blue"]["numbers"], [1, 2, 4, 7])
        self.assertFalse(set(prediction["red_champion"]["numbers"]) & set(actual.reds))
        self.assertFalse(set(prediction["red_challenger"]["numbers"]) & set(actual.reds))
        self.assertIn(actual.blue, prediction["blue"]["numbers"])

    def test_reuse_guide_matches_current_snapshot(self) -> None:
        # 复用指南必须和当前数据快照、预测号码及38期逐期明细保持同步。
        guide = GUIDE_PATH.read_text(encoding="utf-8")
        self.assertIn("当前数据：2025030—2026082，共204期", guide)
        self.assertIn(
            "ddaba886f97e6091279025b8225964918f9368d4a75705f5f49be09b0b3dc4f5",
            guide,
        )
        self.assertIn("当前预测目标：2026083期", guide)
        self.assertIn("| 红球主模型 | `14、27` |", guide)
        self.assertIn("| 红球候选模型 | `11、24` |", guide)
        self.assertIn("| 蓝球四码模型 | `01、02、04、08` |", guide)
        paired_rows = re.findall(r"^\| 2026\d{3} \|", guide, flags=re.MULTILINE)
        self.assertEqual(len(paired_rows), 38)

    def test_analysis_windows_are_consistent(self) -> None:
        result = run_full_analysis(DATA_PATH)
        self.assertEqual(result["data_summary"]["draw_count"], len(self.draws))
        self.assertEqual(
            result["data_summary"]["sha256"],
            "ddaba886f97e6091279025b8225964918f9368d4a75705f5f49be09b0b3dc4f5",
        )
        self.assertEqual(result["next_issue"], "2026083")
        self.assertEqual(result["metadata"]["parameter_freeze_issue"], "2026082")
        self.assertEqual(result["red"]["prediction"], [14, 27])
        self.assertEqual(result["red"]["champion"]["prediction"], [14, 27])
        self.assertEqual(result["red"]["challenger"]["prediction"], [11, 24])
        self.assertEqual(result["red"]["champion"]["windows"]["38"]["hits"], 17)
        self.assertEqual(result["red"]["challenger"]["windows"]["38"]["hits"], 15)
        self.assertEqual(
            result["red"]["paired_comparison_38"],
            {
                "both": 12,
                "champion_only": 5,
                "challenger_only": 3,
                "neither": 18,
                "mcnemar_exact_two_sided": 0.7265625,
            },
        )
        self.assertEqual(result["blue"]["prediction"], [1, 2, 4, 8])
        self.assertEqual(result["blue"]["windows"]["38"]["hits"], 15)
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
