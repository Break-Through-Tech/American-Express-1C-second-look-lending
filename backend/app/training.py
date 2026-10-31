"""Trains one PD model end to end and saves it as a run."""
import time
import uuid
from datetime import datetime

import joblib
import optuna
from sklearn.metrics import roc_auc_score

from app import analysis, config, features, policy, storage
from app.models import MODEL_NAMES, PDModel, suggest_params

PREDICTION_COLS = ["case_id", "WEEK_NUM", "thin_file", "target"]

# Steps shown in the live view on the Train page
STEPS = [
    "Load features",
    "Split by week",
    "Tune settings (Optuna)",
    "Train the model",
    "Score validation and test",
    "Calibrate and pick thresholds",
    "Finished",
]


def take_sample(df, fraction):
    """Random sample that keeps the thin-file and default mix intact."""
    if fraction >= 1:
        return df
    return df.groupby(["thin_file", "target"], group_keys=False).sample(frac=fraction, random_state=config.RANDOM_STATE)


def tune_with_optuna(model_type, params, train_df, val_df, feature_cols, n_trials, log, progress, live):
    optuna.logging.set_verbosity(optuna.logging.WARNING)

    def objective(trial):
        trial_params = {**params, **suggest_params(model_type, trial)}
        model = PDModel(model_type, trial_params, feature_cols).fit(train_df, val_df, log=lambda msg: None)
        return roc_auc_score(val_df["target"], model.predict_pd(val_df))

    def after_trial(study, trial):
        log(f"  trial {trial.number + 1}/{n_trials}: AUC {trial.value:.4f}  {trial.params}")
        live["trials"].append({"trial": trial.number + 1, "auc": trial.value, "best_auc": study.best_value,
                               "params": trial.params})
        progress(0.1 + 0.5 * (trial.number + 1) / n_trials)

    study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=config.RANDOM_STATE))
    study.optimize(objective, n_trials=n_trials, callbacks=[after_trial])
    log(f"Best AUC {study.best_value:.4f} with {study.best_params}")
    return {**params, **study.best_params}


def train(settings, log=print, progress=lambda x: None, live=None):
    """Train a run from the settings dict; `live` gets progress updates for the UI."""
    start_time = time.time()
    model_type = settings["model_type"]
    params = settings.get("params") or {}
    val_start_week = settings.get("val_start_week") or config.VAL_START_WEEK
    policy_start_week = settings.get("policy_start_week") or config.POLICY_START_WEEK
    sample_fraction = settings.get("sample_fraction") or 1.0
    tune_trials = settings.get("tune_trials") or 0
    if not val_start_week < policy_start_week <= 91:
        raise ValueError("Need val_start_week < policy_start_week <= 91")

    live = live if live is not None else {}
    live.update(steps=STEPS, step=0, skipped=[] if tune_trials else [2], model_type=model_type,
                split=None, trials=[], curve=[], result=None)

    log("Loading features...")
    train_all = features.load_features("train", log=log)
    test_df = features.load_features("test", log=log)
    feature_cols = features.feature_columns(train_all)

    # Split by week: fit / model validation / policy validation (see config.py)
    week = train_all["WEEK_NUM"]
    train_df = take_sample(train_all[week < val_start_week], sample_fraction)
    stop_df = train_all[(week >= val_start_week) & (week < policy_start_week)]
    val_df = train_all[week >= policy_start_week]
    log(f"Fit: {len(train_df):,} rows (weeks < {val_start_week}) | "
        f"model validation: {len(stop_df):,} rows (weeks {val_start_week}-{policy_start_week - 1}) | "
        f"policy validation: {len(val_df):,} rows (weeks {policy_start_week}-91) | {len(feature_cols)} features")
    live["step"] = 1
    live["split"] = [
        {"name": "Fit", "weeks": f"0–{val_start_week - 1}", "loans": len(train_df)},
        {"name": "Model validation", "weeks": f"{val_start_week}–{policy_start_week - 1}", "loans": len(stop_df)},
        {"name": "Policy validation", "weeks": f"{policy_start_week}–91", "loans": len(val_df)},
        {"name": "Test", "weeks": "92–107", "loans": len(test_df)},
    ]
    progress(0.1)

    if tune_trials > 0:
        live["step"] = 2
        log(f"Tuning with Optuna: {tune_trials} trials on a 25% sample, scored on model validation weeks")
        params = tune_with_optuna(model_type, params, take_sample(train_df, 0.25), stop_df,
                                  feature_cols, tune_trials, log, progress, live)

    live["step"] = 3
    log(f"Training {MODEL_NAMES[model_type]}...")

    def on_tree(trees, auc):
        live["curve"].append({"trees": trees, "auc": float(auc)})

    model = PDModel(model_type, params, feature_cols).fit(train_df, stop_df, log=log, on_progress=on_tree)
    progress(0.75)

    live["step"] = 4
    log("Predicting validation and test sets...")
    val_pred = val_df[PREDICTION_COLS].copy()
    val_pred["pd"] = model.predict_pd(val_df)
    test_pred = test_df[PREDICTION_COLS].copy()
    test_pred["pd"] = model.predict_pd(test_df)
    test_pred["target"] = test_pred["case_id"].map(features.load_solution())

    run_id = datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
    folder = config.RUNS_DIR / run_id
    folder.mkdir()
    joblib.dump(model, folder / "model.joblib", compress=3)
    val_pred.to_parquet(folder / "val_predictions.parquet", index=False)
    test_pred.to_parquet(folder / "test_predictions.parquet", index=False)
    # Labelled weeks before the policy window, used later to measure drift
    train_all.loc[week < policy_start_week, ["WEEK_NUM", "thin_file", "target"]] \
        .to_parquet(folder / "history.parquet", index=False)

    info = {
        "run_id": run_id,
        "name": settings.get("name") or f"{MODEL_NAMES[model_type]} {run_id[-4:]}",
        "model_type": model_type,
        "model_name": MODEL_NAMES[model_type],
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "train_seconds": round(time.time() - start_time, 1),
        "settings": {"val_start_week": val_start_week, "policy_start_week": policy_start_week,
                     "sample_fraction": sample_fraction, "tune_trials": tune_trials},
        "params": model.params,
        "best_iteration": model.best_iteration,
        "solver_iterations": model.solver_iterations,
        "n_train": len(train_df),
        "n_features": len(feature_cols),
        "metrics": {
            "validation": policy.metrics_by_segment(val_pred),
            "test": policy.metrics_by_segment(test_pred),
        },
        "feature_importance": model.feature_importance(),
        "learning_curve": model.learning_curve,
    }
    storage.save_json(folder / "info.json", info)
    log(f"Validation AUC {info['metrics']['validation']['all']['auc']:.4f}, "
        f"test AUC {info['metrics']['test']['all']['auc']:.4f}")

    live["step"] = 5
    log("Running the default second-look policy...")
    analysis.run_policy_analysis(run_id, {})
    live["step"] = 6
    live["result"] = {"run_id": run_id, "validation_auc": info["metrics"]["validation"]["all"]["auc"],
                      "best_iteration": model.best_iteration,
        "solver_iterations": model.solver_iterations, "params": model.params}
    progress(1.0)
    log(f"Finished in {time.time() - start_time:.0f}s. Run id: {run_id}")
    return info
