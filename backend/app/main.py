"""REST API for the Second-Look Lending app. Run: uvicorn app.main:app --reload"""
from pathlib import Path
from typing import Dict, Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import algorithm, analysis, applicant, config, eda, features, insights, jobs, storage, training
from app.models import DEFAULT_PARAMS, MODEL_NAMES
from app.param_help import PARAM_HELP

app = FastAPI(title="Second-Look Lending API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class TrainRequest(BaseModel):
    model_type: Literal["logreg", "random_forest", "lightgbm"] = "lightgbm"
    name: Optional[str] = None
    params: Dict = {}
    val_start_week: int = Field(config.VAL_START_WEEK, ge=20, le=88)  # train weeks are 0..91
    policy_start_week: int = Field(config.POLICY_START_WEEK, ge=21, le=89)
    sample_fraction: float = Field(1.0, gt=0, le=1)
    tune_trials: int = Field(0, ge=0, le=200)


class PolicyRequest(BaseModel):
    calibration: Literal["none", "platt", "isotonic"] = "platt"
    per_segment: bool = True
    drift: bool = True
    penalty: float = Field(100_000, ge=0)
    ceiling: Optional[float] = Field(0.12, gt=0, le=1)  # None = no ceiling
    thresholds: Optional[Dict[Literal["established", "thin_file"], float]] = None


class ScoreRequest(BaseModel):
    case_id: int
    changes: Dict[str, Optional[float]] = {}


def not_found(error):
    raise HTTPException(status_code=404, detail=str(error))


# Health & data

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "data_dir": str(config.DATA_DIR),
        "data_found": config.CSV_DIR.exists(),
        "features_built": features.features_are_built(),
        "economics": {"gain_repaid": config.GAIN_REPAID, "loss_default": config.LOSS_DEFAULT,
                      "breakeven_pd": config.BREAKEVEN_PD},
    }


@app.post("/api/features/build")
def build_features():
    def build(settings, log, progress, live):
        features.load_features("train", rebuild=True, log=log)
        progress(0.8)
        features.load_features("test", rebuild=True, log=log)
        eda.clear_cache()
        insights.clear_cache()
        return {"built": True}
    return jobs.start_job("build_features", build, {})


@app.get("/api/eda/overview")
def eda_overview():
    return eda.dataset_overview()


@app.get("/api/eda/features")
def eda_features():
    return eda.feature_list()


@app.get("/api/eda/feature/{name}")
def eda_feature(name: str):
    try:
        return eda.feature_signal(name)
    except KeyError as error:
        not_found(error)


# Training

@app.get("/api/models")
def model_options():
    return {"models": MODEL_NAMES, "default_params": DEFAULT_PARAMS, "param_help": PARAM_HELP,
            "val_start_week": config.VAL_START_WEEK, "policy_start_week": config.POLICY_START_WEEK}


@app.post("/api/train")
def train(request: TrainRequest):
    if request.val_start_week >= request.policy_start_week:
        raise HTTPException(422, "val_start_week must be before policy_start_week")
    return jobs.start_job("train", training.train, request.model_dump())


@app.get("/api/jobs")
def list_jobs():
    # Keep the list light; /api/jobs/{id} has the full logs and live view
    summary = []
    for job in jobs.list_jobs():
        run_id = (job["result"] or {}).get("run_id")
        summary.append({**job, "logs": job["logs"][-3:], "live": {"step": job["live"].get("step")},
                        "result": {"run_id": run_id} if run_id else None})
    return summary


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = jobs.get_job(job_id)
    if not job:
        not_found(f"Job {job_id} not found")
    return job


# Runs

@app.get("/api/runs")
def list_runs():
    return storage.list_runs()


@app.get("/api/runs/{run_id}")
def get_run(run_id: str):
    try:
        return storage.get_run(run_id)
    except KeyError as error:
        not_found(error)


@app.delete("/api/runs/{run_id}")
def delete_run(run_id: str):
    try:
        storage.delete_run(run_id)
        return {"deleted": run_id}
    except KeyError as error:
        not_found(error)


# Policy

@app.get("/api/runs/{run_id}/policy")
def get_policy(run_id: str):
    try:
        return analysis.get_policy_analysis(run_id) or analysis.run_policy_analysis(run_id, {})
    except KeyError as error:
        not_found(error)


@app.post("/api/runs/{run_id}/policy")
def update_policy(run_id: str, request: PolicyRequest):
    try:
        return analysis.run_policy_analysis(run_id, request.model_dump())
    except KeyError as error:
        not_found(error)
    except ValueError as error:
        raise HTTPException(400, str(error))


# Insights (learning page)

@app.get("/api/insights/raw")
def raw_data_insights():
    return insights.raw_data_insights()


@app.get("/api/runs/{run_id}/insights")
def model_insights(run_id: str):
    try:
        return insights.model_insights(run_id)
    except KeyError as error:
        not_found(error)


@app.get("/api/runs/{run_id}/algorithm")
def model_algorithm(run_id: str):
    try:
        return algorithm.explain_algorithm(run_id)
    except KeyError as error:
        not_found(error)


# Applicant

@app.get("/api/applicants/random")
def random_applicants():
    return applicant.random_applicants()


@app.post("/api/runs/{run_id}/score")
def score_applicant(run_id: str, request: ScoreRequest):
    try:
        return applicant.score(run_id, request.case_id, request.changes)
    except KeyError as error:
        not_found(error)


# Serve the built React app too, so one server is enough
frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")

    @app.get("/{page:path}", include_in_schema=False)
    def react_app(page: str):
        # Any non-API path gets index.html and React Router takes it from there
        if page.startswith("api/"):
            not_found(f"Unknown API path /{page}")
        return FileResponse(frontend_dist / "index.html")
