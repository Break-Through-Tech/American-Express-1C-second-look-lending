"""The three PD models: logistic regression, random forest and LightGBM."""
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, OneHotEncoder, OrdinalEncoder, StandardScaler

from app import config
from app.features import CATEGORICAL_FEATURES

MODEL_NAMES = {
    "logreg": "Logistic Regression",
    "random_forest": "Random Forest",
    "lightgbm": "LightGBM",
}

DEFAULT_PARAMS = {
    "logreg": {"C": 1.0, "penalty": "l2", "class_weight": None, "max_iter": 300},
    "random_forest": {"n_estimators": 200, "max_depth": 14, "min_samples_leaf": 50, "class_weight": None},
    "lightgbm": {"n_estimators": 2000, "learning_rate": 0.05, "num_leaves": 63,
                 "min_child_samples": 200, "colsample_bytree": 0.8, "scale_pos_weight": 1.0,
                 "early_stopping_rounds": 100},
}


def suggest_params(model_type, trial):
    """Optuna search space per model."""
    if model_type == "logreg":
        return {
            "C": trial.suggest_float("C", 0.001, 10, log=True),
            "penalty": trial.suggest_categorical("penalty", ["l1", "l2"]),
            "class_weight": trial.suggest_categorical("class_weight", [None, "balanced"]),
        }
    if model_type == "random_forest":
        return {
            "n_estimators": trial.suggest_int("n_estimators", 100, 400, step=50),
            "max_depth": trial.suggest_int("max_depth", 6, 20),
            "min_samples_leaf": trial.suggest_int("min_samples_leaf", 10, 400, log=True),
        }
    return {
        "num_leaves": trial.suggest_int("num_leaves", 15, 255, log=True),
        "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.2, log=True),
        "min_child_samples": trial.suggest_int("min_child_samples", 20, 1000, log=True),
        "colsample_bytree": trial.suggest_float("colsample_bytree", 0.4, 1.0),
        # scale_pos_weight stays out: it barely moves AUC but inflates every PD
    }


def signed_log1p(x):
    return np.sign(x) * np.log1p(np.abs(x))


class ClipOutliers(BaseEstimator, TransformerMixin):
    """Caps each column at its 0.1% / 99.9% values from the training data."""

    def fit(self, X, y=None):
        self.low_, self.high_ = np.nanpercentile(np.asarray(X, dtype=float), [0.1, 99.9], axis=0)
        return self

    def transform(self, X):
        return np.clip(np.asarray(X, dtype=float), self.low_, self.high_)  # NaN stays NaN

    def get_feature_names_out(self, input_features=None):
        return np.asarray(input_features, dtype=object)


class PDModel:
    """Preprocessing and model in one object; predict_pd() gives the probability of default."""

    def __init__(self, model_type, params, feature_cols):
        self.model_type = model_type
        self.params = {**DEFAULT_PARAMS[model_type], **(params or {})}
        self.feature_cols = list(feature_cols)
        self.cat_cols = [c for c in self.feature_cols if c in CATEGORICAL_FEATURES]
        self.num_cols = [c for c in self.feature_cols if c not in self.cat_cols]
        self.categories = {}
        self.model = None
        self.best_iteration = None
        self.learning_curve = []
        self.solver_iterations = None

    def prepare(self, df):
        """Pick the feature columns and reuse the category levels seen in training."""
        X = df.reindex(columns=self.feature_cols)
        for col in self.cat_cols:
            values = X[col].astype(object).fillna("MISSING")
            X[col] = pd.Categorical(values, categories=self.categories[col])
        return X

    def build_model(self):
        p = self.params
        if self.model_type == "logreg":
            # A linear model needs clean, scaled numbers and one-hot categories
            numeric = Pipeline([
                ("clip", ClipOutliers()),
                ("impute", SimpleImputer(strategy="median", add_indicator=True)),
                ("log", FunctionTransformer(signed_log1p, feature_names_out="one-to-one")),
                ("scale", StandardScaler()),
            ])
            preprocess = ColumnTransformer([
                ("num", numeric, self.num_cols),
                ("cat", OneHotEncoder(handle_unknown="ignore"), self.cat_cols),
            ])
            solver = "saga" if p["penalty"] == "l1" else "lbfgs"
            model = LogisticRegression(C=p["C"], penalty=p["penalty"], class_weight=p["class_weight"],
                                       solver=solver, max_iter=p["max_iter"])
            return Pipeline([("preprocess", preprocess), ("model", model)])

        if self.model_type == "random_forest":
            # Trees cope with NaN and scale; categories just need number codes
            preprocess = ColumnTransformer([
                ("num", "passthrough", self.num_cols),
                ("cat", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1), self.cat_cols),
            ])
            model = RandomForestClassifier(
                n_estimators=p["n_estimators"], max_depth=p["max_depth"],
                min_samples_leaf=p["min_samples_leaf"], class_weight=p["class_weight"],
                max_features="sqrt", max_samples=0.3, n_jobs=-1, random_state=config.RANDOM_STATE,
            )
            return Pipeline([("preprocess", preprocess), ("model", model)])

        # early_stopping_rounds belongs to fit(), not to the LightGBM model
        tree_params = {k: v for k, v in p.items() if k != "early_stopping_rounds"}
        return lgb.LGBMClassifier(**tree_params, subsample=0.8, subsample_freq=1,
                                  random_state=config.RANDOM_STATE, n_jobs=-1, verbose=-1)

    def fit(self, train_df, val_df, log=print, on_progress=None):
        """on_progress(trees, auc) is called as trees are added, for the live training view."""
        for col in self.cat_cols:
            values = set(train_df[col].astype(object).fillna("MISSING"))
            self.categories[col] = sorted(values | {"MISSING"})

        X_train, y_train = self.prepare(train_df), train_df["target"].astype(int)
        X_val, y_val = self.prepare(val_df), val_df["target"].astype(int)
        self.model = self.build_model()

        if self.model_type == "lightgbm":
            self.model.fit(
                X_train, y_train,
                eval_set=[(X_val, y_val)], eval_metric="auc",
                callbacks=[lgb.early_stopping(self.params["early_stopping_rounds"], verbose=False),
                           log_every_100(log), report_each_tree(on_progress)],
            )
            self.best_iteration = self.model.best_iteration_
            # Keep validation AUC per tree for the learning curve
            aucs = self.model.evals_result_["valid_0"]["auc"]
            self.learning_curve = [{"trees": i + 1, "auc": float(auc)} for i, auc in enumerate(aucs)]
            log(f"Early stopping picked {self.best_iteration} trees")

        elif self.model_type == "random_forest":
            # Grow 20 trees at a time with warm_start (same result as one big fit) and check AUC each batch
            preprocess, forest = self.model.named_steps["preprocess"], self.model.named_steps["model"]
            X_train_ready = preprocess.fit_transform(X_train)
            X_val_ready = preprocess.transform(X_val)
            total_trees = forest.n_estimators
            forest.set_params(warm_start=True)
            for trees in list(range(20, total_trees, 20)) + [total_trees]:
                forest.set_params(n_estimators=trees).fit(X_train_ready, y_train)
                auc = float(roc_auc_score(y_val, forest.predict_proba(X_val_ready)[:, 1]))
                self.learning_curve.append({"trees": trees, "auc": auc})
                if on_progress:
                    on_progress(trees, auc)
            forest.set_params(warm_start=False)
            log(f"Grew {total_trees} trees, validation AUC {auc:.4f}")

        else:
            # No trees here: the solver fits all the weights in one go
            self.model.fit(X_train, y_train)
            self.solver_iterations = int(self.model.named_steps["model"].n_iter_[0])
            log(f"Solver finished after {self.solver_iterations} iterations (max_iter = {self.params['max_iter']})")
        return self

    def predict_pd(self, df):
        X = self.prepare(df)
        if self.model_type == "lightgbm":
            return self.model.predict_proba(X, num_iteration=self.best_iteration)[:, 1]
        return self.model.predict_proba(X)[:, 1]

    def feature_importance(self, top=20):
        if self.model_type == "lightgbm":
            names = self.feature_cols
            values = self.model.booster_.feature_importance(importance_type="gain")
        elif self.model_type == "random_forest":
            names = self.num_cols + self.cat_cols
            values = self.model.named_steps["model"].feature_importances_
        else:
            names = self.model.named_steps["preprocess"].get_feature_names_out()
            names = [n.split("__", 1)[1] for n in names]
            values = np.abs(self.model.named_steps["model"].coef_[0])

        values = np.array(values, dtype=float)
        values = values / values.sum()
        order = np.argsort(-values)[:top]
        return [{"feature": names[i], "importance": float(values[i])} for i in order]

    def explain(self, row, top=8):
        """Top SHAP reasons behind one applicant's score (LightGBM only)."""
        if self.model_type != "lightgbm":
            return []
        X = self.prepare(row)
        shap = self.model.predict_proba(X, pred_contrib=True, num_iteration=self.best_iteration)[0][:-1]
        order = np.argsort(-np.abs(shap))[:top]
        reasons = []
        for i in order:
            value = X.iloc[0, i]
            reasons.append({
                "feature": self.feature_cols[i],
                "value": None if pd.isna(value) else (str(value) if isinstance(value, str) else float(value)),
                "contribution": float(shap[i]),
            })
        return reasons


def report_each_tree(on_progress):
    def callback(env):
        if on_progress:
            on_progress(env.iteration + 1, env.evaluation_result_list[0][2])
    return callback


def log_every_100(log):
    def callback(env):
        if env.iteration % 100 == 0:
            auc = env.evaluation_result_list[0][2]
            log(f"  tree {env.iteration}: validation AUC = {auc:.4f}")
    return callback
