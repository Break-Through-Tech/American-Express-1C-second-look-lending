"""Turns the raw CSV tables into one feature row per loan."""
from functools import lru_cache

import numpy as np
import pandas as pd

from app import config

CATEGORICAL_FEATURES = ["education_927M", "maritalstatus_703M", "description_5085714M", "housingtype_772M"]
NOT_FEATURES = ["case_id", "date_decision", "MONTH", "WEEK_NUM", "target"]

_cache = {}


def read_table(split, table, date_cols=None):
    """Read a table, stitching together any _0 / _1 parts."""
    folder = config.CSV_DIR / split
    single_file = folder / f"{split}_{table}.csv"
    if single_file.exists():
        files = [single_file]
    else:
        files = sorted(folder.glob(f"{split}_{table}_[0-9].csv"))
    df = pd.concat([pd.read_csv(f, parse_dates=date_cols) for f in files], ignore_index=True)
    return df.drop_duplicates()


def flatten_columns(df, prefix):
    df.columns = [f"{prefix}_{col}_{stat}" for col, stat in df.columns]
    return df


def category_shares(df, column, prefix):
    """Share of each category value among a case's rows."""
    shares = pd.crosstab(df["case_id"], df[column], normalize="index")
    shares.columns = [f"{prefix}_{column}_share_{value}" for value in shares.columns]
    return shares


def bureau_features(bureau):
    bureau["dpd_over_30"] = (bureau["pmts_dpdvalue_108P"] > 30).astype(int)
    agg = bureau.groupby("case_id").agg({
        "num_group1": ["count"],
        "credamount_770A": ["mean", "max", "sum"],
        "overdueamountmax_950A": ["mean", "max"],
        "pmts_dpdvalue_108P": ["mean", "max"],
        "dpd_over_30": ["sum"],
    })
    agg = flatten_columns(agg, "bureau")
    agg = agg.rename(columns={"bureau_num_group1_count": "bureau_rowcount"})
    return agg.join(category_shares(bureau, "classificationofcontr_13M", "bureau"))


def payment_history_features(payments):
    payments["is_overdue"] = (payments["pmts_overdue_1140A"].fillna(0) > 0).astype(int)
    agg = payments.groupby("case_id").agg({
        "num_group2": ["count"],
        "pmts_overdue_1140A": ["mean", "max", "sum"],
        "is_overdue": ["mean"],
    })
    agg = flatten_columns(agg, "payments")
    return agg.rename(columns={"payments_num_group2_count": "payments_rowcount"})


def prior_application_features(prev, decision_dates):
    prev["was_approved"] = prev["approvaldate_319D"].notna().astype(int)
    prev["days_since_approval"] = (prev["case_id"].map(decision_dates) - prev["approvaldate_319D"]).dt.days
    agg = prev.groupby("case_id").agg({
        "num_group1": ["count"],
        "credamount_590A": ["mean", "max"],
        "was_approved": ["sum"],
        "days_since_approval": ["min"],
    })
    agg = flatten_columns(agg, "prev")
    agg = agg.rename(columns={"prev_num_group1_count": "prev_app_count"})
    return agg.join(category_shares(prev, "status_219L", "prev"))


def tax_features(tax):
    agg = tax.groupby("case_id").agg({
        "num_group1": ["count"],
        "amount_4527230A": ["mean", "max", "sum"],
    })
    agg = flatten_columns(agg, "tax")
    return agg.rename(columns={"tax_num_group1_count": "tax_rowcount"})


def person_features(person):
    agg = person.groupby("case_id").agg({
        "num_group1": ["count"],
        "mainoccupationinc_384A": ["sum"],
        "empl_employedtotal_800L": ["mean"],
    })
    agg = flatten_columns(agg, "person")
    agg = agg.rename(columns={"person_num_group1_count": "person_count"})
    # Housing type of the main applicant only
    main_person = person[person["num_group1"] == 0].set_index("case_id")
    agg["housingtype_772M"] = main_person["housingtype_772M"]
    return agg


def add_derived_features(df):
    """Features built from other columns (also reused for what-if scoring)."""
    # Signals that still exist for thin-file applicants
    df["has_bureau_summary"] = df["riskassesment_940T"].notna().astype(int)
    df["has_prior_app"] = (df["prev_app_count"] > 0).astype(int)
    df["external_coverage"] = df["bureau_rowcount"] + df["prev_app_count"] + df["tax_rowcount"]

    # Affordability ratios
    income = df["mainoccupationinc_384A"].replace(0, np.nan)
    df["annuity_to_income"] = df["annuity_780A"] / income
    df["credit_to_income"] = df["credamount_770A"] / income
    df["tax_to_stated_income"] = df["tax_amount_4527230A_mean"] / income
    return df


def build_features(split, log=print):
    base = read_table(split, "base", ["date_decision"])
    if "target" not in base.columns:
        base["target"] = np.nan  # test set has no target
    log(f"[{split}] {len(base):,} loans")

    # Depth 0: one row per case, so join directly
    static = read_table(split, "static_0", ["birth_259D"])
    static_cb = read_table(split, "static_cb_0")
    df = base.merge(static, on="case_id", how="left").merge(static_cb, on="case_id", how="left")
    df["age_years"] = (df["date_decision"] - df["birth_259D"]).dt.days / 365.25
    df = df.drop(columns=["birth_259D"])

    # Depth 1-2: many rows per case, so aggregate first
    decision_dates = base.set_index("case_id")["date_decision"]
    aggregated = [
        person_features(read_table(split, "person_1")),
        bureau_features(read_table(split, "credit_bureau_a_1")),
        payment_history_features(read_table(split, "credit_bureau_a_2")),
        prior_application_features(read_table(split, "applprev_1", ["approvaldate_319D"]), decision_dates),
        tax_features(read_table(split, "tax_registry_a_1")),
    ]
    for agg in aggregated:
        df = df.merge(agg, left_on="case_id", right_index=True, how="left")
    log(f"[{split}] aggregated sub-tables joined")

    for col in ["bureau_rowcount", "payments_rowcount", "prev_app_count", "tax_rowcount", "person_count"]:
        df[col] = df[col].fillna(0).astype(int)

    # Thin-file means no credit bureau history at all
    df["thin_file"] = (df["bureau_rowcount"] == 0).astype(int)
    df = add_derived_features(df)

    for col in CATEGORICAL_FEATURES:
        df[col] = df[col].fillna("MISSING").astype("category")

    log(f"[{split}] feature table: {df.shape[0]:,} rows x {df.shape[1]} columns")
    return df


def load_features(split, rebuild=False, log=print):
    """Feature table from memory, then the parquet cache, otherwise rebuilt from CSV."""
    path = config.FEATURES_DIR / f"{split}_features.parquet"
    if split in _cache and not rebuild:
        return _cache[split]
    if path.exists() and not rebuild:
        df = pd.read_parquet(path)
    else:
        df = build_features(split, log)
        df.to_parquet(path, index=False)
    _cache[split] = df
    return df


def features_are_built():
    return all((config.FEATURES_DIR / f"{s}_features.parquet").exists() for s in ["train", "test"])


def feature_columns(df):
    return [c for c in df.columns if c not in NOT_FEATURES]


@lru_cache(maxsize=1)
def load_solution():
    """Test answer key (case_id -> target), used only for final scoring."""
    return pd.read_csv(config.SOLUTION_CSV).set_index("case_id")["target"]
