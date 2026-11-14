"""Online loan applications: saves what the applicant typed and turns it into one feature row for the models."""
import json
import sqlite3
from datetime import date, datetime
from functools import lru_cache

import numpy as np

from app import config, features

DB_PATH = config.ARTIFACTS_DIR / "workflow.db"
FIRST_ID = 9_000_001          # far above the dataset's case ids, so they never clash
ANNUAL_RATE = 0.12            # used only to estimate the monthly payment shown on the form
# Where each credit score band sits among established applicants' bureau risk scores (higher = riskier)
CREDIT_RATING_PERCENTILE = {"excellent": 0.1, "very good": 0.3, "good": 0.5, "fair": 0.7, "poor": 0.9}


# Features that come from the applicant's answers; everything else is a typical value, so never shown as a reason
FROM_FORM = {
    "credamount_770A", "annuity_780A", "age_years", "mainoccupationinc_384A", "days_employed_700P",
    "person_count", "person_mainoccupationinc_384A_sum", "tax_rowcount", "tax_amount_4527230A_mean",
    "tax_amount_4527230A_max", "tax_amount_4527230A_sum", "prev_app_count", "has_prior_app", "bureau_rowcount",
    "bureau_pmts_dpdvalue_108P_max", "bureau_pmts_dpdvalue_108P_mean", "bureau_dpd_over_30_sum",
    "numberofqueries_146L", "riskassesment_940T", "thin_file", "has_bureau_summary", "external_coverage",
    "annuity_to_income", "credit_to_income", "tax_to_stated_income",
}


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS applications (
            case_id INTEGER PRIMARY KEY,
            submitted_at TEXT,
            form TEXT
        )
    """)
    return conn


def is_online(case_id):
    return case_id >= FIRST_ID


def monthly_payment(amount, months):
    """Standard loan payment formula (same amount every month)."""
    rate = ANNUAL_RATE / 12
    return amount * rate / (1 - (1 + rate) ** -months)


def online_week():
    """Online applications count as the week after the newest data."""
    return int(features.load_features("test")["WEEK_NUM"].max()) + 1


@lru_cache(maxsize=2)
def typical_applicant(thin_file):
    """Median values (most common for categories) of recent applicants in the same segment."""
    test = features.load_features("test")
    group = test[test["thin_file"] == int(thin_file)]
    row = group.median(numeric_only=True)
    for col in features.CATEGORICAL_FEATURES:
        row[col] = group[col].mode().iloc[0]
    return row


@lru_cache(maxsize=4)
def bureau_score(rating):
    test = features.load_features("test")
    return float(test.loc[test["thin_file"] == 0, "riskassesment_940T"].quantile(CREDIT_RATING_PERCENTILE[rating]))


def save(form):
    with connect() as conn:
        last = conn.execute("SELECT MAX(case_id) FROM applications").fetchone()[0]
        case_id = (last or FIRST_ID - 1) + 1
        conn.execute("INSERT INTO applications (case_id, submitted_at, form) VALUES (?, ?, ?)",
                     (case_id, datetime.now().isoformat(timespec="seconds"), json.dumps(form)))
    return case_id


def get_form(case_id):
    with connect() as conn:
        row = conn.execute("SELECT * FROM applications WHERE case_id = ?", (case_id,)).fetchone()
    if row is None:
        raise KeyError(f"case_id {case_id} not found")
    return {**json.loads(row["form"]), "submitted_at": row["submitted_at"]}


def feature_row(case_id):
    """The application as the models see it: a typical applicant like this one, with the form's answers on top."""
    form = get_form(case_id)
    thin = not form["has_credit_history"]
    row = typical_applicant(thin).copy()

    # The loan
    row["credamount_770A"] = form["loan_amount"]
    row["annuity_780A"] = monthly_payment(form["loan_amount"], form["term_months"])

    # The applicant
    born = date.fromisoformat(form["date_of_birth"])
    row["age_years"] = (date.today() - born).days / 365.25
    row["mainoccupationinc_384A"] = form["annual_income"]
    row["days_employed_700P"] = form["years_employed"] * 365.25
    row["person_count"] = 1  # online applications have one applicant
    row["person_mainoccupationinc_384A_sum"] = form["annual_income"]

    # Tax records (optional)
    tax = form.get("tax_declared_income")
    row["tax_rowcount"] = 1 if tax else 0
    for stat in ["mean", "max", "sum"]:
        row[f"tax_amount_4527230A_{stat}"] = tax if tax else np.nan

    # Earlier loans with us
    row["prev_app_count"] = form["previous_loans"]
    if form["previous_loans"] == 0:
        for col in [c for c in row.index if c.startswith("prev_") and c != "prev_app_count"]:
            row[col] = np.nan

    # Credit history: a bank pulls this from the credit bureau; here the applicant's answers stand in for it
    # (a typical first-time borrower already has no bureau values, so only the established case needs filling)
    if not thin:
        late = form.get("worst_days_late") or 0
        row["bureau_rowcount"] = form["credit_accounts"]
        row["bureau_pmts_dpdvalue_108P_max"] = late
        row["bureau_pmts_dpdvalue_108P_mean"] = late / 2
        row["bureau_dpd_over_30_sum"] = 1 if late > 30 else 0
        row["numberofqueries_146L"] = form.get("credit_checks_last_year") or 0
        row["riskassesment_940T"] = bureau_score(form["credit_rating"])

    row["case_id"] = case_id
    row["WEEK_NUM"] = online_week()
    row["thin_file"] = int(thin)
    row["target"] = np.nan
    df = row.to_frame().T.infer_objects()
    for col in features.CATEGORICAL_FEATURES:
        df[col] = df[col].astype("category")
    return features.add_derived_features(df)


def public_details(case_id):
    """What the applicant and the reviewer see about the application itself."""
    form = get_form(case_id)
    return {
        "first_name": form["first_name"],
        "last_name": form["last_name"],
        "loan_amount": form["loan_amount"],
        "purpose": form["purpose"],
        "term_months": form["term_months"],
        "employment": form["employment"],
        "submitted_at": form["submitted_at"],
    }
