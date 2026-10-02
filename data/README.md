# Synthetic Home Credit dataset (Second-Look Lending)

Synthetic stand-in that mimics the relational structure of the Kaggle
"Home Credit - Credit Risk Model Stability" data.

- **train:** 1,000,000 loans, weeks 0..91, with `target`.
- **test:**  200,000 loans, weeks 92..107
  (out-of-time, **distinct case_ids**), `target` withheld.

## Layout
```
synth_home_credit/
  csv_files/train/   train_base.csv, train_static_0_0.csv, ... (+ docs)
  csv_files/test/    test_base.csv  (NO target), test_static_0_0.csv, ...
  solution.csv          # case_id, target  -> the hidden answer key for test
  sample_submission.csv # case_id, score   -> the format you'd submit
  table_details.csv  feature_definitions.csv  README.md
```

## How the tables relate
Everything joins on **`case_id`**.
- **depth 0** tables have **one row per `case_id`** -> join directly.
- **depth 1 / 2** tables have **many rows per `case_id`** (indexed by `num_group1`,
  and `num_group2` at depth 2) -> **aggregate to one row per `case_id`**
  (count / mean / max / min / sum) before joining.

`base` is the spine. Files ending in `_0`, `_1` are **sub-parts of one table**
and must be concatenated.

## Column-name suffix convention
| suffix | meaning |
|--------|---------|
| `…A` | amount |
| `…P` | days past due |
| `…D` | date |
| `…M` | masked category |
| `…L` / `…T` | other transform |

## Train / test workflow (the Kaggle pattern)
1. Build features + model on **train** (hold out the latest train weeks as your
   own validation).
2. Predict on **test** -> a table of `case_id, score`.
3. Score yourself by joining those predictions to **`solution.csv`** (AUC, the
   profit/inclusion-gap policy metrics, etc.). Don't look at `solution.csv`
   while modeling — it's the stand-in for Kaggle's hidden labels.

## Second-Look Lending signal (built in)
- A latent creditworthiness drives both `target` and the features.
- **~30% of applicants are thin-file**: they have **no
  `credit_bureau_a` rows**, so they're hard to score. Derive the flag as
  `credit_bureau_a_1 rowcount == 0`.
- Thin-file default risk **drifts down over `WEEK_NUM`** and the test weeks are
  later, so a model trained on train **over-estimates** thin-file risk on test —
  producing the approval gap the challenge closes.

## Realized rates (train)
- overall default: **19.2%**  |  established 16.4%  |  thin-file 25.6%
