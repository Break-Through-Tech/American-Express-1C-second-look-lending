"""Runs training in a background thread so the API stays responsive."""
import threading
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

# One job at a time, since training already uses every CPU core
_executor = ThreadPoolExecutor(max_workers=1)
_jobs = {}
_lock = threading.Lock()


def start_job(kind, function, settings):
    job_id = uuid.uuid4().hex[:8]
    job = {
        "job_id": job_id,
        "kind": kind,
        "settings": settings,
        "status": "queued",
        "progress": 0.0,
        "logs": [],
        "live": {},  # filled in by the task as it runs
        "result": None,
        "error": None,
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }
    with _lock:
        _jobs[job_id] = job

    def log(message):
        job["logs"].append(f"{datetime.now():%H:%M:%S}  {message}")

    def progress(value):
        job["progress"] = round(value, 3)

    # Runs on the worker thread; the API keeps answering while this works
    def run():
        job["status"] = "running"
        try:
            job["result"] = function(settings, log=log, progress=progress, live=job["live"])
            job["status"] = "done"
            job["progress"] = 1.0
        except Exception as error:
            job["status"] = "failed"
            job["error"] = str(error)
            log("ERROR: " + traceback.format_exc())

    _executor.submit(run)
    return job


def get_job(job_id):
    return _jobs.get(job_id)


def list_jobs():
    # Newest first; dicts remember insertion order
    return list(reversed(_jobs.values()))
