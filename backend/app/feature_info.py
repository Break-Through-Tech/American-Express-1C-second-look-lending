"""Plain-English descriptions of the tables, raw columns and model features."""
import pandas as pd

from app import config
from app.features import CATEGORICAL_FEATURES

SUFFIX_MEANING = {
    "A": "amount of money",
    "P": "days past due (lateness)",
    "D": "date",
    "M": "masked category (a real category shown as a hash)",
    "L": "other transformed number",
    "T": "other transformed number",
}

# What each table holds, based on the dataset guide
TABLE_INFO = {
    "base": {
        "depth": 0,
        "title": "The spine",
        "what": "The master list of loans: one row per application, with the date and the answer (target).",
        "why": "Everything else joins onto this table with case_id. target = 1 means the loan defaulted.",
    },
    "static_0": {
        "depth": 0,
        "title": "Applicant snapshot",
        "what": "Facts known at the moment of the decision: income, requested credit, payment size, job length, education.",
        "why": "Every applicant has this row, so these features work for thin-file applicants too.",
    },
    "static_cb_0": {
        "depth": 0,
        "title": "Bureau summary",
        "what": "The credit bureau's own risk score and how often the applicant's credit was checked recently.",
        "why": "Only people with credit history have a row here. A missing row is itself a signal: thin-file.",
    },
    "person_1": {
        "depth": 1,
        "title": "People on the application",
        "what": "One row per person: the applicant and sometimes a co-applicant (num_group1 numbers them).",
        "why": "Aggregated to household income, employment length and the main applicant's housing type.",
    },
    "credit_bureau_a_1": {
        "depth": 1,
        "title": "Past credit contracts",
        "what": "One row per past loan or card the bureau knows about: its size, worst overdue balance, how late payments were.",
        "why": "The most predictive table. Thin-file applicants have zero rows here; that is the definition of thin-file.",
    },
    "credit_bureau_a_2": {
        "depth": 2,
        "title": "Monthly payment history",
        "what": "Inside each past contract: one row per month with the overdue amount. Indexed by contract and month.",
        "why": "The largest table. Aggregated to 'how often and how much was the applicant overdue'.",
    },
    "applprev_1": {
        "depth": 1,
        "title": "Earlier applications to this lender",
        "what": "The applicant's own earlier applications here, approved or not. First-time applicants have none.",
        "why": "Internal history: one of the few signals that still exists for thin-file applicants.",
    },
    "tax_registry_a_1": {
        "depth": 1,
        "title": "Declared income records",
        "what": "Official tax / income declarations: a cross-check on the income the applicant claims.",
        "why": "Also available for many thin-file applicants, so it helps the model read them.",
    },
}

TABLE_ORDER = list(TABLE_INFO)

FEATURE_SOURCES = {
    "bureau": "credit_bureau_a_1",
    "payments": "credit_bureau_a_2",
    "prev": "applprev_1",
    "tax": "tax_registry_a_1",
    "person": "person_1",
}
STATS = {"mean": "Average", "max": "Largest", "min": "Smallest", "sum": "Total", "count": "Count"}

# Features that aren't just a statistic of one column
SPECIAL_FEATURES = {
    "age_years": ("static_0", "Age in years at the decision date (date_decision − birth_259D)."),
    "person_count": ("person_1", "Number of person records (1 = applicant only, 2 = with co-applicant)."),
    "housingtype_772M": ("person_1", "Housing type of the main applicant (num_group1 = 0)."),
    "bureau_rowcount": ("credit_bureau_a_1", "Number of past credit contracts. 0 = thin-file."),
    "bureau_dpd_over_30_sum": ("credit_bureau_a_1", "Number of past contracts more than 30 days past due."),
    "payments_rowcount": ("credit_bureau_a_2", "Number of monthly payment records."),
    "payments_is_overdue_mean": ("credit_bureau_a_2", "Share of payment records with an overdue amount > 0."),
    "prev_app_count": ("applprev_1", "Number of earlier applications to this lender."),
    "prev_was_approved_sum": ("applprev_1", "Number of earlier applications that were approved."),
    "prev_days_since_approval_min": ("applprev_1", "Days from the most recent earlier approval to this decision."),
    "tax_rowcount": ("tax_registry_a_1", "Number of tax / income declarations."),
    "thin_file": ("derived", "1 if the applicant has no credit_bureau_a_1 rows (thin-file segment), else 0."),
    "has_bureau_summary": ("derived", "1 if the bureau risk score (riskassesment_940T) is present."),
    "has_prior_app": ("derived", "1 if prev_app_count > 0."),
    "external_coverage": ("derived", "bureau_rowcount + prev_app_count + tax_rowcount: how much outside data exists."),
    "annuity_to_income": ("derived", "annuity_780A / mainoccupationinc_384A (payment burden)."),
    "credit_to_income": ("derived", "credamount_770A / mainoccupationinc_384A."),
    "tax_to_stated_income": ("derived", "Average declared tax income / stated income (does the claim match the records?)."),
}

_definitions = {}


def column_definitions():
    """(table, column) -> description from feature_definitions.csv."""
    if not _definitions:
        df = pd.read_csv(config.DATA_DIR / "feature_definitions.csv")
        for row in df.itertuples():
            _definitions[(row.table, row.column)] = row.description
    return _definitions


def suffix_of(column):
    """Type letter at the end of a raw column name, e.g. credamount_770A -> A."""
    last = column[-1]
    if last in SUFFIX_MEANING and column[-2].isdigit():
        return last
    return None


def describe_feature(name):
    """(source table, plain-English meaning) for a model feature."""
    # Columns that only exist inside logistic regression's preprocessing
    if name.startswith("missingindicator_"):
        column = name[len("missingindicator_"):]
        return describe_feature(column)[0], f"1 if {column} is missing (a flag added for logistic regression)."
    for column in CATEGORICAL_FEATURES:
        if name.startswith(column + "_"):
            value = name[len(column) + 1:]
            return describe_feature(column)[0], f"1 if {column} = {value} (one-hot column for logistic regression)."

    if name in SPECIAL_FEATURES:
        return SPECIAL_FEATURES[name]
    for table in ("static_0", "static_cb_0"):
        if (table, name) in column_definitions():
            return table, column_definitions()[(table, name)]
    prefix, _, rest = name.partition("_")
    if prefix not in FEATURE_SOURCES:
        return "derived", ""
    table = FEATURE_SOURCES[prefix]
    if "_share_" in rest:
        column, value = rest.split("_share_")
        return table, f"Share of the applicant's rows where {column} = {value}."
    column, stat = rest.rsplit("_", 1)
    return table, f"{STATS.get(stat, stat)} of {column} over the applicant's rows."
