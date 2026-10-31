"""Numbers for the Overview & EDA page."""
import pandas as pd

from app import config, features

_overview_cache = {}


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
    }
    _overview_cache["overview"] = result
    return result


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
