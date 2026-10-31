"""Train from the command line, e.g.:  python -m app.cli --model lightgbm --trials 20"""
import argparse

from app import training

parser = argparse.ArgumentParser(description="Train a PD model and run the second-look policy")
parser.add_argument("--model", default="lightgbm", choices=["logreg", "random_forest", "lightgbm"])
parser.add_argument("--name", default=None)
parser.add_argument("--sample", type=float, default=1.0, help="fraction of train rows to use")
parser.add_argument("--trials", type=int, default=0, help="Optuna tuning trials (0 = no tuning)")
parser.add_argument("--val-start-week", type=int, default=80, help="first model-validation week")
parser.add_argument("--policy-start-week", type=int, default=86, help="first policy-validation week")
args = parser.parse_args()

training.train({
    "model_type": args.model,
    "name": args.name,
    "sample_fraction": args.sample,
    "tune_trials": args.trials,
    "val_start_week": args.val_start_week,
    "policy_start_week": args.policy_start_week,
})
