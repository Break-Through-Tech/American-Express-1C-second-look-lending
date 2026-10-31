"""Compares the baseline and second-look policies for a trained run."""
import joblib
import pandas as pd

from app import config, policy, storage

DEFAULT_OPTIONS = {
    "calibration": "platt",   # none, platt or isotonic
    "per_segment": True,      # calibrate thin-file and established separately
    "drift": True,            # adjust for thin-file risk going down over time
    "penalty": 100_000,       # $ per inclusion-gap point, per 100k applicants
    "ceiling": 0.12,          # max default rate allowed among approved loans
    "thresholds": None,       # None = find the best ones on validation
}


def run_policy_analysis(run_id, options):
    options = {**DEFAULT_OPTIONS, **options}
    folder = storage.run_folder(run_id)
    val = storage.load_predictions(run_id, "val")
    test = storage.load_predictions(run_id, "test")
    history = pd.read_parquet(folder / "history.parquet")

    # Calibrate on the policy-validation weeks
    calibrator = policy.Calibrator(options["calibration"], options["per_segment"], options["drift"])
    calibrator.fit(val, history)
    val["pd_calibrated"] = calibrator.transform(val)
    test["pd_calibrated"] = calibrator.transform(test)

    # Pick thresholds on validation too, never on test
    thresholds = options["thresholds"]
    if not thresholds:
        thresholds = policy.find_best_thresholds(val, "pd_calibrated", options["penalty"], options["ceiling"])
    options["thresholds"] = thresholds

    # Score every policy on validation and on the out-of-time test set
    def compare(df):
        penalty, ceiling, t = options["penalty"], options["ceiling"], config.BREAKEVEN_PD
        return {
            "approve_all": policy.evaluate_policy(df, "pd", 1.0, 1.0, penalty, ceiling),
            "baseline": policy.evaluate_policy(df, "pd", t, t, penalty, ceiling),
            "calibrated_flat": policy.evaluate_policy(df, "pd_calibrated", t, t, penalty, ceiling),
            "second_look": policy.evaluate_policy(df, "pd_calibrated", thresholds["established"],
                                                  thresholds["thin_file"], penalty, ceiling),
        }

    validation_results = compare(val)
    test_results = compare(test)
    baseline, second_look = test_results["baseline"], test_results["second_look"]

    result = {
        "run_id": run_id,
        "options": options,
        "calibrator": calibrator.describe(),
        "validation": validation_results,
        "test": test_results,
        "profit_curve": {
            "raw": policy.profit_curve(test, "pd"),
            "calibrated": policy.profit_curve(test, "pd_calibrated"),
        },
        "calibration_table": {
            "raw": policy.calibration_table(test, "pd"),
            "calibrated": policy.calibration_table(test, "pd_calibrated"),
        },
        "test_metrics": {
            "raw": policy.metrics_by_segment(test, "pd"),
            "calibrated": policy.metrics_by_segment(test, "pd_calibrated"),
        },
        "summary": {
            "baseline_profit": baseline["profit"],
            "second_look_profit": second_look["profit"],
            "baseline_gap_pts": baseline["inclusion_gap_pts"],
            "second_look_gap_pts": second_look["inclusion_gap_pts"],
            "baseline_score": baseline["inclusive_profit_score"],
            "second_look_score": second_look["inclusive_profit_score"],
        },
    }
    storage.save_json(folder / "policy.json", result)
    joblib.dump(calibrator, folder / "calibrator.joblib")
    return result


def get_policy_analysis(run_id):
    return storage.read_json(storage.run_folder(run_id) / "policy.json")
