# LightGBM model files

Everything `02_lightgbm.ipynb` saves. Re-running that notebook (~20 min) rebuilds all of it.

| Folder | File | What it is | In git? |
|---|---|---|---|
| `models/` | `lightgbm_final.txt` | Main LightGBM: 280 trees, trained on weeks 0–79, no calibration | ✅ |
| `models/` | `lightgbm_calibrated_base.txt` | LightGBM trained on weeks 0–67, the base of the **recommended model** | ✅ |
| `models/` | `calibration.json` | Per-segment calibration learned on weeks 68–79: two numbers (`a`, `b`) for thin-file and two for established applicants | ✅ |
| `models/` | `model_inputs.json` | The 55 input features and the category lists for the 4 text columns, so new data is prepared exactly as in training | ✅ |
| `models/` | `xgboost_final.json` | XGBoost comparison model (not recommended: ties with LightGBM) | ✅ |
| `params/` | `best_params.json` | Chosen settings, tree counts, selection rule, recency half-life. Starting point for tuning (#14) | ✅ |
| `tuning/` | `tuning_lightgbm.csv`, `tuning_xgboost.csv` | Every setting tried and its score | ✅ |
| `results/` | `results_valid_weeks_80_91.csv` | All models scored on validation weeks 80–91 | ✅ |
| `predictions/` | `predictions_valid.parquet`, `predictions_test.parquet` | Probability of default for every applicant from each model | ❌ (~15 MB, rebuilt by the notebook) |

## Which model to use
**Recommended: LightGBM + per-segment calibration** (`lightgbm_calibrated_base.txt` + `calibration.json`).
It cuts the thin-file inclusion gap from 31.8 to 13.6 points and earns +$1.9M versus the uncalibrated model on weeks 80–91.

The calibration corrects the model's probability on the log-odds scale:

```
p_calibrated = 1 / (1 + exp(-(a × log(p / (1 − p)) + b)))
```

with `a`, `b` taken from `calibration.json` for the applicant's segment (thin-file or established).

## Scoring new applicants
```python
from score import score, decide          # run from this folder
df["pd"] = score(df)                     # calibrated probability of default (needs the thin_file column)
df["approve"] = decide(df)               # True if PD < 20%
```
`score(df, calibrated=False)` uses `lightgbm_final.txt` instead. The input needs the columns in `model_inputs.json`; the
feature table from notebook 04 (`data/processed/features_*.parquet`) has them all.

## Notes
- Models are saved in LightGBM's own text format and the calibration as plain JSON: nothing here needs unpickling.
- Keep this folder **without** an `__init__.py`. With one, Python could import this folder instead of the real `lightgbm`
  library when notebooks run from `notebooks/model_building/`.
