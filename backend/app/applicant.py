"""Scores one applicant, with optional what-if changes."""
import joblib
import numpy as np
import pandas as pd

from app import analysis, applications, business, config, features, storage

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
    if applications.is_online(case_id):
        return "online", applications.feature_row(case_id)
    for split in ["test", "train"]:
        df = features.load_features(split)
        row = df[df["case_id"] == case_id]
        if not row.empty:
            return split, row.copy()
    raise KeyError(f"case_id {case_id} not found")


def score(run_id, case_id, changes=None):
    split, row = find_applicant(case_id)
    actual = None  # nobody knows yet whether an online applicant will repay
    if split == "test":
        actual = features.load_solution().get(case_id)
    elif split == "train":
        actual = row["target"].iloc[0]

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
        "reasons": reasons_for(model, row, split),
        "editable": {f: to_plain(row[f].iloc[0]) for f in EDITABLE_FIELDS},
        "profile": {f: to_plain(row[f].iloc[0]) for f in PROFILE_FIELDS},
        "application": applications.public_details(case_id) if split == "online" else None,
    }


def reasons_for(model, row, split):
    if split != "online":
        return model.explain(row)
    # Online applications: only reasons based on what the applicant told us
    reasons = model.explain(row, top=40)
    return [r for r in reasons if r["feature"] in applications.FROM_FORM][:8]


# Stories the Applicant portal shows as sample applications
STORIES = {
    "second_look": "Approved thanks to Second Look",
    "approved": "Approved",
    "in_review": "With our review team",
    "not_approved": "Not approved this time",
}


def showcase(run_id, per_story=2):
    """A few recent applications per story, picked the same way every time."""
    df = business.decisions(run_id)
    thin = df["thin_file"] == 1
    declined = ~df["second_look"] & ~df["in_review"]
    # One group per story; the last two take one applicant from each segment
    groups = [
        ("second_look", df[thin & df["second_look"] & ~df["baseline"]], per_story),
        ("approved", df[~thin & df["baseline"]], per_story),
        ("in_review", df[df["in_review"]], 1),
        ("not_approved", df[thin & declined], 1),
        ("not_approved", df[~thin & declined], 1),
    ]
    applications = features.load_features("test").set_index("case_id")
    picks = []
    for story, group, count in groups:
        for case_id in group.sample(min(count, len(group)), random_state=7)["case_id"]:
            info = applications.loc[case_id]
            picks.append({
                "case_id": int(case_id),
                "story": story,
                "story_label": STORIES[story],
                "thin_file": bool(info["thin_file"]),
                "income": to_plain(info["mainoccupationinc_384A"]),
                "credit_amount": to_plain(info["credamount_770A"]),
                "payment": to_plain(info["annuity_780A"]),
            })
    return picks
