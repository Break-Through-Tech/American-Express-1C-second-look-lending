# Second-Look Lending — Architecture & Model Design

A web app that predicts each applicant's **probability of default (PD)**, turns it into an
**approve / deny** decision that maximizes profit, and gives **thin-file** applicants (no credit
history) a fair second look.

- **Backend:** Python, FastAPI, pandas, scikit-learn, LightGBM, Optuna
- **Frontend:** React (Vite) + Recharts
- **Data:** the synthetic Second-Look Lending dataset (1M train loans, 200k out-of-time test loans)

The same document with diagrams: [`architecture.html`](architecture.html) (open it in a browser).

---

## 1. Results at a glance

Out-of-time test set (weeks 92–107, 200,000 loans), scored once against `solution.csv`.
The model was picked on validation AUC; calibration and thresholds were tuned on validation weeks 86–91 only.

| Policy (LightGBM + Optuna, the best model on validation) | Profit | Inclusion gap | Approved | Default rate of approved |
|---|---|---|---|---|
| Approve everyone (naïve) | $64.4M | 0.0 pts | 100% | 16.8% |
| **Baseline**: raw PD < 20% | $147.7M | 36.9 pts | 60.6% | 7.8% |
| Calibrated PD < 20% | $155.3M | 9.4 pts | 69.5% | 8.8% |
| **Second-look policy** (established < 17.5%, thin-file < 24.5%) | **$153.2M** | **−5.4 pts** | 70.3% | 9.1% |

**Profit +$5.6M and the gap goes from 36.9 points to −5.4.** Of thin-file applicants who repaid, 80.6% are now
approved instead of 41.2% (28,994 → 9,587 good payers denied). A negative gap means thin-file good payers are
now approved slightly *more* often than established ones (80.6% vs 75.2%).

**Honest reading:** calibration does most of the work — "Calibrated PD < 20%" is the most profitable policy on test.
The per-segment thresholds are tuned on only 6 weeks, so they are noisier and here overshoot past zero gap.
The gap penalty decides how much profit to trade for fairness; it can be changed in the Policy lab.

| Model | Validation AUC | Test AUC | Test LogLoss | Test Brier | AUC established | AUC thin-file |
|---|---|---|---|---|---|---|
| Logistic Regression (baseline) | 0.7586 | 0.7595 | 0.3914 | 0.1213 | 0.7885 | 0.7144 |
| Random Forest (50% sample) | 0.7610 | 0.7613 | 0.3898 | 0.1208 | 0.7945 | 0.7075 |
| LightGBM (defaults) | 0.7669 | 0.7674 | 0.3863 | 0.1200 | 0.7957 | 0.7151 |
| **LightGBM + Optuna (20 trials)** | **0.7674** | **0.7676** | **0.3862** | **0.1200** | 0.7961 | 0.7153 |

LightGBM beats the logistic-regression baseline on AUC and LogLoss (success criterion 1).
Every model gets the second-look policy, and every one raises profit and closes the gap:

| Model | Baseline profit → second-look | Gap → second-look |
|---|---|---|
| Logistic Regression | $144.4M → $151.5M | 38.4 → −1.9 pts |
| Random Forest | $141.0M → $152.7M | 47.9 → −1.8 pts |
| LightGBM (defaults) | $147.6M → $154.1M | 36.0 → −0.3 pts |
| LightGBM + Optuna | $147.7M → $153.2M | 36.9 → −5.4 pts |

**Deliverables in the repo:**
- Web app: `backend/` (FastAPI) and `frontend/` (React)
- Reproducible notebook and EDA report: [`notebooks/second_look_lending.ipynb`](../notebooks/second_look_lending.ipynb), which runs on free Colab
- Data dictionary: [`DATA_DICTIONARY.md`](DATA_DICTIONARY.md)
- This document and [`architecture.html`](architecture.html)

---

## 2. System architecture

```
┌──────────────────────── React UI (Vite, port 5173) ────────────────────────┐
│  Overview & EDA │ Train models │ Compare models │ Policy lab │ Score applicant│
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │  REST / JSON  (/api/...)
┌──────────────────────── FastAPI (port 8000) — app/main.py ─────────────────┐
│                                                                            │
│  eda.py        features.py      training.py ──► jobs.py (background thread) │
│  (EDA numbers) (CSV → features)  models.py  (LR / RF / LightGBM)            │
│                                 analysis.py ──► policy.py (cost, calibration,│
│  applicant.py (score one case)                    gap, thresholds)          │
│                                 storage.py (save / load runs)               │
└───────────────┬──────────────────────────────────────────┬─────────────────┘
                │ reads                                     │ reads / writes
   data/synth_home_credit/                      backend/artifacts/
     csv_files/train/*.csv, test/*.csv            features/train_features.parquet
     solution.csv (test answer key)               features/test_features.parquet
                                                  runs/<run_id>/ model.joblib, info.json,
                                                     val/test_predictions.parquet,
                                                     history.parquet, policy.json,
                                                     calibrator.joblib
```

### Backend modules (`backend/app/`)

| File | Job |
|---|---|
| `config.py` | Paths, cost model ($2,000 / −$8,000), validation start week |
| `features.py` | Reads all tables, unions `_0/_1` files, aggregates depth-1/2 tables, builds 53 features, flags thin-file |
| `eda.py` | Numbers for the Overview page (segments, weekly drift, missing values, signal by bin) |
| `models.py` | `PDModel`: preprocessing + model for Logistic Regression, Random Forest, LightGBM |
| `training.py` | Time split, optional Optuna tuning, fit, predict, save the run |
| `jobs.py` | Runs training in a background thread with progress and logs |
| `policy.py` | Metrics, calibration, drift trend, policy evaluation, threshold search |
| `analysis.py` | Compares the 4 policies on validation and test for one run |
| `insights.py` | Numbers for the Insights page (raw-table stats, example applicants, model walkthrough) |
| `feature_info.py` | Plain-English descriptions of tables, raw columns and features (shared with the data dictionary) |
| `applicant.py` | Scores one applicant (with what-if changes) and explains the score |
| `storage.py` | Saves / lists / loads runs in `artifacts/runs/` |
| `main.py` | The REST API |
| `cli.py` | Train from the terminal |

### Frontend pages (`frontend/src/pages/`)

| Page | What you can do |
|---|---|
| **Insights: data & model** | *Raw data* tab: table map, column types and stats, sample rows, one established and one thin-file applicant followed from raw rows to the final feature row. *Model* tab: features, time split, how the model works, hyperparameters in plain English, learning curve, what it learned, PD spread per segment, decisions in dollars, glossary |
| **Overview & EDA** | Dataset size, default rates, thin-file share, weekly drift chart, feature-vs-default explorer, table depths, missing values |
| **Train models** | Pick a model and edit its settings — every hyperparameter and data setting is explained (what it does, typical range, effect). A live panel shows each training step, the time split, Optuna trials as they finish and the learning curve tree by tree |
| **Compare models** | AUC / LogLoss / Brier per segment on validation and test, uplift vs LR, feature importance, delete runs |
| **Policy lab** | Choose calibration, drift, penalty, ceiling, or set thresholds by hand; see before/after profit and gap, profit & gap curves, calibration plots |
| **Score applicant** | Look up a case_id, see baseline vs second-look decisions, try what-if changes, see SHAP reasons |

---

## 3. Model pipeline

```
 8 raw tables ──► aggregate per case_id ──► 1 feature row per loan (53 features)
                                                   │
                     time split by WEEK_NUM ───────┤
   weeks 0–79      │ weeks 80–85        │ weeks 86–91          │ test weeks 92–107
   fit the model   │ model validation:  │ policy validation:   │ (no target)
                   │ early stopping,    │ calibration,         │
                   │ Optuna tuning      │ thresholds, metrics  │
                   ▼                    ▼                      ▼                 ▼
                   └────────────────────► PD (raw) ◄───────────────────────────┘
                                             │
                     Calibrator: per-segment Platt + drift correction
                                             │
                                      PD (calibrated)
                                             │
              Decision: approve if PD < threshold of the applicant's segment
                                             │
                Profit, inclusion gap, Inclusive Profit Score (test vs solution.csv)
```

### 3.1 Feature engineering (`features.py`)

| Source table | Depth | Features |
|---|---|---|
| `static_0` (2 files) | 0 | income, credit amount, annuity, days employed, education, marital status, **age** (from birth date) |
| `static_cb_0` | 0 | bureau risk score, number of queries, bureau description code |
| `person_1` | 1 | number of persons, household income, employment length, main applicant's housing type |
| `credit_bureau_a_1` (2 files) | 1 | **bureau_rowcount**, credit amount mean/max/sum, max overdue mean/max, days-past-due mean/max, count of DPD > 30, share of each contract class |
| `credit_bureau_a_2` | 2 | payment rows, overdue amount mean/max/sum, share of overdue payments |
| `applprev_1` | 1 | prior applications, prior amount mean/max, approved count, days since last approval, status shares |
| `tax_registry_a_1` | 1 | tax record count, declared income mean/max/sum |
| derived | – | **thin_file** (= no bureau rows), has_bureau_summary, has_prior_app, external_coverage, annuity/income, credit/income, tax income / stated income |

Missing values are kept as missing. Counts become 0 when a case has no rows. Masked categories
get a `"MISSING"` level.

### 3.2 Models (`models.py`)

| Model | Preprocessing | Default settings | Optuna search |
|---|---|---|---|
| Logistic Regression | clip at 0.1% / 99.9% (learned on train), median impute + missing flags, signed log1p, StandardScaler, one-hot categories | C=1, L2 | C, L1/L2, class_weight |
| Random Forest | numbers as-is (NaN supported), ordinal-encoded categories | 200 trees, depth 14, min leaf 50, 30% bootstrap | trees, depth, min leaf |
| LightGBM | none — native missing values and categories | lr 0.05, 63 leaves, early stopping (100 rounds) on validation AUC | leaves, lr, min child samples, colsample |

- **Split:** time-based, in three parts so nothing is judged on data it was tuned on.
  Weeks 0–79 fit the model. Weeks 80–85 are *model validation* (early stopping, Optuna).
  Weeks 86–91 are *policy validation* (calibration, thresholds, and the reported validation metrics) —
  the model never saw them. Test weeks 92–107 are scored once.
  Both boundaries can be changed (`val_start_week`, `policy_start_week`).
- **Why not stratified K-fold** (slide 13): the test set is later in time and risk drifts, so a random K-fold would mix
  future weeks into training and over-state performance. A time-ordered holdout mimics the real out-of-time test.
- **Tuning:** Optuna (TPE) on a 25% stratified sample, one declared metric: model-validation AUC.
  `scale_pos_weight` is not tuned because it inflates PD without improving ranking.
- Each run saves preprocessing + model as one `model.joblib`.

### 3.3 Decision policy (`policy.py`)

**Cost model:** repaid +$2,000, default −$8,000, denied $0.

```
Expected value of approving = (1 − PD) × 2,000 − PD × 8,000
Positive only when PD < 2,000 / (2,000 + 8,000) = 20%
```

**Inclusion gap:** among applicants who actually repaid, approval rate of established minus
approval rate of thin-file (percentage points).

**Inclusive Profit Score:**

```
score = profit − penalty × |gap| × (applicants / 100,000)
        only if the default rate among approved loans ≤ ceiling (default 12%)
```

Default penalty: $100,000 per gap point per 100k applicants.

**Why the baseline is unfair:** the thin-file default rate falls from ~33% (week 0) to ~19%
(week 91) while established stays at ~16%. Test weeks come later, so the model's raw PD for
thin-file applicants on test averages 25.9% while their real default rate is 17.8%. A flat 20%
cut-off then denies many thin-file applicants who would repay.

**The second look — three steps:**

1. **Segment-aware calibration** — fit Platt scaling (or isotonic) separately for thin-file and
   established, on the policy-validation weeks 86–91.
2. **Drift correction** — fit a straight line to each segment's weekly default rate (log-odds) on
   weeks 0–85. Thin-file slope ≈ −0.0084 per week; established ≈ 0. Move each applicant's
   calibrated PD along this line from the policy-validation midpoint to the applicant's own week.
   Thin-file mean PD on test becomes 18.0% (actual 17.8%).
3. **Segment-aware thresholds** — try every pair (established, thin-file) from 5% to 50% in 0.5%
   steps on weeks 86–91 and keep the pair with the best Inclusive Profit Score. For the best model:
   established < 17.5%, thin-file < 24.5%.

The test set is never used for tuning; `solution.csv` is only used to score the final results.

---

## 4. REST API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Data folder found? Features built? Cost model |
| POST | `/api/features/build` | Rebuild feature tables (background job) |
| GET | `/api/eda/overview` | Dataset summary for the Overview page |
| GET | `/api/eda/features` | Feature names |
| GET | `/api/eda/feature/{name}` | Default rate by bin, per segment |
| GET | `/api/models` | Model types, default hyperparameters |
| POST | `/api/train` | Start a training job. Body: `model_type`, `params`, `sample_fraction`, `val_start_week`, `tune_trials`, `name` |
| GET | `/api/jobs`, `/api/jobs/{id}` | Job status, progress, logs |
| GET | `/api/runs`, `/api/runs/{id}` | Trained runs and their metrics |
| DELETE | `/api/runs/{id}` | Delete a run |
| GET / POST | `/api/runs/{id}/policy` | Get or re-run the policy analysis. Body: `calibration`, `per_segment`, `drift`, `penalty`, `ceiling`, `thresholds` |
| GET | `/api/insights/raw` | Raw-data walkthrough: tables, columns, samples, example applicants |
| GET | `/api/runs/{id}/insights` | Model walkthrough for one run (validation weeks only) |
| GET | `/api/applicants/random` | 10 random test applicants |
| POST | `/api/runs/{id}/score` | Score one applicant. Body: `case_id`, `changes` |

Interactive API docs: <http://localhost:8000/docs>

Example — train from the terminal with `curl`:

```bash
curl -X POST localhost:8000/api/train -H 'Content-Type: application/json' \
     -d '{"model_type": "lightgbm", "tune_trials": 20}'
```

---

## 5. How to run

**Requirements:** Python 3.9+, Node.js 18+, the dataset folder.

```bash
# 1. Backend
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
scripts/fix_lightgbm_macos.sh          # macOS without Homebrew libomp only

# the dataset goes in data/synth_home_credit (or point to it elsewhere)
export SLL_DATA_DIR="/path/to/synth_home_credit"

.venv/bin/uvicorn app.main:app --port 8000 --reload

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev                            # http://localhost:5173
```

Or build the UI once and let FastAPI serve everything on port 8000:

```bash
cd frontend && npm run build           # then open http://localhost:8000
```

Train without the UI:

```bash
cd backend
.venv/bin/python -m app.cli --model logreg
.venv/bin/python -m app.cli --model random_forest --sample 0.5
.venv/bin/python -m app.cli --model lightgbm --trials 20
```

The first request builds the feature tables (~20 seconds) and caches them as parquet in
`backend/artifacts/features/`.

Notebook and data dictionary:

```bash
# Run the notebook in Jupyter / Colab, or rebuild + execute it from its source:
cd notebooks && ../backend/.venv/bin/python build_notebook.py --run      # needs: pip install matplotlib nbformat nbclient ipykernel

# Regenerate doc/DATA_DICTIONARY.md after changing features.py
cd backend && .venv/bin/python scripts/make_data_dictionary.py
```

---

## 6. Folder structure

```
backend/
  app/            FastAPI app and all ML code (see section 2)
  scripts/        fix_lightgbm_macos.sh, make_data_dictionary.py
  artifacts/      generated: feature parquet files and trained runs (git-ignored)
  requirements.txt
frontend/
  src/pages/      Overview, Insights (+ insights/RawDataTab, ModelTab), Train, Models, PolicyLab, Applicant
  src/components/ shared UI pieces, useRuns hook
  src/api.js      all API calls
  vite.config.js  dev proxy /api → localhost:8000
notebooks/
  second_look_lending.ipynb  EDA report + models + policy, runs on Colab
  build_notebook.py          source of the notebook (edit here, then rebuild)
  train_base_eda.ipynb       the team's earlier EDA of train_base
doc/
  ARCHITECTURE.md    this file
  architecture.html  the same with diagrams
  DATA_DICTIONARY.md every model feature and raw column
```

## 7. Ideas for next steps

- Add more thin-file features from internal data (prior application amounts over time, tax income stability).
- Report confidence intervals for profit and gap with bootstrap samples.
- Try CatBoost; compare stability of AUC week by week (the drift challenge).
- Add a fairness check across other groups (education, housing type) with the same gap metric.
