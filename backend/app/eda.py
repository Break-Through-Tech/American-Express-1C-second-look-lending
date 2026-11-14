"""Numbers for the Overview & EDA page."""
import pandas as pd

from app import config, feature_info, features

_overview_cache = {}

# The four time windows: the model never sees a later window while learning from an earlier one
WINDOWS = {
    "fit": ("Fit the model", lambda w: w < config.VAL_START_WEEK),
    "model_validation": ("Model validation", lambda w: (w >= config.VAL_START_WEEK) & (w < config.POLICY_START_WEEK)),
    "policy_validation": ("Policy validation", lambda w: w >= config.POLICY_START_WEEK),
}

# Columns shown in the training-data sample (the full table has every feature)
SAMPLE_COLUMNS = [
    "case_id", "WEEK_NUM", "target", "thin_file", "credamount_770A", "annuity_780A", "mainoccupationinc_384A",
    "age_years", "days_employed_700P", "riskassesment_940T", "bureau_rowcount", "prev_app_count",
    "tax_amount_4527230A_mean", "credit_to_income",
]


def clear_cache():
    _overview_cache.clear()


def dataset_overview():
    if "overview" in _overview_cache:
        return _overview_cache["overview"]

    train = features.load_features("train")
    test = features.load_features("test")
    thin = train["thin_file"] == 1

    weekly = train.groupby(["WEEK_NUM", "thin_file"])["target"].mean().unstack()
    weekly_rows = [
        {"week": int(week), "established": float(row[0]), "thin_file": float(row[1])}
        for week, row in weekly.iterrows()
    ]

    tables = pd.read_csv(config.DATA_DIR / "table_details.csv")
    table_rows = tables[["table", "depth", "grain_rows_per_case", "n_rows_train", "n_rows_test", "description"]]

    coverage = train["external_coverage"].clip(upper=15).value_counts().sort_index()

    result = {
        "train_loans": len(train),
        "test_loans": len(test),
        "train_weeks": [int(train["WEEK_NUM"].min()), int(train["WEEK_NUM"].max())],
        "test_weeks": [int(test["WEEK_NUM"].min()), int(test["WEEK_NUM"].max())],
        "default_rate": float(train["target"].mean()),
        "thin_file_share": float(thin.mean()),
        "default_rate_established": float(train.loc[~thin, "target"].mean()),
        "default_rate_thin_file": float(train.loc[thin, "target"].mean()),
        "test_thin_file_share": float(test["thin_file"].mean()),
        "weekly_default_rate": weekly_rows,
        "tables": table_rows.to_dict("records"),
        "coverage_distribution": [{"coverage": int(k), "count": int(v)} for k, v in coverage.items()],
        "missing": missing_values(train),
        "raw_tables": len(tables),
        "feature_count": len(features.feature_columns(train)),
        "windows": data_windows(train, test),
    }
    _overview_cache["overview"] = result
    return result


def data_windows(train, test):
    """Rows, weeks and default rate of each time window."""
    rows = []
    for key, (label, in_window) in WINDOWS.items():
        part = train[in_window(train["WEEK_NUM"])]
        rows.append({"key": key, "label": label, "weeks": [int(part["WEEK_NUM"].min()), int(part["WEEK_NUM"].max())],
                     "rows": len(part), "default_rate": float(part["target"].mean()),
                     "thin_file_share": float(part["thin_file"].mean())})
    answers = test["case_id"].map(features.load_solution())
    rows.append({"key": "test", "label": "Test (final check)", "weeks": [int(test["WEEK_NUM"].min()), int(test["WEEK_NUM"].max())],
                 "rows": len(test), "default_rate": float(answers.mean()), "thin_file_share": float(test["thin_file"].mean())})
    return rows


def training_sample(window=None, segment=None, outcome=None, all_columns=False, offset=0, limit=10):
    """A page of rows from the training feature table, filtered by window, segment and outcome."""
    df = features.load_features("train")
    keep = pd.Series(True, index=df.index)
    if window:
        keep &= WINDOWS[window][1](df["WEEK_NUM"])
    if segment:
        keep &= df["thin_file"] == (1 if segment == "thin_file" else 0)
    if outcome:
        keep &= df["target"] == (1 if outcome == "defaulted" else 0)
    part = df[keep]
    columns = SAMPLE_COLUMNS
    if all_columns:
        columns = ["case_id", "WEEK_NUM", "target", "thin_file"] + [c for c in features.feature_columns(df) if c != "thin_file"]
    page = part.iloc[offset:offset + limit][columns]
    rows = [{col: plain(v) for col, v in row.items()} for row in page.to_dict("records")]
    return {
        "total": len(part),
        "columns": [{"name": c, "description": column_help(c)} for c in columns],
        "rows": rows,
    }


_raw_tables = {}  # the last two raw tables opened, so paging stays fast without holding all eight in memory


def raw_table(name):
    if name not in _raw_tables:
        if len(_raw_tables) >= 2:
            _raw_tables.pop(next(iter(_raw_tables)))
        _raw_tables[name] = features.read_table("train", name)
    return _raw_tables[name]


def raw_table_page(name, case_id=None, offset=0, limit=10):
    """A page of one raw training table, optionally only one loan's rows."""
    if name not in feature_info.TABLE_INFO:
        raise KeyError(f"Unknown table {name}")
    df = raw_table(name)
    if case_id is not None:
        df = df[df["case_id"] == case_id]
    page = df.iloc[offset:offset + limit]
    info = feature_info.TABLE_INFO[name]
    definitions = feature_info.column_definitions()
    return {
        "table": name,
        "title": info["title"],
        "what": info["what"],
        "total": len(df),
        "columns": [{"name": c, "description": definitions.get((name, c), "")} for c in df.columns],
        "rows": [{col: plain(v) for col, v in row.items()} for row in page.to_dict("records")],
    }


def plain(value):
    """A cell as JSON: numbers stay numbers, categories become text, missing becomes null."""
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        value = value.item()
    return value if isinstance(value, (int, float)) else str(value)


def column_help(name):
    special = {"case_id": "Loan id", "WEEK_NUM": "Week of the decision (0 = oldest)",
               "target": "What the model learns: 1 = defaulted, 0 = repaid"}
    return special.get(name) or feature_info.describe_feature(name)[1]


def missing_values(df, top=20):
    rows = []
    for col in features.feature_columns(df):
        rows.append({
            "feature": col,
            "all": float(df[col].isna().mean()),
            "established": float(df.loc[df["thin_file"] == 0, col].isna().mean()),
            "thin_file": float(df.loc[df["thin_file"] == 1, col].isna().mean()),
        })
    rows.sort(key=lambda r: -r["all"])
    return rows[:top]


def feature_list():
    df = features.load_features("train")
    return [{"name": c, "categorical": str(df[c].dtype) == "category"} for c in features.feature_columns(df)]


def feature_signal(name, bins=10):
    """Default rate across bins of one feature, for each segment."""
    df = features.load_features("train")
    if name not in df.columns:
        raise KeyError(name)
    column = df[name]

    if str(column.dtype) == "category" or column.nunique() <= 12:
        groups = column
    else:
        # Group on the intervals themselves, not their text, so bins stay in order
        groups = pd.qcut(column, bins, duplicates="drop")

    table = df.groupby([groups, "thin_file"], observed=True, dropna=False)["target"].agg(["mean", "size"]).unstack()
    rows = []
    for bucket, row in table.iterrows():
        rows.append({
            "bucket": "missing" if pd.isna(bucket) else str(bucket),
            "established": None if pd.isna(row[("mean", 0)]) else float(row[("mean", 0)]),
            "thin_file": None if pd.isna(row[("mean", 1)]) else float(row[("mean", 1)]),
            "count": int(row["size"].fillna(0).sum()),
        })
    return {"feature": name, "rows": rows}
