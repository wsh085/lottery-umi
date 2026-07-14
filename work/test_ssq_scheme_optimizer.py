import unittest
from pathlib import Path

from ssq_scheme_optimizer import (
    BLUE_NUMBERS,
    BLUE_PARAMETER_GRID,
    RED_NUMBERS,
    blue_zone,
    load_draws,
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
        self.assertEqual(summary["draw_count"], len(self.draws))
        self.assertLess(summary["first_issue"], summary["last_issue"])

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
        self.assertEqual(result["model_name"], "blue_multiclass_calibrated_auto_tuned")
        self.assertEqual(len(result["bayes_scores"]), 16)
        self.assertAlmostEqual(sum(result["multiclass_probabilities"].values()), 1.0, places=9)
        selected = result["selected_params"]
        self.assertIn(
            (
                selected["recent_window"],
                selected["prior_strength"],
                selected["ml_weight"],
                selected["temperature"],
            ),
            BLUE_PARAMETER_GRID,
        )

    def test_no_lookahead_leakage(self) -> None:
        target_idx = len(self.draws) - 10
        base_history = self.draws[:target_idx]
        red_before = predict_red_fusion(base_history)["numbers"]
        blue_before = predict_blue_fusion(base_history)["numbers"]

        mutated = list(self.draws)
        for idx in range(target_idx + 1, len(mutated)):
            issue = mutated[idx].issue
            mutated[idx] = type(mutated[idx])(
                issue=issue,
                reds=(1, 2, 3, 4, 5, 6),
                blue=16,
            )

        red_after = predict_red_fusion(mutated[:target_idx])["numbers"]
        blue_after = predict_blue_fusion(mutated[:target_idx])["numbers"]
        self.assertEqual(red_before, red_after)
        self.assertEqual(blue_before, blue_after)

    def test_analysis_windows_are_consistent(self) -> None:
        result = run_full_analysis(DATA_PATH)
        self.assertEqual(result["data_summary"]["draw_count"], len(self.draws))
        self.assertEqual(result["next_issue"], str(int(self.draws[-1].issue) + 1))
        for section in ("red", "blue"):
            for window in ("20", "38", "60"):
                metrics = result[section]["windows"][window]
                self.assertEqual(metrics["total"], int(window))
                self.assertEqual(len(metrics["rows"]), int(window))
                self.assertGreaterEqual(metrics["hit_rate"], 0.0)
                self.assertLessEqual(metrics["hit_rate"], 1.0)


if __name__ == "__main__":
    unittest.main()
