"""Scores one applicant, with optional what-if changes."""
import joblib
import numpy as np
import pandas as pd

from app import analysis, config, features, storage

EDITABLE_FIELDS = [
    "mainoccupationinc_384A", "credamount_770A", "annuity_780A", "days_employed_700P",
    "age_years", "riskassesment_940T", "numberofqueries_146L",
    "bureau_pmts_dpdvalue_108P_max", "prev_app_count", "tax_amount_4527230A_mean",
]
# bureau_rowcount stays read-only: a count without real bureau rows makes an impossible applicant
PROFILE_FIELDS = [
    "education_927M", "maritalstatus_703M", "housingtype_772M", "person_count",
    "external_coverage", "has_prior_app", "annuity_to_income", "credit_to_income",
]


def to_plain(value):
    if pd.isna(value):
        return None
    if isinstance(value, (np.integer, np.floating)):
        value = value.item()
    if isinstance(value, float):
        return round(value, 4)
    return value if isinstance(value, int) else str(value)


def expected_value(pd_value):
    return (1 - pd_value) * config.GAIN_REPAID - pd_value * config.LOSS_DEFAULT


def find_applicant(case_id):
    for split in ["test", "train"]:
        df = features.load_features(split)
        row = df[df["case_id"] == case_id]
        if not row.empty:
            return split, row.copy()
    raise KeyError(f"case_id {case_id} not found")


def score(run_id, case_id, changes=None):
    split, row = find_applicant(case_id)
    actual = features.load_solution().get(case_id) if split == "test" else row["target"].iloc[0]

    # Apply the edits, then recompute anything derived from them
    for field, value in (changes or {}).items():
        if field in EDITABLE_FIELDS:
            row[field] = np.nan if value is None else float(value)
    row = features.add_derived_features(row)

    model = storage.load_model(run_id)
    raw_pd = float(model.predict_pd(row)[0])

    # The second look uses the run's saved calibrator and thresholds
    calibrated_pd = raw_pd
    thresholds = {"established": config.BREAKEVEN_PD, "thin_file": config.BREAKEVEN_PD}
    calibrator_file = storage.run_folder(run_id) / "calibrator.joblib"
    analysis_result = analysis.get_policy_analysis(run_id)
    if analysis_result and calibrator_file.exists():
        calibrator = joblib.load(calibrator_file)
        calibrated_pd = float(calibrator.transform(row.assign(pd=raw_pd))[0])
        thresholds = analysis_result["options"]["thresholds"]

    is_thin = bool(row["thin_file"].iloc[0])
    second_look_threshold = thresholds["thin_file"] if is_thin else thresholds["established"]

    return {
        "case_id": case_id,
        "split": split,
        "week": int(row["WEEK_NUM"].iloc[0]),
        "thin_file": is_thin,
        "actual_default": to_plain(actual),
        "pd_raw": raw_pd,
        "pd_calibrated": calibrated_pd,
        "baseline": {
            "threshold": config.BREAKEVEN_PD,
            "approve": raw_pd < config.BREAKEVEN_PD,
            "expected_value": expected_value(raw_pd),
        },
        "second_look": {
            "threshold": second_look_threshold,
            "approve": calibrated_pd < second_look_threshold,
            "expected_value": expected_value(calibrated_pd),
        },
        "reasons": model.explain(row),
        "editable": {f: to_plain(row[f].iloc[0]) for f in EDITABLE_FIELDS},
        "profile": {f: to_plain(row[f].iloc[0]) for f in PROFILE_FIELDS},
    }


def random_applicants(count=10):
    df = features.load_features("test")
    thin = df[df["thin_file"] == 1].sample(count // 2)
    established = df[df["thin_file"] == 0].sample(count // 2)
    return [{"case_id": int(r.case_id), "thin_file": bool(r.thin_file)}
            for r in pd.concat([thin, established]).itertuples()]
