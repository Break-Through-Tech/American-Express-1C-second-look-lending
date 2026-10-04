'''
Runs prepared data pre-processing pipline (notebooks 03 -> 04 -> 05) in order
Produces data/processed/model_ready_{fit,valid,test}.parquet


Requires: pip3 install papermill
Requires raw CSVs already in data/raw/csv_files/{train,test}/

'''

import tempfile
from pathlib import Path
import papermill as pm
 
ROOT = Path(__file__).parent
NOTEBOOKS = ROOT / "notebooks"
 
PIPELINE = [
    "03_clean_missing_outliers.ipynb",
    "04_feature_engineering.ipynb",
    "05_encode_scale.ipynb",
]
 
with tempfile.TemporaryDirectory() as tmp:
    for nb_name in PIPELINE:
        print(f"Running {nb_name} ...")
        pm.execute_notebook(
            input_path=str(NOTEBOOKS / nb_name),
            output_path=str(Path(tmp) / nb_name),  # discarded when the temp dir cleans up

            cwd=str(NOTEBOOKS)
        )
        print(f"  done.")
 
print("\nPipeline complete. Check data/processed/ for model_ready_{fit,valid,test}.parquet")