# Second-Look Lending: Fair, Profit-Aware Credit Decisions for Thin-File Applicants

Break Through Tech AI Studio · American Express · Fall 2026

---

### 👥 **Team Members**

| Name                | GitHub Handle      | Contribution                                                              |
|---------------------|--------------------|---------------------------------------------------------------------------|
| Skylar Roberts      | @skylar-ej-roberts | Base table EDA, missing values & outliers (#3)                            |
| Dhyani Soni         | @dhy-ani           | Feature engineering (#6), data pipeline integration                       |
| Sama Daham          | @sama-daham        | Categorical encoding & numeric scaling (#4)                               |
| Jaahnvi Toolsidas   | @jtoolsidas        | Business understanding (#2), technical report                             |
| Krish Almeida       | @ka250-tech        | EDA & predictive signals (#7), model selection and tuning                 |
| Aninda Saprotiv Roy | @AnindaSaprotivRoy | EDA & predictive signals (#7), model evaluation and fairness analysis     |

**Challenge Advisor:** Thangavel Subramaniam · **AI Studio Coach:** Swagath Babu

---

## 🏗️ **Project Overview**

American Express's Second-Look Lending challenge asks: *can we approve more creditworthy applicants who have little or no credit history ("thin-file") without taking on unacceptable risk?*

We use synthetic consumer-loan data to:
1. **Predict** each applicant's probability of default (logistic regression baseline, random forest, gradient-boosted trees).
2. **Decide** who to approve using an economic model: an approved loan that is repaid earns **+$2,000**, a default costs **−$8,000**, and a denial is $0. The break-even point is a default probability of 20%. Portfolio default rate must stay under a ceiling.
3. **Be fair to thin-file applicants** by measuring the *inclusion gap*: the difference in approval rates between established and thin-file applicants **who would actually repay**.

### Success criteria
| Level | Metrics |
|---|---|
| Model quality | ROC-AUC, LogLoss, calibration (reliability curve, Brier score); must beat the logistic-regression baseline |
| Decision quality | Expected portfolio profit (under the default-rate ceiling), thin-file inclusion gap |
| Headline metric | **Inclusive Profit Score = expected profit − λ × inclusion gap**, compared with a naïve single-threshold policy |

All evaluation uses a **time-based** hold-out (never a random split). See [Challenge-Project-Overview.md](Challenge-Project-Overview.md) and the [technical report](Second_Look_Lending_Technical_Report.docx.pdf).

### Milestones
| Month | Milestone |
|---|---|
| September | Business problem, data understanding, EDA, cleaning, encoding, **feature engineering** ← *we are here* |
| October | Train/validation preparation, model exploration, hyper-parameter tuning (grid & Bayesian search) |
| November | Model finalization, scoring, basic Streamlit app |

---

## 👩🏽‍💻 **Setup and Installation**

```bash
git clone https://github.com/Break-Through-Tech/American-Express-1C-second-look-lending.git
cd American-Express-1C-second-look-lending
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

### Getting the data
The dataset is **not stored in git** (~550 MB unzipped). Download `synth_home_credit.zip` from the [team Google Drive folder](https://drive.google.com/drive/folders/1bJpa87n6HCwRR3Pvr5xqocNZrGo7dufT) and unzip it into `data/raw/`:

```
data/raw/
  csv_files/train/train_base.csv, train_static_0_0.csv, ...
  csv_files/test/test_base.csv, ...
  feature_definitions.csv, table_details.csv, README.md
  solution.csv          # hidden test labels: do NOT use while modeling
```

All notebooks load data with paths relative to the repo (`data/raw/csv_files/...`). **Never hard-code a path from your own machine.**

### Running the pipeline
Open Jupyter from the repo root (`jupyter notebook`) and run the numbered notebooks **in order**. Each one saves a file that the next one reads:

```
01_train_base_eda          EDA of the base table (Skylar)
02_static_0_preprocessing  EDA of static_0 missingness & outliers (Skylar)
        │ findings become rules
        ▼
03_clean_missing_outliers  Issue #3  raw CSV ─► data/interim/applicant_{train,test}.parquet
        ▼
04_feature_engineering     Issue #6  ─► data/processed/features_{train,test}.parquet
        ▼
05_encode_scale            Issue #4  ─► data/processed/model_ready_{fit,valid,test}.parquet
        ▼                              (uses src/pipeline/step5_encode_scale.py)
models (October)
```

`data/interim/` and `data/processed/` are git-ignored: re-run the notebooks to regenerate them.

---

## 📂 **Repository Structure**

| Path | What it is |
|---|---|
| `notebooks/` | Numbered pipeline notebooks (run in order) |
| `src/pipeline/step5_encode_scale.py` | Reusable `encode_scale()`: imputation, one-hot encoding, scaling (fit on train only) |
| `data/` | Local data only (git-ignored) |
| `Challenge-Project-Overview.md` | Challenge brief from the Challenge Advisor |
| `Second_Look_Lending_Technical_Report.docx.pdf` | Technical approach and evaluation framework |

---

## 📊 **Data Exploration**

**Dataset:** synthetic "Home Credit"-style relational data. 1,000,000 training loans (weeks 0–91, with `target`) and 200,000 test loans (weeks 92–107, labels hidden). All tables join on `case_id`.

| Table | Rows per applicant | Content |
|---|---|---|
| `base` | 1 | `case_id`, `date_decision`, `WEEK_NUM`, `target` (1 = default) |
| `static_0` | 1 | Income, credit amount, annuity, employment, education, marital status, birth date |
| `static_cb_0` | 0–1 | Credit-bureau risk score, number of queries (absent for thin-file) |
| `person_1` | 1–2 | Applicant and co-applicant: income, employment length, housing type |
| `credit_bureau_a_1` | 0–8 | Past credit contracts: amount, max overdue, days past due, contract type |
| `credit_bureau_a_2` | 0–n | Monthly payment records under each contract |
| `applprev_1` | 0–4 | Previous applications: amount, approval date, status |
| `tax_registry_a_1` | 0–3 | Declared tax / income records |

Column suffixes: `A` amount · `P` days past due · `D` date · `M` masked category · `L`/`T` other transform.

**Key findings so far**
- Default rate is **19.2%** overall and declines over time (21.3% in Jan 2019 → 17.2% in Sep 2020).
- **~30% of applicants are thin-file** (no credit-bureau contracts). They default at 25.6% vs 16.4% for established applicants, but their risk **drifts down** over time, so a model trained on older weeks over-estimates thin-file risk on the later test weeks.
- `static_0` numeric fields are 2–15% missing **at random** (default rate is the same whether missing or not). Rows are kept anyway, because dropping them would remove 28.8% of applicants.
- Amounts are right-skewed but plausible, so they are capped at the 1st/99th percentile instead of being removed.

### Preprocessing decisions
| Step | Decision | Why |
|---|---|---|
| Missing values | Keep all rows; median-impute + missing-indicator column (numeric), `"Missing"` category (categorical) | Dropping would lose 28.8% of applicants; thin-file applicants are missing whole tables (a strong signal); test rows can't be dropped |
| Outliers | Winsorize to 1st–99th percentile, caps fitted on training weeks only | Keeps every applicant; limits influence on `StandardScaler` |
| Encoding | One-hot (all categoricals have ≤ 10 levels) | Consistent columns across splits via `handle_unknown="ignore"` |
| Leakage | Imputer/scaler/encoder/caps fit on weeks < 80 only; previous-application history limited to before `date_decision`; `solution.csv` never used | Honest out-of-time evaluation |

---

## 🛠️ **Feature Engineering**

Each multi-row table is aggregated to **one row per applicant** and left-joined onto the application:

| Family | Examples |
|---|---|
| Application ratios | `credit_to_income`, `annuity_to_income`, `annuity_to_credit`, `age_years` |
| Person | `person_count`, `has_coapplicant`, household income, employment length, applicant housing type |
| Bureau contracts | `cb_contract_count`, credit sum/mean/max, overdue max/mean, days-past-due mean/max, counts by contract type |
| Bureau payments | `pay_record_count`, overdue sum/mean/max, share of late payments |
| Previous applications | count, amount stats, days since last/first approval, counts by status |
| Tax registry | record count, amount stats, number of employers, `tax_to_declared_income` |
| Segment flag | **`thin_file`** = no credit-bureau contracts |

Counts are `0` when an applicant has no rows in a table. Other aggregates remain missing and are imputed (with a flag) in the encode/scale step.

---

## 🧠 **Model Development**

*In progress (October).* Planned experiments from the technical report:
A) logistic regression on application fields → B) + engineered features → C) random forest → D) gradient boosting (LightGBM/XGBoost/CatBoost) → E) calibration → F) single vs. segment-aware approval thresholds.

Validation: train on weeks 0–79, validate on weeks 80–91 (out-of-time), final scoring on test weeks 92–107.

**Pipeline check** (notebook 05): logistic regression, validated on weeks 80–91

| Experiment | Features | ROC-AUC | LogLoss | Brier | AUC thin-file | AUC established |
|---|---|---|---|---|---|---|
| A: `static_0` only | 17 | 0.738 | 0.410 | 0.128 | 0.707 | 0.754 |
| B: + engineered features | 106 | **0.760** | **0.398** | **0.124** | 0.708 | **0.786** |

The engineered features help overall, but almost all of the gain goes to **established** applicants. The strongest new features come from credit-bureau history, which thin-file applicants don't have. Finding better signal for thin-file applicants (person, tax-registry and previous-application features) is the main open feature-engineering question.

---

## 📈 **Results & Key Findings**

*To be completed after modeling.*

---

## 🚀 **Next Steps**

- Tree-based models and hyper-parameter tuning on `model_ready_*.parquet`
- Probability calibration (Platt / isotonic) and reliability curves
- Threshold/policy layer: expected profit, default-rate ceiling, inclusion gap, Inclusive Profit Score
- Streamlit demo app

---

## 📝 **License**

To be confirmed with the Challenge Advisor.

---

## 🙏 **Acknowledgements**

Thanks to our Challenge Advisor Thangavel Subramaniam, AI Studio Coach Swagath Babu, and American Express.
