# LightGBM Hypertuning Technical Documentation

## 1. Hyperparameter Tuning

I reduced the number of tuning trials from 30 to 15 and changed the learning rate from 0.05 to 0.03.

Both configurations produced similar results, but runtime decreased from **12.1 minutes to 3.8 minutes**—a **68.6% reduction**.

### Original vs. Final Search Ranges

| Parameter | Original Range | Final Range |
|---|---:|---:|
| `num_leaves` | 15, 31, 63, 127 | 15, 31, 63 |
| `min_child_samples` | 50–3,000 | 50–500 |
| `feature_fraction` | 0.50–1.00 | 0.60–1.00 |
| `bagging_fraction` | 0.60–1.00 | 0.75–1.00 |
| `lambda_l2` | 0.1–50 | 0.1–50 |

The ranges were narrowed to focus on smaller leaf counts and minimum child samples, along with more focused feature and bagging fractions. The L2 regularization range remained unchanged.

**Final settings:** 15 trials and a learning rate of 0.03.

## 2. Recency Weighting

I tested half-life values of 4, 5, 6, 7, 8, and 13 weeks, along with no recency weighting.

| Half-life | Tune LogLoss | Tune AUC | Trees |
|---|---:|---:|---:|
| 4 weeks | 0.394301 | 0.774680 | 219 |
| 5 weeks | 0.394224 | 0.774770 | 219 |
| **6 weeks** | **0.394213** | **0.774833** | **191** |
| 7 weeks | 0.394246 | 0.774752 | 219 |
| 8 weeks | 0.394247 | 0.774791 | 220 |
| 13 weeks | 0.394492 | 0.774525 | 307 |

**Final choice: 6-week half-life.** It produced the lowest tuning LogLoss, highest AUC, and fewer trees than the other tested weighted options.

## 3. Calibration

I compared per-segment Platt scaling with isotonic regression.

In Section 8 of `02_lightgbm.ipynb`, isotonic regression reduced thin-file overprediction from 6.6 to 1.3. However, its established-file and thin-file reliability lines were farther from the ideal diagonal than those produced by per-segment Platt scaling.

In Section 11 of `02_lightgbm.ipynb`, isotonic regression also produced less favorable profit and inclusion-gap results, with more uneven and noisy curves. Although it reached similar values, its overall trend was less smooth and more sensitive to input data.

Per-segment Platt scaling brought both established-file and thin-file reliability lines closer to the ideal diagonal and produced better overall policy results.

**Final choice: Per-segment Platt scaling.**

## 4. Final Model Results

On validation weeks 80–91, the updated notebook reported:

| Model | Profit | Inclusion Gap |
|---|---:|---:|
| LightGBM tuned | $95.03M | 31.57 pp |
| LightGBM + segment calibration | $96.74M | 14.04 pp |
| LightGBM + recency weighting | $96.84M | 14.60 pp |
| **LightGBM + recency + calibration** | **$97.12M** | **13.46 pp** |

Combining recency weighting and calibration produced the highest profit and smallest inclusion gap among these four models.

## 5. Confirming the 12% Stage-1 Cutoff

In `03_second_look.ipynb`, the 12% Stage-1 cutoff performed well on weeks 80–91. I tested it again on weeks 68–79 to check consistency.

| Metric | Weeks 80–91 | Weeks 68–79 |
|---|---:|---:|
| **Approval rate** | **67.09%** | **66.63%** |
| **Default % approved** | **8.94%** | **9.11%** |
| **Profit** | **$96.76M** | **$94.57M** |
| **Inclusion gap** | **14.05 pp** | **13.27 pp** |

The results were similar across both periods, supporting the 12% cutoff as the ideal Stage-1 threshold.