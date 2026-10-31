import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent

# The dataset folder (csv_files/ and solution.csv); defaults to data/synth_home_credit in the repo
DATA_DIR = Path(os.environ.get("SLL_DATA_DIR", REPO_DIR / "data" / "synth_home_credit"))
CSV_DIR = DATA_DIR / "csv_files"
SOLUTION_CSV = DATA_DIR / "solution.csv"

ARTIFACTS_DIR = Path(os.environ.get("SLL_ARTIFACTS_DIR", BACKEND_DIR / "artifacts"))
FEATURES_DIR = ARTIFACTS_DIR / "features"
RUNS_DIR = ARTIFACTS_DIR / "runs"
FEATURES_DIR.mkdir(parents=True, exist_ok=True)
RUNS_DIR.mkdir(parents=True, exist_ok=True)

# Cost model from the brief: a repaid loan earns $2k, a default loses $8k, a denial is $0
GAIN_REPAID = 2000
LOSS_DEFAULT = 8000
BREAKEVEN_PD = GAIN_REPAID / (GAIN_REPAID + LOSS_DEFAULT)  # 0.20

# Weeks 0-79 fit the model, 80-85 tune it, 86-91 tune the policy (never seen by the model)
VAL_START_WEEK = 80
POLICY_START_WEEK = 86

RANDOM_STATE = 42
