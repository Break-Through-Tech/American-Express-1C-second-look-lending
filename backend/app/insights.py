"""Numbers behind the Insights page: the raw-data tour and the model walkthrough."""
import json

import joblib
import numpy as np
import pandas as pd

from app import analysis, config, features, storage
from app.feature_info import (SUFFIX_MEANING, TABLE_INFO, TABLE_ORDER, column_definitions, describe_feature,
                              suffix_of)
from app.param_help import PARAM_HELP

_cache = {}


def clear_cache():
    _cache.clear()

def to_records(df):
    """DataFrame to JSON-friendly records (NaN becomes null)."""
    return json.loads(df.to_json(orient="records", date_format="iso"))


# Raw data tab

def column_summary(table, df, column):
    values = df[column]
    suffix = suffix_of(column)
    summary = {
        "name": column,
        "suffix": suffix,
        "suffix_meaning": SUFFIX_MEANING.get(suffix),
        "description": column_definitions().get((table, column), ""),
        "missing": float(values.isna().mean()),
    }
    known = values.dropna()
    if suffix == "D" or column == "date_decision":
        summary.update(kind="date", first=str(known.min()), last=str(known.max()))
    elif pd.api.types.is_numeric_dtype(values) and suffix != "M":
        summary.update(kind="number", min=float(known.min()), median=float(known.median()), max=float(known.max()))
    else:
        shares = known.value_counts(normalize=True)
        summary.update(kind="category", levels=int(len(shares)),
                       top=[{"value": str(v), "share": float(s)} for v, s in shares.head(3).items()])
    return summary


def pick_examples(train):
    """Pick one typical established and one thin-file applicant to follow through the tables."""
    established = train[(train["thin_file"] == 0) & train["bureau_rowcount"].between(3, 4)
                        & (train["prev_app_count"] >= 1) & (train["tax_rowcount"] >= 1) & (train["person_count"] == 2)]
    thin = train[(train["thin_file"] == 1) & (train["prev_app_count"] >= 1) & (train["tax_rowcount"] >= 1)]
    return {"established": int(established["case_id"].iloc[0]), "thin_file": int(thin["case_id"].iloc[0])}


def raw_data_insights():
    if "raw" in _cache:
        return _cache["raw"]

    train = features.load_features("train")
    examples = pick_examples(train)
    example_rows = {kind: {} for kind in examples}
    tables = []

    for name in TABLE_ORDER:
        df = features.read_table("train", name)
        rows_per_loan = df.groupby("case_id").size()
        tables.append({
            "name": name,
            **TABLE_INFO[name],
            "rows": len(df),
            "loans_covered": df["case_id"].nunique() / len(train),
            "rows_per_loan_mean": float(rows_per_loan.mean()),
            "rows_per_loan_max": int(rows_per_loan.max()),
            "columns": [column_summary(name, df, column) for column in df.columns],
            "sample": to_records(df.head(5)),
        })
        for kind, case_id in examples.items():
            example_rows[kind][name] = to_records(df[df["case_id"] == case_id])

    feature_cols = features.feature_columns(train)
    example_details = {}
    for kind, case_id in examples.items():
        row = train[train["case_id"] == case_id].iloc[0]
        example_details[kind] = {
            "case_id": case_id,
            "defaulted": int(row["target"]),
            "tables": example_rows[kind],
            "features": [
                {"feature": f, "value": None if pd.isna(row[f]) else (str(row[f]) if isinstance(row[f], str) else float(row[f])),
                 "source": describe_feature(f)[0], "meaning": describe_feature(f)[1]}
                for f in feature_cols
            ],
        }

    result = {
        "loans": len(train),
        "raw_rows": sum(t["rows"] for t in tables),
        "feature_count": len(feature_cols),
        "thin_file_share": float(train["thin_file"].mean()),
        "suffixes": SUFFIX_MEANING,
        "tables": tables,
        "examples": example_details,
    }
    _cache["raw"] = result
    return result


# Model tab

def split_windows(settings):
    train = features.load_features("train")
    test = features.load_features("test")
    val_start = settings.get("val_start_week", config.VAL_START_WEEK)
    policy_start = settings.get("policy_start_week", config.POLICY_START_WEEK)
    week = train["WEEK_NUM"]
    windows = [
        ("Fit the model", f"0–{val_start - 1}", week < val_start,
         "The model learns from these loans."),
        ("Model validation", f"{val_start}–{policy_start - 1}", (week >= val_start) & (week < policy_start),
         "Early stopping and Optuna tuning: decides when to stop adding trees and which settings are best."),
        ("Policy validation", f"{policy_start}–91", week >= policy_start,
         "Never seen by the model. Used to calibrate PD, pick thresholds and report validation scores."),
    ]
    rows = [{"name": name, "weeks": weeks, "loans": int(mask.sum()), "thin_share": float(train.loc[mask, "thin_file"].mean()),
             "purpose": purpose} for name, weeks, mask, purpose in windows]
    rows.append({"name": "Test (final check)", "weeks": "92–107", "loans": len(test),
                 "thin_share": float(test["thin_file"].mean()),
                 "purpose": "Later weeks with the answer hidden. Scored once at the end against solution.csv."})
    return rows


def feature_groups():
    train = features.load_features("train")
    counts = {}
    for f in features.feature_columns(train):
        source = describe_feature(f)[0]
        counts[source] = counts.get(source, 0) + 1
    return [{"source": source, "features": n} for source, n in counts.items()]


def pd_distribution(df):
    """Share of each segment in each PD band, raw and calibrated."""
    edges = np.arange(0, 0.84, 0.04)
    rows = []
    for i in range(len(edges) - 1):
        rows.append({"pd": round(float(edges[i] + 0.02), 3)})
    for column, label in [("pd", "raw"), ("pd_calibrated", "calibrated")]:
        for segment, name in [(0, "established"), (1, "thin_file")]:
            values = np.clip(df.loc[df["thin_file"] == segment, column], 0, 0.799)
            counts, _ = np.histogram(values, bins=edges)
            for row, count in zip(rows, counts / counts.sum()):
                row[f"{name}_{label}"] = float(count)
    return rows


def outcome_matrix(df, pd_column, threshold_est, threshold_thin):
    """Approved/denied x repaid/defaulted counts per segment, plus the profit."""
    result = {}
    for segment, name in [(0, "established"), (1, "thin_file")]:
        part = df[df["thin_file"] == segment]
        threshold = threshold_thin if segment == 1 else threshold_est
        approve = part[pd_column] < threshold
        repaid = part["target"] == 0
        cells = {
            "approved_repaid": int((approve & repaid).sum()),
            "approved_defaulted": int((approve & ~repaid).sum()),
            "denied_repaid": int((~approve & repaid).sum()),
            "denied_defaulted": int((~approve & ~repaid).sum()),
        }
        cells["profit"] = cells["approved_repaid"] * config.GAIN_REPAID - cells["approved_defaulted"] * config.LOSS_DEFAULT
        cells["threshold"] = threshold
        result[name] = cells
    return result


def param_help_text(help):
    return f"{help.get('what', '')} {help.get('effect', '')}".strip()


def model_insights(run_id):
    info = storage.get_run(run_id)
    folder = storage.run_folder(run_id)
    val = storage.load_predictions(run_id, "val")

    calibrator_file = folder / "calibrator.joblib"
    val["pd_calibrated"] = joblib.load(calibrator_file).transform(val) if calibrator_file.exists() else val["pd"]
    policy_result = analysis.get_policy_analysis(run_id)
    thresholds = policy_result["options"]["thresholds"] if policy_result else {"established": 0.2, "thin_file": 0.2}

    curve = info.get("learning_curve") or []
    step = max(1, len(curve) // 300)  # at most ~300 points for the chart
    help_text = PARAM_HELP.get(info["model_type"], {})

    return {
        "run": {key: info.get(key) for key in ["run_id", "name", "model_type", "model_name", "created_at",
                                                 "train_seconds", "n_train", "n_features", "best_iteration",
                                                 "solver_iterations"]},
        "params": [{"name": k, "value": v, "help": param_help_text(help_text.get(k, {}))} for k, v in info["params"].items()],
        "split": split_windows(info["settings"]),
        "feature_groups": feature_groups(),
        "learning_curve": [point for i, point in enumerate(curve) if i % step == 0],
        "importance": [{**item, "source": describe_feature(item["feature"])[0],
                        "meaning": describe_feature(item["feature"])[1]} for item in info["feature_importance"][:12]],
        "metrics": info["metrics"]["validation"],
        "mean_pd": {
            name: {"raw": float(val.loc[val["thin_file"] == s, "pd"].mean()),
                   "calibrated": float(val.loc[val["thin_file"] == s, "pd_calibrated"].mean()),
                   "actual": float(val.loc[val["thin_file"] == s, "target"].mean())}
            for s, name in [(0, "established"), (1, "thin_file")]
        },
        "pd_distribution": pd_distribution(val),
        "outcomes": {
            "baseline": outcome_matrix(val, "pd", config.BREAKEVEN_PD, config.BREAKEVEN_PD),
            "second_look": outcome_matrix(val, "pd_calibrated", thresholds["established"], thresholds["thin_file"]),
        },
        "thresholds": thresholds,
    }
