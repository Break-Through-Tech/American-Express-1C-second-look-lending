"""Builds second_look_lending.ipynb from the cells below (add --run to execute it and save the outputs)."""
import sys
from pathlib import Path

import nbformat
from nbformat.v4 import new_code_cell, new_markdown_cell, new_notebook

HERE = Path(__file__).resolve().parent
OUTPUT = HERE / "second_look_lending.ipynb"

cells = []


def md(text):
    cells.append(new_markdown_cell(text.strip()))


def code(text):
    cells.append(new_code_cell(text.strip()))


# Intro
md("""
# Second-Look Lending — EDA, models and inclusive decision policy

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/Break-Through-Tech/American-Express-1C-second-look-lending/blob/feature/second_lookup_lending/notebooks/second_look_lending.ipynb)

This notebook is the reproducible version of the project. It uses the same code as the web app (`backend/app/`), so the
numbers match what the app shows.

1. **EDA** — structure, target, missing values, segments, drift, numeric and categorical features, signal, leakage checks
2. **Features and split** — one row per loan, split by week
3. **Models** — Logistic Regression (baseline), Random Forest, LightGBM (+ Optuna)
4. **Decision policy** — cost model, inclusion gap, second-look policy, before / after
5. **Conclusions**

**How to run**
- **Colab:** put the dataset folder (with `csv_files/` and `solution.csv`) in Google Drive at `MyDrive/synth_home_credit`,
  then *Runtime → Run all*. The whole notebook takes about 10 minutes on the free tier.
- **Locally:** run from the `notebooks/` folder with the backend's virtual environment.
""")

code("""
import os
import sys
from pathlib import Path

IN_COLAB = "google.colab" in sys.modules
REPO_URL = "https://github.com/Break-Through-Tech/American-Express-1C-second-look-lending.git"
BRANCH = "feature/second_lookup_lending"

if IN_COLAB:
    from google.colab import drive
    drive.mount("/content/drive")
    if not Path("/content/repo").exists():
        !git clone -q -b {BRANCH} {REPO_URL} /content/repo
    !pip install -q -r /content/repo/backend/requirements.txt
    REPO = Path("/content/repo")
    DATA_DIR = Path("/content/drive/MyDrive/synth_home_credit")
else:
    REPO = Path.cwd().parent
    DATA_DIR = Path(os.environ.get("SLL_DATA_DIR", REPO / "data" / "synth_home_credit"))

assert (DATA_DIR / "csv_files").exists(), "Dataset not found: put it in data/synth_home_credit or set SLL_DATA_DIR"

# The backend reads these on import; notebook runs get their own artifacts folder
os.environ["SLL_DATA_DIR"] = str(DATA_DIR)
os.environ["SLL_ARTIFACTS_DIR"] = str(REPO / "backend" / "artifacts_notebook")
sys.path.insert(0, str(REPO / "backend"))
print("Dataset folder:", DATA_DIR.name)
""")

code("""
import warnings

warnings.filterwarnings("ignore")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

from app import analysis, config, features, storage, training
pd.set_option("display.width", 160)
pd.set_option("display.max_columns", 30)
pd.set_option("display.float_format", "{:,.4f}".format)

# Same colors as the web app
ESTABLISHED, THIN, SECOND_LOOK, BASELINE = "#2a78d6", "#eb6834", "#1baf7a", "#8a918e"
plt.rcParams.update({"figure.dpi": 110, "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True,
                     "grid.alpha": 0.3, "axes.axisbelow": True})
""")

# EDA: structure and missing values
md("""
## 1. EDA

### 1.1 Structure and target

Everything joins on `case_id`. **Depth 0** tables have one row per loan and join directly. **Depth 1–2** tables have many
rows per loan and must be aggregated first. Files ending in `_0` / `_1` are parts of one table.
""")

code("""
tables = pd.read_csv(DATA_DIR / "table_details.csv")
tables[["table", "depth", "grain_rows_per_case", "n_rows_train", "n_rows_test", "description"]]
""")

code("""
TABLE_NAMES = ["base", "static_0", "static_cb_0", "person_1", "credit_bureau_a_1", "credit_bureau_a_2",
               "applprev_1", "tax_registry_a_1"]
DATE_COLUMNS = {"base": ["date_decision"], "applprev_1": ["approvaldate_319D"]}
raw = {name: features.read_table("train", name, DATE_COLUMNS.get(name)) for name in TABLE_NAMES}

base = raw["base"]
default_rate = base["target"].mean()
naive_profit_per_loan = (1 - default_rate) * config.GAIN_REPAID - default_rate * config.LOSS_DEFAULT

print(f"Train loans: {len(base):,}   weeks {base.WEEK_NUM.min()}–{base.WEEK_NUM.max()}")
print(f"Default rate: {default_rate:.1%}  -> heavily imbalanced, so we use AUC / LogLoss, not accuracy")
print(f"Naïve baseline (approve everyone): ${naive_profit_per_loan:,.0f} profit per loan")
""")

md("""
### 1.2 Missing values — per table and per column
""")

code("""
rows = []
for name, df in raw.items():
    rows_per_case = df.groupby("case_id").size()
    value_cols = [c for c in df.columns if c not in ("case_id", "num_group1", "num_group2")]
    rows.append({
        "table": name,
        "rows": len(df),
        "loans covered": df["case_id"].nunique() / len(base),
        "rows per loan (mean)": rows_per_case.mean(),
        "rows per loan (max)": rows_per_case.max(),
        "% missing cells": df[value_cols].isna().mean().mean(),
    })
pd.DataFrame(rows)
""")

code("""
column_missing = pd.concat([
    df.drop(columns=["case_id"], errors="ignore").isna().mean().rename("% missing").to_frame().assign(table=name)
    for name, df in raw.items()
]).sort_values("% missing", ascending=False)
column_missing["heavy (>30%)"] = column_missing["% missing"] > 0.30
column_missing.head(10)
""")

md("""
Missing values are kept, not dropped: dropping applicants would remove exactly the thin-file people we care about.
LightGBM and Random Forest handle `NaN` natively; logistic regression gets a median plus a "was missing" flag.
""")

# EDA: segments and drift
md("""
### 1.3 Segments — thin-file vs established

**Thin-file = no rows in `credit_bureau_a_1`.** Build the feature table (one row per loan) and look at the segments.
""")

code("""
train = features.load_features("train")
test = features.load_features("test")
thin = train["thin_file"] == 1

segments = train.groupby("thin_file").agg(loans=("case_id", "size"), default_rate=("target", "mean"))
segments.index = ["established", "thin-file"]
segments["share"] = segments["loans"] / len(train)
segments
""")

code("""
fig, axes = plt.subplots(1, 2, figsize=(13, 4))

coverage = train["external_coverage"].clip(upper=15).value_counts().sort_index()
axes[0].bar(coverage.index, coverage.values, color=ESTABLISHED)
axes[0].set(title="External-data coverage per applicant", xlabel="bureau contracts + prior apps + tax records (capped at 15)",
            ylabel="applicants")

weekly = train.groupby(["WEEK_NUM", "thin_file"])["target"].mean().unstack()
axes[1].plot(weekly.index, weekly[0], color=ESTABLISHED, lw=2, label="established")
axes[1].plot(weekly.index, weekly[1], color=THIN, lw=2, label="thin-file")
axes[1].set(title="Default rate per week", xlabel="WEEK_NUM", ylabel="default rate")
axes[1].yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{v:.0%}"))
axes[1].legend()
plt.tight_layout()
plt.show()

print(f"Thin-file default rate: {weekly[1].iloc[:4].mean():.1%} in weeks 0-3 -> {weekly[1].iloc[-4:].mean():.1%} in weeks 88-91")
print(f"Established default rate: {weekly[0].iloc[:4].mean():.1%} -> {weekly[0].iloc[-4:].mean():.1%}")
""")

md("""
**Key finding:** thin-file risk **drifts down over time**, while established risk is flat. The test weeks (92–107) come
after all train weeks, so a model trained on train will **over-estimate thin-file risk on test**, and a flat 20% cut-off
will deny thin-file applicants who would repay. This is the inclusion gap the project closes.
""")

# EDA: numeric features
md("""
### 1.4 Numeric features — distributions, skew, outliers, sentinel
""")

code("""
NUMERIC = ["mainoccupationinc_384A", "credamount_770A", "annuity_780A", "days_employed_700P",
           "bureau_credamount_770A_mean", "bureau_pmts_dpdvalue_108P_max", "prev_credamount_590A_mean",
           "tax_amount_4527230A_mean", "annuity_to_income", "credit_to_income"]

fig, axes = plt.subplots(2, 5, figsize=(16, 6))
for ax, col in zip(axes.flat, NUMERIC):
    ax.hist(train[col].dropna(), bins=60, color=ESTABLISHED)
    ax.set_title(col, fontsize=9)
    ax.tick_params(labelsize=7)
plt.tight_layout()
plt.show()

stats = train[NUMERIC].describe(percentiles=[0.5, 0.99, 0.999]).T[["50%", "99%", "99.9%", "max"]]
stats["skew"] = train[NUMERIC].skew()
stats["max / p99.9"] = stats["max"] / stats["99.9%"]
stats
""")

code("""
# The dataset docs mention a 365243 "date sentinel" (a placeholder for missing dates).
sentinel_hits = {name: int((df.drop(columns=["case_id"], errors="ignore").select_dtypes("number") == 365243).sum().sum())
                 for name, df in raw.items()}
print("Cells equal to 365243 (excluding case_id):", sentinel_hits)
""")

md("""
- Amounts are right-skewed (skew ≈ 1.6–2.8) → `log1p` them for logistic regression.
- Outliers are mild (max is at most a few times the 99.9th percentile) → clip at 0.1% / 99.9% for logistic regression; trees do not care.
- No `365243` sentinel values are present in this synthetic data, so no replacement is needed.
""")

code("""
corr = train[NUMERIC + ["riskassesment_940T", "numberofqueries_146L", "age_years"]].corr()
fig, ax = plt.subplots(figsize=(8, 6.5))
image = ax.imshow(corr, cmap="RdBu_r", vmin=-1, vmax=1)
ax.set_xticks(range(len(corr)), corr.columns, rotation=60, ha="right", fontsize=8)
ax.set_yticks(range(len(corr)), corr.columns, fontsize=8)
ax.grid(False)
fig.colorbar(image, shrink=0.8)
ax.set_title("Correlation between key numeric features")
plt.tight_layout()
plt.show()

pairs = corr.where(np.triu(np.ones(corr.shape, dtype=bool), k=1)).stack().sort_values(key=abs, ascending=False)
print("Strongest pairs:")
print(pairs.head(5).round(3).to_string())
""")

# EDA: categorical features
md("""
### 1.5 Categorical features (…M) — cardinality, top values, rare values, default rate
""")

code("""
rows = []
for col in features.CATEGORICAL_FEATURES:
    shares = train[col].value_counts(normalize=True)
    rows.append({
        "feature": col,
        "levels": len(shares),
        "top value": shares.index[0],
        "top share": shares.iloc[0],
        "rare share (<1%)": shares[shares < 0.01].sum(),
        "MISSING share": shares.get("MISSING", 0.0),
    })
pd.DataFrame(rows)
""")

code("""
fig, axes = plt.subplots(1, 4, figsize=(16, 3.6))
for ax, col in zip(axes, features.CATEGORICAL_FEATURES):
    rates = train.groupby([col, "thin_file"], observed=True)["target"].mean().unstack()
    x = np.arange(len(rates))
    ax.bar(x - 0.2, rates[0], width=0.38, color=ESTABLISHED, label="established")
    if 1 in rates:
        ax.bar(x + 0.2, rates[1], width=0.38, color=THIN, label="thin-file")
    ax.set_xticks(x, rates.index, rotation=45, ha="right", fontsize=7)
    ax.set_title(col, fontsize=9)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{v:.0%}"))
axes[0].legend(fontsize=8)
plt.tight_layout()
plt.show()
""")

md("""
All masked categories have few levels (4–7) and no rare values, so there is nothing to collapse into "OTHER".
`education_927M` separates risk strongly in both segments; `maritalstatus_703M` and `housingtype_772M` carry almost no
signal. `description_5085714M` comes from the bureau summary, so thin-file applicants only have the `MISSING` level.
""")

# EDA: signal vs default
md("""
### 1.6 Signal vs default — and how it differs for thin-file applicants

Single-feature AUC: how well each feature alone separates defaulters from payers (0.5 = no signal), per segment.
""")

code("""
def single_feature_auc(df, col):
    values = df[col].cat.codes if str(df[col].dtype) == "category" else df[col]
    known = values.notna()
    if known.sum() < 1000 or values[known].nunique() < 2:
        return np.nan
    auc = roc_auc_score(df.loc[known, "target"], values[known])
    return max(auc, 1 - auc)  # direction does not matter here

signal = pd.DataFrame({
    "established": {c: single_feature_auc(train[~thin], c) for c in features.feature_columns(train)},
    "thin-file": {c: single_feature_auc(train[thin], c) for c in features.feature_columns(train)},
})
signal.sort_values("established", ascending=False).head(12)
""")

code("""
print("Strongest signals still available for thin-file applicants:")
signal["thin-file"].dropna().sort_values(ascending=False).head(8)
""")

code("""
fig, axes = plt.subplots(1, 3, figsize=(15, 3.8))
for ax, col in zip(axes, ["riskassesment_940T", "mainoccupationinc_384A", "annuity_to_income"]):
    bins = pd.qcut(train[col], 10, duplicates="drop")
    rates = train.groupby([bins, "thin_file"], observed=True)["target"].mean().unstack()
    x = np.arange(len(rates))
    ax.plot(x, rates[0], "o-", color=ESTABLISHED, label="established")
    if 1 in rates:
        ax.plot(x, rates[1], "o-", color=THIN, label="thin-file")
    ax.set_xticks(x, [f"D{i + 1}" for i in x])
    ax.set(title=f"Default rate by decile of {col}", xlabel="decile (low → high)")
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{v:.0%}"))
axes[0].legend()
plt.tight_layout()
plt.show()
""")

# EDA: leakage checks
md("""
### 1.7 Leakage and sanity checks
""")

code("""
prev = raw["applprev_1"]
decision_date = prev["case_id"].map(base.set_index("case_id")["date_decision"])
feature_cols = features.feature_columns(train)

checks = {
    "train weeks": f"{train.WEEK_NUM.min()}–{train.WEEK_NUM.max()}",
    "test weeks (later = out-of-time)": f"{test.WEEK_NUM.min()}–{test.WEEK_NUM.max()}",
    "case_ids in both train and test": len(set(train.case_id) & set(test.case_id)),
    "prior approvals dated after the decision (future data)": int((prev["approvaldate_319D"] > decision_date).sum()),
    "duplicate rows in raw tables": sum(int(df.duplicated().sum()) for df in raw.values()),
    "constant feature columns": [c for c in feature_cols if train[c].nunique(dropna=False) <= 1],
    "identical feature columns (50k-row sample)": int(train[feature_cols].sample(50_000, random_state=0).T.duplicated().sum()),
    "thin-file applicants with any bureau data": int((train.loc[thin, "has_bureau_summary"] == 1).sum()),
    "time fields used as model inputs": [c for c in ["WEEK_NUM", "MONTH", "date_decision"] if c in feature_cols],
}
pd.Series(checks, name="result").to_frame()
""")

md("""
No leakage found: no shared applicants, no future-dated records, no duplicates or constant columns, and time fields are
used only to split the data, never as model inputs.
""")

# Features and split
md("""
## 2. Features and time split

`features.py` builds **53 features** per loan: applicant facts, bureau aggregates (count / mean / max / sum),
payment history, prior applications, tax records, the thin-file flag and affordability ratios.
See `doc/DATA_DICTIONARY.md` for every feature.

The train file is split **by week** into three parts, so nothing is tuned on data it is later judged on:

| Weeks | Used for |
|---|---|
| 0–79 | fit the model |
| 80–85 | model validation: early stopping, Optuna tuning |
| 86–91 | policy validation: calibration, thresholds, reported validation metrics |
| 92–107 (test file) | final score, once, against `solution.csv` |
""")

code("""
week = train["WEEK_NUM"]
split = pd.DataFrame({
    "loans": [(week < 80).sum(), ((week >= 80) & (week < 86)).sum(), (week >= 86).sum(), len(test)],
    "thin-file share": [thin[week < 80].mean(), thin[(week >= 80) & (week < 86)].mean(), thin[week >= 86].mean(),
                        test["thin_file"].mean()],
}, index=["fit (0–79)", "model validation (80–85)", "policy validation (86–91)", "test (92–107)"])
split
""")

# Models
md("""
## 3. Models

Three models on the same features, each outputs a probability of default (PD). Training takes a few minutes.
Set `TUNE_TRIALS = 0` to skip the Optuna run.
""")

code("""
TUNE_TRIALS = 20

experiments = [
    {"model_type": "logreg", "name": "Logistic Regression"},
    {"model_type": "random_forest", "name": "Random Forest", "sample_fraction": 0.5},
    {"model_type": "lightgbm", "name": "LightGBM"},
]
if TUNE_TRIALS:
    experiments.append({"model_type": "lightgbm", "name": f"LightGBM + Optuna ({TUNE_TRIALS} trials)",
                        "tune_trials": TUNE_TRIALS})

runs = {}
for settings in experiments:
    info = training.train(settings, log=lambda message: None)
    runs[settings["name"]] = info["run_id"]
    print(f"{settings['name']:32s} trained in {info['train_seconds']:5.1f}s")
""")

code("""
def metrics_table(split_name):
    rows = {}
    for name, run_id in runs.items():
        m = storage.get_run(run_id)["metrics"][split_name]
        rows[name] = {"AUC": m["all"]["auc"], "LogLoss": m["all"]["logloss"], "Brier": m["all"]["brier"],
                      "AUC established": m["established"]["auc"], "AUC thin-file": m["thin_file"]["auc"]}
    return pd.DataFrame(rows).T

validation_metrics = metrics_table("validation")
validation_metrics["AUC vs LR"] = validation_metrics["AUC"] - validation_metrics.loc["Logistic Regression", "AUC"]
print("Validation (policy weeks 86–91):")
validation_metrics
""")

code("""
best_name = validation_metrics["AUC"].idxmax()
best_run = runs[best_name]
print(f"Best model on validation AUC: {best_name}")

importance = pd.DataFrame(storage.get_run(best_run)["feature_importance"]).head(15)
fig, ax = plt.subplots(figsize=(8, 5))
ax.barh(importance["feature"][::-1], importance["importance"][::-1], color=ESTABLISHED)
ax.set(title=f"Top features — {best_name}", xlabel="share of total importance")
plt.tight_layout()
plt.show()
""")

# Decision policy
md("""
## 4. Decision policy

**Cost model:** repaid loan +\\$2,000, default −\\$8,000, denied \\$0. Approving is worth
`(1 − PD) × 2,000 − PD × 8,000`, which is positive only when **PD < 20%**.

**Inclusion gap:** among applicants who actually repaid, approval rate of established minus thin-file (points).

**Inclusive Profit Score** = profit − penalty × |gap| × (applicants / 100k), only if the default rate among approved
loans stays under a ceiling (12%). Penalty: \\$100k per gap point per 100k applicants.

**Second-look policy** (all fitted on the policy-validation weeks 86–91):
1. Calibrate PD separately for thin-file and established (Platt scaling).
2. Drift correction: move each PD along its segment's weekly default-rate trend, estimated on weeks 0–85.
3. One threshold per segment, chosen to maximize the Inclusive Profit Score.
""")

code("""
result = analysis.get_policy_analysis(best_run)
print("Chosen thresholds:", result["options"]["thresholds"])
print("Drift trend (log-odds per week):", {k: round(v, 4) for k, v in result["calibrator"]["trend_per_week"].items()})

def policy_table(split_name):
    rows = {}
    for key, label in [("approve_all", "Approve everyone (naïve)"), ("baseline", "Baseline: raw PD < 20%"),
                       ("calibrated_flat", "Calibrated PD < 20%"), ("second_look", "Second-look policy")]:
        p = result[split_name][key]
        rows[label] = {"profit ($M)": p["profit"] / 1e6, "inclusion gap (pts)": p["inclusion_gap_pts"],
                       "approved": p["approval_rate"], "default rate of approved": p["default_rate_approved"],
                       "good thin-file approved": p["segments"]["thin_file"]["good_approval_rate"],
                       "good established approved": p["segments"]["established"]["good_approval_rate"]}
    return pd.DataFrame(rows).T

print("Validation (policy weeks 86–91) — where the thresholds were chosen:")
policy_table("validation")
""")

md("""
### Final check on the out-of-time test set

Everything above was decided without the test labels. Now score the test set once against `solution.csv`.
""")

code("""
test_policies = policy_table("test")
test_policies
""")

code("""
before, after = result["test"]["baseline"], result["test"]["second_look"]
fig, axes = plt.subplots(1, 3, figsize=(16, 4.2))

labels = ["Baseline", "Second look"]
x = np.arange(2)
est = [before["segments"]["established"]["good_approval_rate"], after["segments"]["established"]["good_approval_rate"]]
thn = [before["segments"]["thin_file"]["good_approval_rate"], after["segments"]["thin_file"]["good_approval_rate"]]
axes[0].bar(x - 0.2, est, 0.38, color=ESTABLISHED, label="established")
axes[0].bar(x + 0.2, thn, 0.38, color=THIN, label="thin-file")
for i in range(2):
    axes[0].text(i - 0.2, est[i] + 0.01, f"{est[i]:.0%}", ha="center", fontsize=9)
    axes[0].text(i + 0.2, thn[i] + 0.01, f"{thn[i]:.0%}", ha="center", fontsize=9)
axes[0].set_xticks(x, labels)
axes[0].set(title="Of applicants who repaid, share approved (test)", ylim=(0, 1))
axes[0].legend()

raw_curve = pd.DataFrame(result["profit_curve"]["raw"])
cal_curve = pd.DataFrame(result["profit_curve"]["calibrated"])
axes[1].plot(raw_curve.threshold, raw_curve.profit / 1e6, color=BASELINE, lw=2, label="raw PD")
axes[1].plot(cal_curve.threshold, cal_curve.profit / 1e6, color=SECOND_LOOK, lw=2, label="calibrated PD")
axes[1].axvline(0.2, color="gray", ls="--", lw=1)
axes[1].set(title="Test profit vs one flat threshold", xlabel="threshold", ylabel="profit ($M)")
axes[1].legend()

raw_cal = pd.DataFrame(result["calibration_table"]["raw"]["thin_file"])
new_cal = pd.DataFrame(result["calibration_table"]["calibrated"]["thin_file"])
axes[2].plot([0, 0.7], [0, 0.7], color="gray", ls="--", lw=1, label="perfect")
axes[2].plot(raw_cal.predicted, raw_cal.actual, "o-", color=BASELINE, label="raw PD")
axes[2].plot(new_cal.predicted, new_cal.actual, "o-", color=SECOND_LOOK, label="calibrated PD")
axes[2].set(title="Thin-file calibration on test", xlabel="predicted PD", ylabel="actual default rate")
axes[2].legend()
plt.tight_layout()
plt.show()

raw_m, cal_m = result["test_metrics"]["raw"]["thin_file"], result["test_metrics"]["calibrated"]["thin_file"]
print(f"Thin-file on test: raw mean PD {raw_m['mean_pd']:.1%}, calibrated {cal_m['mean_pd']:.1%}, "
      f"actual default rate {raw_m['default_rate']:.1%}")
print(f"Profit {before['profit'] / 1e6:.1f}M -> {after['profit'] / 1e6:.1f}M   "
      f"gap {before['inclusion_gap_pts']:.1f} -> {after['inclusion_gap_pts']:.1f} pts   "
      f"good thin-file payers denied {before['segments']['thin_file']['good_denied']:,} -> "
      f"{after['segments']['thin_file']['good_denied']:,}")
""")

code("""
rows = {}
for name, run_id in runs.items():
    run_result = analysis.get_policy_analysis(run_id)
    b, s = run_result["test"]["baseline"], run_result["test"]["second_look"]
    m = storage.get_run(run_id)["metrics"]["test"]["all"]
    rows[name] = {"test AUC": m["auc"], "test LogLoss": m["logloss"],
                  "baseline profit ($M)": b["profit"] / 1e6, "second-look profit ($M)": s["profit"] / 1e6,
                  "baseline gap (pts)": b["inclusion_gap_pts"], "second-look gap (pts)": s["inclusion_gap_pts"]}
print("Every model, test set:")
pd.DataFrame(rows).T
""")

# Conclusions
md("""
## 5. Conclusions

- **Data:** 1M train loans, 19.2% default rate. 30% are thin-file (no bureau history). No leakage, duplicates or
  sentinel values; missing values come almost entirely from thin-file applicants lacking bureau data.
- **The trap:** thin-file default risk falls steadily over time while established risk stays flat. Trained on older weeks,
  every model over-estimates thin-file risk on the later test weeks, and a flat 20% cut-off denies many good thin-file payers.
- **Models:** LightGBM beats the logistic-regression baseline on AUC and LogLoss (success criterion 1). Thin-file AUC
  stays lower than established AUC for every model — there is simply less information about these applicants.
- **Policy:** segment-aware calibration + drift correction + segment thresholds raise profit *and* close the
  inclusion gap, for every model (success criteria 2 and 3).
- **Calibration does most of the work.** Once thin-file PDs are honest, the plain 20% rule is already far fairer and is
  the most profitable policy on test. The per-segment thresholds then trade a little profit for a smaller gap, but they
  are tuned on only 6 weeks, so they are noisier: on test they can overshoot (thin-file approved more often than
  established — a negative gap). The penalty in the Inclusive Profit Score sets how much profit we give up for fairness.
- **Method:** the model was chosen on validation AUC, and calibration and thresholds on weeks 86–91 only; the test set
  was scored once.

**Limitations and next steps:** the drift correction assumes the weekly trend continues in a straight line; a real
deployment would re-estimate it as new outcomes arrive. Confidence intervals for profit and gap (bootstrap) and
week-by-week AUC stability would strengthen the result.
""")

notebook = new_notebook(cells=cells, metadata={
    "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
    "language_info": {"name": "python"},
    "colab": {"provenance": []},
})

if "--run" in sys.argv:
    from nbclient import NotebookClient
    NotebookClient(notebook, timeout=1800, kernel_name="python3", resources={"metadata": {"path": str(HERE)}}).execute()

nbformat.write(notebook, OUTPUT)
print(f"Wrote {OUTPUT}")
