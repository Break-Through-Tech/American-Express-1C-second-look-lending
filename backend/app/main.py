"""REST API for the Second-Look Lending app. Run: uvicorn app.main:app --reload"""
from datetime import date
from pathlib import Path
from typing import Dict, List, Literal, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import (algorithm, analysis, applicant, business, config, eda, features, insights, jobs, scoring, storage,
                 training, workflow)
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
    save: bool = False  # False = preview only; True = publish (changes live decisions)


class ScoreRequest(BaseModel):
    case_id: int
    changes: Dict[str, Optional[float]] = {}


class ApplicationForm(BaseModel):
    """What a person fills in on the online application. Name and email are never shown to the models."""
    first_name: str = Field(min_length=1, max_length=60)
    last_name: str = Field(min_length=1, max_length=60)
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=120)
    date_of_birth: date
    loan_amount: float = Field(ge=1000, le=100_000)
    term_months: Literal[6, 12, 18, 24, 36, 48]
    purpose: Literal["home improvement", "car", "education", "medical", "debt consolidation", "other"]
    employment: Literal["employed", "self-employed", "retired", "student", "not working"]
    years_employed: float = Field(ge=0, le=50)
    annual_income: float = Field(ge=0, le=1_000_000)
    tax_declared_income: Optional[float] = Field(None, ge=0, le=1_000_000)
    has_credit_history: bool
    credit_rating: Optional[Literal["excellent", "very good", "good", "fair", "poor"]] = None
    credit_accounts: int = Field(0, ge=0, le=8)
    worst_days_late: int = Field(0, ge=0, le=90)
    credit_checks_last_year: int = Field(0, ge=0, le=15)
    previous_loans: int = Field(0, ge=0, le=4)
    consent: Literal[True]  # the applicant must agree to the credit check


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


@app.get("/api/eda/training-sample")
def eda_training_sample(window: Optional[Literal["fit", "model_validation", "policy_validation"]] = None,
                        segment: Optional[Literal["established", "thin_file"]] = None,
                        outcome: Optional[Literal["repaid", "defaulted"]] = None,
                        all_columns: bool = False, offset: int = Query(0, ge=0), limit: int = Query(10, ge=1, le=50)):
    return eda.training_sample(window, segment, outcome, all_columns, offset, limit)


@app.get("/api/eda/raw-table/{name}")
def eda_raw_table(name: str, case_id: Optional[int] = None, offset: int = Query(0, ge=0), limit: int = Query(10, ge=1, le=50)):
    try:
        return eda.raw_table_page(name, case_id, offset, limit)
    except KeyError as error:
        not_found(error)


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
        options = request.model_dump()
        save = options.pop("save")
        return analysis.run_policy_analysis(run_id, options, save=save)
    except KeyError as error:
        not_found(error)
    except ValueError as error:
        raise HTTPException(400, str(error))


# Model roles: the primary model decides first, the second-look model reviews declines

class RoleRequest(BaseModel):
    role: Literal["primary", "second_look"]
    run_id: str


@app.get("/api/model-roles")
def get_model_roles():
    return storage.get_model_roles()


@app.put("/api/model-roles")
def set_model_role(request: RoleRequest):
    try:
        storage.set_model_role(request.role, request.run_id)
        return storage.get_model_roles()
    except KeyError as error:
        not_found(error)


# Decision pipeline: primary -> Second Look -> human review

class WorkflowSettings(BaseModel):
    mode: Optional[Literal["auto", "manual"]] = None
    primary_cutoff: Optional[float] = Field(None, gt=0, lt=1)
    review_band: Optional[float] = Field(None, ge=0, le=1)


class ProcessRequest(BaseModel):
    week: int = Field(..., ge=92, le=107)


class SendRequest(BaseModel):
    case_ids: List[int] = []  # empty = every waiting case


class ChangesRequest(BaseModel):
    changes: Dict[str, Optional[float]] = {}


class DecisionRequest(BaseModel):
    decision: Literal["approve", "decline"]
    reason: str = ""
    reviewer: str = "reviewer"
    changes: Dict[str, Optional[float]] = {}


def needs_model():
    if not storage.get_production_run():
        not_found("No trained model yet")


@app.get("/api/workflow/settings")
def workflow_settings():
    return scoring.get_settings()


@app.put("/api/workflow/settings")
def update_workflow_settings(request: WorkflowSettings):
    return scoring.save_settings({k: v for k, v in request.model_dump().items() if v is not None})


@app.get("/api/workflow/summary")
def workflow_summary():
    needs_model()
    return workflow.summary()


@app.post("/api/workflow/process")
def workflow_process(request: ProcessRequest):
    needs_model()
    return workflow.process_week(request.week)


@app.post("/api/workflow/second-look")
def workflow_send(request: SendRequest):
    needs_model()
    return workflow.send_to_second_look(request.case_ids or None)


@app.get("/api/workflow/cases")
def workflow_cases(status: Optional[str] = None, week: Optional[int] = None, thin_file: Optional[bool] = None,
                   limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0), online: bool = False):
    return workflow.list_cases(status, week, thin_file, limit, offset, online)


@app.get("/api/workflow/cases/{case_id}")
def workflow_case(case_id: int):
    try:
        return workflow.get_case(case_id)
    except KeyError as error:
        not_found(error)


@app.post("/api/workflow/cases/{case_id}/rescore")
def workflow_rescore(case_id: int, request: ChangesRequest):
    try:
        return workflow.rescore(case_id, request.changes)
    except KeyError as error:
        not_found(error)


@app.post("/api/workflow/cases/{case_id}/decide")
def workflow_decide(case_id: int, request: DecisionRequest):
    try:
        return workflow.decide(case_id, request.decision, request.reason, request.changes, request.reviewer)
    except KeyError as error:
        not_found(error)
    except ValueError as error:
        raise HTTPException(400, str(error))


@app.post("/api/workflow/reset")
def workflow_reset():
    workflow.reset()
    return {"reset": True}


# Business dashboard

@app.get("/api/business/dashboard")
def business_dashboard():
    run_id = storage.get_production_run()
    if not run_id:
        not_found("No trained model yet")
    return business.dashboard(run_id)


# Applicant portal (always uses the production model)

@app.get("/api/portal/showcase")
def portal_showcase():
    run_id = storage.get_production_run()
    if not run_id:
        not_found("No trained model yet")
    return applicant.showcase(run_id)


@app.post("/api/portal/apply")
def portal_apply(form: ApplicationForm):
    if not storage.get_production_run():
        not_found("No trained model yet")
    age = (date.today() - form.date_of_birth).days / 365.25
    if not 18 <= age <= 100:
        raise HTTPException(status_code=422, detail="You must be at least 18 to apply")
    if form.has_credit_history and (form.credit_accounts == 0 or not form.credit_rating):
        raise HTTPException(status_code=422, detail="Tell us about your credit accounts and your credit score band")
    return workflow.submit_application(form.model_dump(mode="json"))


@app.post("/api/portal/score")
def portal_score(request: ScoreRequest):
    run_id = storage.get_production_run()
    if not run_id:
        not_found("No trained model yet")
    try:
        result = applicant.score(run_id, request.case_id, request.changes)
        # Where the application really is, or would land with the what-if changes
        if request.changes:
            result["workflow"] = workflow.whatif(request.case_id, request.changes)
        else:
            result["workflow"] = workflow.applicant_status(request.case_id)
        return result
    except KeyError as error:
        not_found(error)


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

@app.get("/guide", include_in_schema=False)
def project_guide():
    # The full project guide (diagrams, setup, code walkthrough), linked from the Help page
    return FileResponse(config.REPO_DIR / "PROJECT_GUIDE.html")


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
