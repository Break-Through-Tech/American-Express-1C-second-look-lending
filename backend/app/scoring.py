"""How the two models decide: the primary model's score, Second Look's adjusted score, and the pipeline settings."""
import joblib
import numpy as np

from app import analysis, config, storage

SETTINGS_PATH = config.ARTIFACTS_DIR / "workflow_settings.json"

DEFAULT_SETTINGS = {
    "mode": "auto",             # auto: primary declines go straight to Second Look; manual: they wait for a person
    "primary_cutoff": 0.20,     # the primary model approves when its risk is below this
    "review_band": 0.02,        # second-look declines this close to their cut-off go to a person (~260 a week)
}


def get_settings():
    return {**DEFAULT_SETTINGS, **(storage.read_json(SETTINGS_PATH) or {})}


def save_settings(changes):
    settings = {**get_settings(), **changes}
    storage.save_json(SETTINGS_PATH, settings)
    return settings


def primary_scores():
    """Raw risk of every incoming application from the primary model, by case_id."""
    run_id = storage.get_model_roles()["primary"]
    return storage.load_predictions(run_id, "test").set_index("case_id")["pd"]


def second_look_scores():
    """Adjusted risk and cut-off for every incoming application, from the second-look model's published policy."""
    run_id = storage.get_model_roles()["second_look"]
    policy = analysis.get_policy_analysis(run_id) or analysis.run_policy_analysis(run_id, {})
    df = storage.load_predictions(run_id, "test")
    calibrator = joblib.load(storage.run_folder(run_id) / "calibrator.joblib")
    df["pd_calibrated"] = calibrator.transform(df)
    cutoffs = policy["options"]["thresholds"]
    df["cutoff"] = np.where(df["thin_file"] == 1, cutoffs["thin_file"], cutoffs["established"])
    return df.set_index("case_id")[["pd_calibrated", "cutoff"]]


def second_look_status(pd_value, cutoff, review_band):
    """Approve under the cut-off; just above it goes to a person; well above it is declined."""
    if pd_value < cutoff:
        return "approved_second_look"
    if pd_value - cutoff <= review_band:
        return "in_review"
    return "declined_second_look"
