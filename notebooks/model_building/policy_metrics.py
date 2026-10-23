"""Shared scoring rules for the model-building notebooks (01 primary model, 03 second look).

Every model and every approval policy is scored the same way, on the same weeks, so results can be compared row by row.
"""
import numpy as np
from sklearn.metrics import accuracy_score, brier_score_loss, f1_score, log_loss, roc_auc_score

# Challenge economics: +$2,000 per repaid approved loan, -$8,000 per defaulted approved loan, $0 if declined.
GAIN, LOSS = 2_000, -8_000
# Break-even default probability: 2000 - 10000 p = 0  ->  p = 0.20
CUTOFF = 0.20


def evaluate_scores(y, p, thin):
    """Quality of predicted default probabilities (PD): ranking and probability accuracy, overall and per segment."""
    y, p, thin = np.asarray(y), np.asarray(p), np.asarray(thin) == 1
    return {
        "AUC": roc_auc_score(y, p),
        "AUC thin": roc_auc_score(y[thin], p[thin]),
        "AUC est": roc_auc_score(y[~thin], p[~thin]),
        "LogLoss": log_loss(y, p),
        "Brier": brier_score_loss(y, p),
        "Pred-actual thin pp": (p[thin].mean() - y[thin].mean()) * 100,
        "Pred-actual est pp": (p[~thin].mean() - y[~thin].mean()) * 100,
    }


def evaluate_decisions(y, approve, thin):
    """Business results of approve/decline decisions (from any policy, one stage or two)."""
    y, approve, thin = np.asarray(y), np.asarray(approve, dtype=bool), np.asarray(thin) == 1
    repaid = y == 0
    approved_est = approve[repaid & ~thin].mean()
    approved_thin = approve[repaid & thin].mean()
    return {
        "Approval %": approve.mean() * 100,
        "Default % approved": y[approve].mean() * 100,
        "Profit $M": (GAIN * (approve & repaid).sum() + LOSS * (approve & ~repaid).sum()) / 1e6,
        "Approved repayers est %": approved_est * 100,
        "Approved repayers thin %": approved_thin * 100,
        "Inclusion gap pp": (approved_est - approved_thin) * 100,
        # Task #3 metrics. Class 1 = default, so a "positive" prediction is a decline.
        "Accuracy": accuracy_score(y, ~approve),
        "F1": f1_score(y, ~approve),
    }
