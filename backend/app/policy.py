"""Turns PDs into approve/deny decisions and measures profit and the inclusion gap."""
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score

from app import config

PENALTY_PER_APPLICANTS = 100_000  # the gap penalty is quoted per 100k applicants


# Probability <-> log-odds; calibration and drift do their maths in log-odds
def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def sigmoid(z):
    return 1 / (1 + np.exp(-z))


# Model quality

def model_metrics(y, pd_values):
    return {
        "auc": float(roc_auc_score(y, pd_values)),
        "logloss": float(log_loss(y, np.clip(pd_values, 1e-6, 1 - 1e-6))),
        "brier": float(brier_score_loss(y, pd_values)),
        "default_rate": float(np.mean(y)),
        "mean_pd": float(np.mean(pd_values)),
        "n": int(len(y)),
    }


def metrics_by_segment(df, pd_col="pd"):
    thin = df["thin_file"] == 1
    return {
        "all": model_metrics(df["target"], df[pd_col]),
        "established": model_metrics(df.loc[~thin, "target"], df.loc[~thin, pd_col]),
        "thin_file": model_metrics(df.loc[thin, "target"], df.loc[thin, pd_col]),
    }


def calibration_table(df, pd_col="pd", bins=10):
    """Predicted vs actual default rate by PD decile, per segment."""
    result = {}
    for name, part in [("established", df[df["thin_file"] == 0]), ("thin_file", df[df["thin_file"] == 1])]:
        decile = pd.qcut(part[pd_col], bins, labels=False, duplicates="drop")
        table = part.groupby(decile).agg(predicted=(pd_col, "mean"), actual=("target", "mean"))
        result[name] = table.round(4).to_dict("records")
    return result


# Calibration

def default_rate_trend(history):
    """Weekly change in default rate per segment, in log-odds."""
    trend = {}
    for segment in [0, 1]:
        weekly = history[history["thin_file"] == segment].groupby("WEEK_NUM")["target"].mean()
        # Straight line through the weekly log-odds; its slope is the drift per week
        slope, _ = np.polyfit(weekly.index, logit(weekly.values), 1)
        trend[segment] = float(slope)
    return trend


class Calibrator:
    """Re-maps PDs to match reality (none / platt / isotonic), per segment, with an optional drift shift."""

    def __init__(self, method="platt", per_segment=True, drift=True):
        self.method = method
        self.per_segment = per_segment
        self.drift = drift
        self.models = {}
        self.trend = {0: 0.0, 1: 0.0}
        self.val_mean_week = 0.0

    def groups(self, df):
        # Rows covered by each calibration model: one per segment, or one for everyone
        if self.per_segment:
            return {0: df["thin_file"] == 0, 1: df["thin_file"] == 1}
        return {"all": pd.Series(True, index=df.index)}

    def fit(self, val_df, history):
        self.val_mean_week = float(val_df["WEEK_NUM"].mean())
        if self.drift:
            self.trend = default_rate_trend(history)

        for key, mask in self.groups(val_df).items():
            pd_values, y = val_df.loc[mask, "pd"].values, val_df.loc[mask, "target"].values
            if self.method == "platt":
                # Platt scaling: a one-feature logistic regression on the model's own log-odds
                model = LogisticRegression()
                model.fit(logit(pd_values).reshape(-1, 1), y)
            elif self.method == "isotonic":
                # Isotonic: a step function that can only go up, fitted to the real outcomes
                model = IsotonicRegression(out_of_bounds="clip", y_min=1e-6, y_max=1 - 1e-6)
                model.fit(pd_values, y)
            else:
                model = None
            self.models[key] = model
        return self

    def transform(self, df):
        result = df["pd"].values.astype(float).copy()

        for key, mask in self.groups(df).items():
            model = self.models.get(key)
            mask = mask.values
            if not mask.any():
                continue
            if self.method == "platt":
                result[mask] = model.predict_proba(logit(result[mask]).reshape(-1, 1))[:, 1]
            elif self.method == "isotonic":
                result[mask] = model.predict(result[mask])

        # Slide each PD along its segment's trend, from the validation weeks to the loan's own week
        if self.drift:
            weeks_ahead = df["WEEK_NUM"].values - self.val_mean_week
            slope = np.where(df["thin_file"].values == 1, self.trend[1], self.trend[0])
            result = sigmoid(logit(result) + slope * weeks_ahead)

        return np.clip(result, 1e-6, 1 - 1e-6)

    def describe(self):
        return {
            "method": self.method,
            "per_segment": self.per_segment,
            "drift": self.drift,
            "trend_per_week": {"established": self.trend[0], "thin_file": self.trend[1]},
            "validation_mean_week": self.val_mean_week,
        }


# Decisions

def evaluate_policy(df, pd_col, threshold_est, threshold_thin, penalty=0.0, ceiling=None):
    """Approve when PD is under the segment's threshold, then count the real profit."""
    y = df["target"].values
    pd_values = df[pd_col].values
    thin = df["thin_file"].values == 1
    approve = np.where(thin, pd_values < threshold_thin, pd_values < threshold_est)
    good = y == 0

    profit_each = np.where(approve, np.where(good, config.GAIN_REPAID, -config.LOSS_DEFAULT), 0)
    profit = float(profit_each.sum())

    segments = {}
    for name, mask in [("established", ~thin), ("thin_file", thin)]:
        segments[name] = {
            "n": int(mask.sum()),
            "approval_rate": float(approve[mask].mean()),
            "good_approval_rate": float(approve[mask & good].mean()),  # of people who repay, % approved
            "good_denied": int((mask & good & ~approve).sum()),
            "default_rate_approved": float(y[mask & approve].mean()) if (mask & approve).any() else 0.0,
            "profit": float(profit_each[mask].sum()),
        }

    # Inclusion gap: approval rate among repayers, established minus thin-file, in points
    gap_pts = 100 * (segments["established"]["good_approval_rate"] - segments["thin_file"]["good_approval_rate"])
    default_rate_approved = float(y[approve].mean()) if approve.any() else 0.0
    ceiling_ok = ceiling is None or default_rate_approved <= ceiling
    score = profit - penalty * abs(gap_pts) * len(df) / PENALTY_PER_APPLICANTS

    return {
        "thresholds": {"established": threshold_est, "thin_file": threshold_thin},
        "n": len(df),
        "approval_rate": float(approve.mean()),
        "default_rate_approved": default_rate_approved,
        "profit": profit,
        "inclusion_gap_pts": float(gap_pts),
        "inclusive_profit_score": float(score) if ceiling_ok else None,
        "ceiling_ok": ceiling_ok,
        "segments": segments,
    }


def profit_curve(df, pd_col):
    """Profit and gap for a single flat threshold from 2% to 60%."""
    rows = []
    for t in np.arange(0.02, 0.605, 0.01):
        r = evaluate_policy(df, pd_col, t, t)
        rows.append({
            "threshold": round(float(t), 2),
            "profit": r["profit"],
            "approval_rate": r["approval_rate"],
            "default_rate_approved": r["default_rate_approved"],
            "inclusion_gap_pts": r["inclusion_gap_pts"],
        })
    return rows


def segment_stats(part, pd_col, threshold):
    approve = part[pd_col].values < threshold
    y = part["target"].values
    return {
        "approved": approve.sum(),
        "defaults": (approve & (y == 1)).sum(),
        "good_rate": approve[y == 0].mean(),
        "profit": (approve & (y == 0)).sum() * config.GAIN_REPAID - (approve & (y == 1)).sum() * config.LOSS_DEFAULT,
    }


def find_best_thresholds(df, pd_col, penalty, ceiling):
    """Try every threshold pair and keep the best Inclusive Profit Score."""
    candidates = np.round(np.arange(0.05, 0.505, 0.005), 3)
    established = df[df["thin_file"] == 0]
    thin = df[df["thin_file"] == 1]
    # Segments don't affect each other, so score each threshold once per segment
    est_stats = {t: segment_stats(established, pd_col, t) for t in candidates}
    thin_stats = {t: segment_stats(thin, pd_col, t) for t in candidates}

    best, best_score = None, -np.inf
    for t_est, e in est_stats.items():
        for t_thin, t in thin_stats.items():
            approved = e["approved"] + t["approved"]
            default_rate = (e["defaults"] + t["defaults"]) / approved if approved else 0
            if ceiling is not None and default_rate > ceiling:
                continue
            gap_pts = 100 * (e["good_rate"] - t["good_rate"])
            score = e["profit"] + t["profit"] - penalty * abs(gap_pts) * len(df) / PENALTY_PER_APPLICANTS
            if score > best_score:
                best, best_score = {"established": float(t_est), "thin_file": float(t_thin)}, score
    if best is None:
        raise ValueError("No thresholds meet the default-rate ceiling. Try a higher ceiling.")
    return best
