import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import OneHotEncoder, StandardScaler

def encode_scale(df: pd.DataFrame, id_col="case_id", target_col="target", birth_col="birth_259D", preprocessor=None):
    # id/target shouldn't be scaled or encoded like the other features;
    # birth_col is a raw date, not a category, so it's excluded from
    # one-hot encoding here rather than exploding into one column per date
    feature_cols = [col for col in df.columns if col not in (id_col, target_col, birth_col)]

    categorical_cols = []
    numeric_cols = []
    for col in feature_cols:
        if pd.api.types.is_numeric_dtype(df[col]):
            numeric_cols.append(col)
        else:
            categorical_cols.append(col)

    if preprocessor is None:
        # fit_transform path: only call this with preprocessor=None on the
        # training set. For val/test, pass back the preprocessor this
        # returned so the same fitted scaler/encoder gets reused (transform
        # only, no re-fitting).

        # Missing values are handled here rather than dropped, since
        # missingness itself is a signal for thin-file applicants:
        # - numeric: median-impute + keep a "was missing" indicator column
        # - categorical: fill with an explicit "Missing" category instead
        #   of the most frequent value, so "no data" stays visible
        numeric_pipeline = Pipeline([
            ("impute", SimpleImputer(strategy="median", add_indicator=True)),
            ("scale", StandardScaler()),
        ])
        categorical_pipeline = Pipeline([
            ("impute", SimpleImputer(strategy="constant", fill_value="Missing")),
            ("encode", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
        ])
        preprocessor = ColumnTransformer([
            ("numeric", numeric_pipeline, numeric_cols),
            ("categorical", categorical_pipeline, categorical_cols),
        ])
        transformed = preprocessor.fit_transform(df)
    else:
        transformed = preprocessor.transform(df)

    transformed_df = pd.DataFrame(
        transformed, columns=preprocessor.get_feature_names_out(), index=df.index
    )
    return transformed_df, preprocessor