"""Score applicants with the saved LightGBM models, without retraining.

Usage (from notebooks/model_building/lightgbm/, or with that folder on sys.path):

    import pandas as pd
    from score import score, decide

    df = pd.read_parquet("../../../data/processed/features_test.parquet")   # notebook 04 output
    df["pd"] = score(df)          # calibrated probability of default (needs the thin_file column)
    df["approve"] = decide(df)    # True if PD < 20% cutoff

The input must have the columns listed in models/model_inputs.json (the notebook 04 feature table has them all).
"""
import json
from functools import lru_cache
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

MODELS = Path(__file__).resolve().parent / "models"


@lru_cache(maxsize=None)
def _load():
    inputs = json.loads((MODELS / "model_inputs.json").read_text())
    calibration = json.loads((MODELS / "calibration.json").read_text())
    return {
        "inputs": inputs,
        "calibration": calibration,
        "final": lgb.Booster(model_file=str(MODELS / "lightgbm_final.txt")),
        "base": lgb.Booster(model_file=str(MODELS / calibration["base_model"])),
    }


def prepare(df):
    """Select the model's features and give text columns the exact category lists used in training."""
    inputs = _load()["inputs"]
    X = df[inputs["features"]].copy()
    for col, cats in inputs["categorical_categories"].items():
        X[col] = pd.Categorical(X[col], categories=cats)
    return X


def score(df, calibrated=True):
    """Probability of default per row.

    calibrated=True  -> recommended model: weeks 0-67 LightGBM + per-segment calibration (needs df["thin_file"])
    calibrated=False -> main LightGBM trained on weeks 0-79, no calibration
    """
    m = _load()
    X = prepare(df)
    if not calibrated:
        return m["final"].predict(X)
    p = np.clip(m["base"].predict(X), 1e-6, 1 - 1e-6)
    log_odds = np.log(p / (1 - p))
    thin = df["thin_file"].to_numpy() == 1
    out = np.empty_like(p)
    for name, mask in [("thin_file", thin), ("established", ~thin)]:
        a, b = m["calibration"]["segments"][name]["a"], m["calibration"]["segments"][name]["b"]
        out[mask] = 1 / (1 + np.exp(-(a * log_odds[mask] + b)))
    return out


def decide(df, calibrated=True):
    """Approve (True) if the probability of default is below the 20% break-even cutoff."""
    return score(df, calibrated) < _load()["calibration"]["cutoff"]
