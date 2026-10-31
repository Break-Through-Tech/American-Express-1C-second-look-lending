"""Hyperparameter help shown on the Train and Insights pages."""

PARAM_HELP = {
    "logreg": {
        "C": {
            "what": "How much the model may trust the data. It limits how large the feature weights can grow.",
            "range": "0.001 – 10 (log scale)",
            "effect": "Smaller C = simpler model, less overfitting. Larger C = follows the training data more closely.",
        },
        "penalty": {
            "what": "How weights are kept small (regularization).",
            "range": "l2 or l1",
            "effect": "l2 shrinks every weight a little. l1 can set unhelpful weights to exactly 0 (feature selection), but trains slower.",
        },
        "class_weight": {
            "what": "Whether defaults count extra during training. Only 19% of loans default.",
            "range": "none or balanced",
            "effect": "balanced raises recall of defaulters but pushes every PD up, so PD is no longer an honest probability. Keep none for this project.",
        },
        "max_iter": {
            "what": "The most solver iterations. Each iteration looks at all training loans once and adjusts every weight, "
                    "so it is the closest thing to an 'epoch' here.",
            "range": "100 – 1000",
            "effect": "The solver stops by itself when the weights stop changing (usually well before the limit). "
                      "Too low = training is cut off before it finishes.",
        },
    },
    "random_forest": {
        "n_estimators": {
            "what": "How many decision trees vote together. Each tree sees a random 30% of the loans. "
                    "There are no epochs: every tree is built once, on its own.",
            "range": "100 – 400",
            "effect": "More trees = steadier, smoother PDs, but slower. Past a few hundred, gains are tiny.",
        },
        "max_depth": {
            "what": "How many yes/no questions one tree may ask in a row (its height).",
            "range": "6 – 20",
            "effect": "Deeper trees capture more detailed patterns but can memorise noise. Shallow trees are too simple.",
        },
        "min_samples_leaf": {
            "what": "The smallest group of loans a tree may end in (a leaf). The leaf's default rate becomes the PD.",
            "range": "10 – 400",
            "effect": "Larger = smoother, more reliable PDs and less overfitting. Smaller = more detail, more noise.",
        },
        "class_weight": {
            "what": "Whether defaults count extra during training.",
            "range": "none or balanced",
            "effect": "balanced pushes every PD up. Keep none so PDs stay honest probabilities.",
        },
    },
    "lightgbm": {
        "n_estimators": {
            "what": "The most trees (boosting rounds) LightGBM may build. Each round adds one tree that corrects the "
                    "mistakes of the trees before it — LightGBM's version of epochs.",
            "range": "500 – 5000 (it is only a cap)",
            "effect": "Early stopping usually stops long before this cap, so a high value is safe.",
        },
        "learning_rate": {
            "what": "How big a step each new tree takes when correcting the previous ones.",
            "range": "0.01 – 0.2",
            "effect": "Smaller = slower but steadier learning and needs more trees. Larger = fast but can overshoot.",
        },
        "num_leaves": {
            "what": "How many final groups (leaves) one tree can split the loans into.",
            "range": "15 – 255",
            "effect": "More leaves = more complex trees that capture interactions, but overfit more easily.",
        },
        "min_child_samples": {
            "what": "The smallest number of loans allowed in one leaf.",
            "range": "20 – 1000",
            "effect": "Larger = more conservative trees that ignore tiny, noisy groups. Smaller = more detail.",
        },
        "colsample_bytree": {
            "what": "Share of the features each tree may use, picked at random per tree.",
            "range": "0.4 – 1.0",
            "effect": "Below 1 makes trees different from each other, which reduces overfitting. 1 = every tree sees all features.",
        },
        "scale_pos_weight": {
            "what": "Extra weight on defaults during training.",
            "range": "1 (recommended) – 4",
            "effect": "Above 1 pushes every PD up, which breaks the 'approve if PD < 20%' rule. Keep 1 for this project.",
        },
        "early_stopping_rounds": {
            "what": "Patience: stop adding trees when validation AUC has not improved for this many trees in a row, "
                    "then keep the best one. The same idea as early stopping on epochs in a neural network.",
            "range": "50 – 200",
            "effect": "Smaller stops sooner and may stop too early. Larger trains longer for little extra gain.",
        },
    },
}
