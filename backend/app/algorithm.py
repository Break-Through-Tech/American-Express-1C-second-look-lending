"""Looks inside a trained model for the Insights page: its first tree or weights, and one PD built step by step."""
import numpy as np

from app import features, storage
from app.feature_info import describe_feature
from app.insights import pick_examples

TREE_DEPTH = 3  # levels of the tree to draw
_cache = {}


def sigmoid(z):
    return 1 / (1 + np.exp(-z))


def round_number(value):
    return float(f"{value:.4g}")


# LightGBM

def lightgbm_first_tree(model):
    dump = model.model.booster_.dump_model(num_iteration=1)
    names = dump["feature_names"]
    # LightGBM stores category splits as codes, so map them back to values
    categories = dict(zip(model.cat_cols, dump.get("pandas_categorical") or []))

    def question(node):
        feature = names[node["split_feature"]]
        if node["decision_type"] == "==":
            codes = [int(code) for code in str(node["threshold"]).split("||")]
            values = [categories[feature][code] for code in codes]
            return feature, f"{feature} is {' or '.join(values)}?"
        return feature, f"{feature} ≤ {round_number(node['threshold'])}?"

    # Walk the tree from the root, stopping after TREE_DEPTH levels
    def walk(node, depth):
        if "leaf_value" in node:
            return {"leaf": True, "loans": node["leaf_count"], "pd": float(sigmoid(node["leaf_value"]))}
        if depth == TREE_DEPTH:
            return {"leaf": True, "more": True, "loans": node["internal_count"], "pd": float(sigmoid(node["internal_value"]))}
        feature, text = question(node)
        return {
            "leaf": False,
            "feature": feature,
            "meaning": describe_feature(feature)[1],
            "question": text,
            "loans": node["internal_count"],
            "pd": float(sigmoid(node["internal_value"])),
            "missing_goes": "yes" if node["default_left"] else "no",
            "yes": walk(node["left_child"], depth + 1),
            "no": walk(node["right_child"], depth + 1),
        }

    return walk(dump["tree_info"][0]["tree_structure"], 0)


def lightgbm_prediction(model, row):
    """One applicant's PD as trees are added."""
    X = model.prepare(row)
    best = model.best_iteration
    checkpoints = sorted({k for k in [1, 2, 3, 5, 10, 20, 50, 100, 200, 300, best] if k <= best})
    path = [{"trees": k, "pd": float(model.model.predict_proba(X, num_iteration=k)[0, 1])} for k in checkpoints]

    # What each of the first five trees adds to the score (log-odds)
    raw = [float(model.model.predict(X, raw_score=True, num_iteration=k)[0]) for k in range(1, 6)]
    first_trees = [{"tree": 1, "change": raw[0]}] + [{"tree": k + 1, "change": raw[k] - raw[k - 1]} for k in range(1, 5)]
    return {"path": path, "first_trees": first_trees, "final_pd": path[-1]["pd"]}


# Random Forest

def forest_first_tree(model):
    preprocess = model.model.named_steps["preprocess"]
    forest = model.model.named_steps["model"]
    names = model.num_cols + model.cat_cols  # column order after preprocessing
    categories = dict(zip(model.cat_cols, preprocess.named_transformers_["cat"].categories_))
    tree = forest.estimators_[0].tree_

    def walk(i, depth):
        share_default = float(tree.value[i][0][1] / tree.value[i][0].sum())
        loans = int(tree.weighted_n_node_samples[i])
        is_leaf = tree.children_left[i] == -1
        if is_leaf or depth == TREE_DEPTH:
            return {"leaf": True, "more": not is_leaf, "loans": loans, "pd": share_default}
        feature = names[tree.feature[i]]
        threshold = tree.threshold[i]
        if feature in categories:
            # Categories became codes 0, 1, 2..., so "code <= threshold" means these values
            values = list(categories[feature][: int(threshold) + 1])
            text = f"{feature} is {' or '.join(map(str, values))}?"
        else:
            text = f"{feature} ≤ {round_number(threshold)}?"
        return {
            "leaf": False,
            "feature": feature,
            "meaning": describe_feature(feature)[1],
            "question": text,
            "loans": loans,
            "pd": share_default,
            "missing_goes": "yes" if tree.missing_go_to_left[i] else "no",
            "yes": walk(tree.children_left[i], depth + 1),
            "no": walk(tree.children_right[i], depth + 1),
        }

    return walk(0, 0)


def forest_prediction(model, row):
    """Each tree's own PD for one applicant; the forest averages them."""
    preprocess = model.model.named_steps["preprocess"]
    forest = model.model.named_steps["model"]
    X = preprocess.transform(model.prepare(row))
    votes = np.array([tree.predict_proba(X)[0, 1] for tree in forest.estimators_])
    counts, edges = np.histogram(votes, bins=np.arange(0, 1.05, 0.05))
    return {
        "votes": [{"pd": round(float(edges[i] + 0.025), 3), "trees": int(c)} for i, c in enumerate(counts)],
        "n_trees": len(votes),
        "lowest": float(votes.min()),
        "highest": float(votes.max()),
        "final_pd": float(votes.mean()),
    }


# Logistic Regression

def logreg_weights(model, top=12):
    preprocess = model.model.named_steps["preprocess"]
    names = [n.split("__", 1)[1] for n in preprocess.get_feature_names_out()]
    coefs = model.model.named_steps["model"].coef_[0]
    order = np.argsort(-np.abs(coefs))[:top]
    return {
        "intercept": float(model.model.named_steps["model"].intercept_[0]),
        "n_weights": len(coefs),
        "top": [{"feature": names[i], "weight": float(coefs[i]), "meaning": describe_feature(names[i])[1]} for i in order],
    }


def logreg_prediction(model, row, top=8):
    """score = intercept + sum(weight * value), then PD = 1 / (1 + e^-score)."""
    preprocess = model.model.named_steps["preprocess"]
    lr = model.model.named_steps["model"]
    names = [n.split("__", 1)[1] for n in preprocess.get_feature_names_out()]
    X = preprocess.transform(model.prepare(row))
    values = X.toarray()[0] if hasattr(X, "toarray") else np.asarray(X)[0]
    contributions = values * lr.coef_[0]
    order = np.argsort(-np.abs(contributions))
    shown = order[:top]
    score = float(lr.intercept_[0] + contributions.sum())
    return {
        "intercept": float(lr.intercept_[0]),
        "contributions": [{"feature": names[i], "value": float(values[i]), "weight": float(lr.coef_[0][i]),
                           "contribution": float(contributions[i])} for i in shown],
        "others": float(contributions[order[top:]].sum()),
        "score": score,
        "final_pd": float(sigmoid(score)),
    }


# Put it together

def explain_algorithm(run_id):
    if run_id in _cache:
        return _cache[run_id]

    model = storage.load_model(run_id)
    train = features.load_features("train")
    examples = {}
    for kind, case_id in pick_examples(train).items():
        row = train[train["case_id"] == case_id]
        if model.model_type == "lightgbm":
            prediction = lightgbm_prediction(model, row)
        elif model.model_type == "random_forest":
            prediction = forest_prediction(model, row)
        else:
            prediction = logreg_prediction(model, row)
        examples[kind] = {"case_id": int(case_id), "defaulted": int(row["target"].iloc[0]), **prediction}

    result = {"model_type": model.model_type, "params": model.params, "examples": examples,
              "base_rate": float(train["target"].mean())}
    if model.model_type == "lightgbm":
        result["tree"] = lightgbm_first_tree(model)
        result["n_trees"] = model.best_iteration
    elif model.model_type == "random_forest":
        result["tree"] = forest_first_tree(model)
        result["n_trees"] = model.params["n_estimators"]
    else:
        result["weights"] = logreg_weights(model)

    _cache[run_id] = result
    return result
