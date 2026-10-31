"""Saves and loads runs; each run is a folder under artifacts/runs/."""
import json
import re
import shutil

import joblib
import pandas as pd

from app import config

_model_cache = {}


def run_folder(run_id):
    # Strict ids only, so a crafted id like ".." can't escape the runs folder
    if not re.fullmatch(r"[A-Za-z0-9-]+", run_id):
        raise KeyError(f"Run {run_id} not found")
    folder = config.RUNS_DIR / run_id
    if not folder.exists():
        raise KeyError(f"Run {run_id} not found")
    return folder


def save_json(path, data):
    path.write_text(json.dumps(data, indent=2, default=float))


def read_json(path):
    return json.loads(path.read_text()) if path.exists() else None


def list_runs():
    runs = []
    for folder in sorted(config.RUNS_DIR.iterdir(), reverse=True):
        info = read_json(folder / "info.json")
        if info:
            # The big fields are fetched per run, not in the list
            info.pop("feature_importance", None)
            info.pop("learning_curve", None)
            policy = read_json(folder / "policy.json")
            info["policy_summary"] = policy["summary"] if policy else None
            runs.append(info)
    return runs


def get_run(run_id):
    return read_json(run_folder(run_id) / "info.json")


def delete_run(run_id):
    shutil.rmtree(run_folder(run_id))
    _model_cache.pop(run_id, None)


def load_model(run_id):
    if run_id not in _model_cache:
        _model_cache[run_id] = joblib.load(run_folder(run_id) / "model.joblib")
    return _model_cache[run_id]


def load_predictions(run_id, split):
    """Saved predictions for 'val' or 'test' (case_id, WEEK_NUM, thin_file, target, pd)."""
    return pd.read_parquet(run_folder(run_id) / f"{split}_predictions.parquet")
