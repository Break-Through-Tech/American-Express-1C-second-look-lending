"""Numbers for the Business dashboard: the primary model alone vs the pipeline with Second Look."""
import numpy as np

from app import analysis, config, policy, scoring, storage


def decisions(run_id):
    """Recent-week applications with two decisions: the primary model alone, and the full pipeline with Second Look."""
    settings = scoring.get_settings()
    df = storage.load_predictions(run_id, "test")[["case_id", "WEEK_NUM", "thin_file", "target"]]
    df["primary_pd"] = df["case_id"].map(scoring.primary_scores())
    df = df.join(scoring.second_look_scores(), on="case_id")

    df["baseline"] = df["primary_pd"] < settings["primary_cutoff"]                   # primary model only
    df["second_look"] = df["baseline"] | (df["pd_calibrated"] < df["cutoff"])        # primary, then Second Look
    df["in_review"] = ~df["second_look"] & (df["pd_calibrated"] - df["cutoff"] <= settings["review_band"])
    return df


def outcome(df, approved):
    """Profit, approval and fairness numbers for any set of approve/deny decisions."""
    # evaluate_policy approves when a score is under the threshold, so approved = score 0, declined = score 1
    return policy.evaluate_policy(df.assign(decision=np.where(approved, 0.0, 1.0)), "decision", 0.5, 0.5)


def profit(approved, defaulted):
    return int((approved & ~defaulted).sum()) * config.GAIN_REPAID - int((approved & defaulted).sum()) * config.LOSS_DEFAULT


def dashboard(run_id):
    df = decisions(run_id)
    published = analysis.get_policy_analysis(run_id)
    defaulted = df["target"] == 1
    thin = df["thin_file"] == 1

    # Week by week: profit and approval rates under both policies
    weekly = []
    for week, part in df.groupby("WEEK_NUM"):
        part_default = part["target"] == 1
        part_thin = part["thin_file"] == 1
        weekly.append({
            "week": int(week),
            "profit_baseline": profit(part["baseline"], part_default),
            "profit_second_look": profit(part["second_look"], part_default),
            "approval_established": float(part.loc[~part_thin, "second_look"].mean()),
            "approval_thin_file": float(part.loc[part_thin, "second_look"].mean()),
        })

    # First-time borrowers the primary model declined and Second Look approved
    rescued = thin & df["second_look"] & ~df["baseline"]
    return {
        "run_id": run_id,
        "weeks": [int(df["WEEK_NUM"].min()), int(df["WEEK_NUM"].max())],
        "applications": len(df),
        "thin_file_share": float(thin.mean()),
        "thresholds": published["options"]["thresholds"],
        "penalty": published["options"]["penalty"],
        "ceiling": published["options"]["ceiling"],
        "primary_cutoff": scoring.get_settings()["primary_cutoff"],
        "roles": storage.get_model_roles(),
        "in_review": int(df["in_review"].sum()),
        "baseline": outcome(df, df["baseline"]),
        "second_look": outcome(df, df["second_look"]),
        "rescued": {"count": int(rescued.sum()), "repaid": int((rescued & ~defaulted).sum())},
        "weekly": weekly,
    }
