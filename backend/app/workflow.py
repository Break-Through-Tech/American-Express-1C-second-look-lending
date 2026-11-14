"""The decision pipeline: primary model -> Second Look -> human review, with an audit trail."""
import json
import sqlite3
from datetime import datetime

import pandas as pd

from app import applicant, applications, config, features, storage
from app.scoring import get_settings, primary_scores, second_look_scores, second_look_status

DB_PATH = config.ARTIFACTS_DIR / "workflow.db"

# Every status a case can be in, with the words people see
STATUSES = {
    "approved_primary": "Approved by the primary model",
    "awaiting_second_look": "Waiting to be sent to Second Look",
    "approved_second_look": "Approved through Second Look",
    "in_review": "With a human reviewer",
    "declined_second_look": "Declined (clearly above the risk limit)",
    "approved_review": "Approved by a reviewer",
    "declined_review": "Declined by a reviewer",
}
FINAL = {"approved_primary", "approved_second_look", "declined_second_look", "approved_review", "declined_review"}


# Storage

def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS cases (
            case_id INTEGER PRIMARY KEY,
            week INTEGER,
            thin_file INTEGER,
            status TEXT,
            primary_pd REAL,
            second_look_pd REAL,
            second_look_cutoff REAL,
            approved_amount REAL,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id INTEGER,
            at TEXT,
            actor TEXT,
            action TEXT,
            detail TEXT
        );
        CREATE INDEX IF NOT EXISTS events_by_case ON events (case_id);
    """)
    return conn


def now():
    return datetime.now().isoformat(timespec="seconds")


def reset():
    """Start the pipeline over (clears all cases and the audit trail)."""
    DB_PATH.unlink(missing_ok=True)


# Moving cases through the pipeline

def process_week(week, actor="system"):
    """Score one week of new applications with the primary model; in auto mode, run Second Look right after."""
    settings = get_settings()
    test = features.load_features("test")
    batch = test.loc[test["WEEK_NUM"] == week, ["case_id", "WEEK_NUM", "thin_file"]]
    batch = batch.assign(primary_pd=batch["case_id"].map(primary_scores()))

    with connect() as conn:
        done = {row[0] for row in conn.execute("SELECT case_id FROM cases WHERE week = ?", (week,))}
        batch = batch[~batch["case_id"].isin(done)]
        stamp = now()
        rows, events = [], []
        for case in batch.itertuples():
            approved = case.primary_pd < settings["primary_cutoff"]
            status = "approved_primary" if approved else "awaiting_second_look"
            rows.append((int(case.case_id), int(case.WEEK_NUM), int(case.thin_file), status, float(case.primary_pd), stamp))
            verdict = "approved" if approved else "declined"
            events.append((int(case.case_id), stamp, actor, "primary decision",
                           f"Primary model risk {case.primary_pd:.1%} vs cut-off {settings['primary_cutoff']:.0%}: {verdict}"))
        conn.executemany("INSERT INTO cases (case_id, week, thin_file, status, primary_pd, updated_at) VALUES (?, ?, ?, ?, ?, ?)", rows)
        conn.executemany("INSERT INTO events (case_id, at, actor, action, detail) VALUES (?, ?, ?, ?, ?)", events)

    declined = [r[0] for r in rows if r[3] == "awaiting_second_look"]
    if settings["mode"] == "auto" and declined:
        send_to_second_look(declined, actor="system (automatic routing)")
    return {"week": week, "processed": len(rows), "declined_by_primary": len(declined), "mode": settings["mode"]}


def send_to_second_look(case_ids=None, actor="business user"):
    """Run Second Look on waiting cases (all of them if no ids are given)."""
    settings = get_settings()
    scores = second_look_scores()
    with connect() as conn:
        if case_ids:
            marks = ",".join("?" * len(case_ids))
            waiting = [r[0] for r in conn.execute(
                f"SELECT case_id FROM cases WHERE status = 'awaiting_second_look' AND case_id IN ({marks})", case_ids)]
        else:
            waiting = [r[0] for r in conn.execute("SELECT case_id FROM cases WHERE status = 'awaiting_second_look'")]
        stamp = now()
        updates, events = [], []
        for case_id in waiting:
            if case_id in scores.index:
                pd_value, cutoff = float(scores.at[case_id, "pd_calibrated"]), float(scores.at[case_id, "cutoff"])
            else:
                # Online applications are not in the weekly batch, so score them one by one
                result = applicant.score(storage.get_model_roles()["second_look"], case_id)
                pd_value, cutoff = result["pd_calibrated"], result["second_look"]["threshold"]
            status = second_look_status(pd_value, cutoff, settings["review_band"])
            updates.append((status, pd_value, cutoff, stamp, case_id))
            events.append((case_id, stamp, actor, "second look",
                           f"Adjusted risk {pd_value:.1%} vs cut-off {cutoff:.1%}: {STATUSES[status].lower()}"))
        conn.executemany("UPDATE cases SET status = ?, second_look_pd = ?, second_look_cutoff = ?, updated_at = ? WHERE case_id = ?", updates)
        conn.executemany("INSERT INTO events (case_id, at, actor, action, detail) VALUES (?, ?, ?, ?, ?)", events)
    counts = pd.Series([u[0] for u in updates]).value_counts().to_dict() if updates else {}
    return {"sent": len(updates), "results": counts}


def submit_application(form):
    """A new online application: save it, let the primary model decide, then Second Look if needed."""
    settings = get_settings()
    case_id = applications.save(form)
    primary_pd = applicant.score(storage.get_model_roles()["primary"], case_id)["pd_raw"]
    approved = primary_pd < settings["primary_cutoff"]
    status = "approved_primary" if approved else "awaiting_second_look"
    stamp = now()
    with connect() as conn:
        conn.execute("INSERT INTO cases (case_id, week, thin_file, status, primary_pd, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                     (case_id, applications.online_week(), int(not form["has_credit_history"]), status, primary_pd, stamp))
        conn.execute("INSERT INTO events (case_id, at, actor, action, detail) VALUES (?, ?, ?, ?, ?)",
                     (case_id, stamp, "applicant", "application received", "Submitted online"))
        conn.execute("INSERT INTO events (case_id, at, actor, action, detail) VALUES (?, ?, ?, ?, ?)",
                     (case_id, stamp, "system", "primary decision",
                      f"Primary model risk {primary_pd:.1%} vs cut-off {settings['primary_cutoff']:.0%}: "
                      f"{'approved' if approved else 'declined'}"))
    if not approved and settings["mode"] == "auto":
        send_to_second_look([case_id], actor="system (automatic routing)")
    return get_case(case_id)


# Human review

def rescore(case_id, changes):
    """What the second-look model says with the reviewer's changes (nothing is saved)."""
    run_id = storage.get_model_roles()["second_look"]
    result = applicant.score(run_id, case_id, changes)
    return {
        "pd": result["pd_calibrated"],
        "cutoff": result["second_look"]["threshold"],
        "model_approves": result["second_look"]["approve"],
        "reasons": result["reasons"],
        "editable": result["editable"],
    }


def decide(case_id, decision, reason, changes, reviewer):
    """A reviewer's final decision. Approving against the model needs a written reason."""
    case = get_case(case_id)["case"]
    if case["status"] != "in_review":
        raise ValueError("Only cases waiting for human review can be decided here")
    check = rescore(case_id, changes)
    if decision == "approve":
        override = not check["model_approves"]
        if override and not (reason or "").strip():
            raise ValueError("Approving against the model needs a reason")
        status = "approved_review"
        action = "override approval" if override else ("approved with changes" if changes else "approved")
    else:
        status = "declined_review"
        action = "declined"
    detail = {
        "reason": reason,
        "changes": changes,
        "risk_after_changes": round(check["pd"], 4),
        "cutoff": check["cutoff"],
        "model_approves_after_changes": check["model_approves"],
    }
    amount = changes.get("credamount_770A") if status == "approved_review" else None
    with connect() as conn:
        conn.execute("UPDATE cases SET status = ?, approved_amount = ?, updated_at = ? WHERE case_id = ?",
                     (status, amount, now(), case_id))
        conn.execute("INSERT INTO events (case_id, at, actor, action, detail) VALUES (?, ?, ?, ?, ?)",
                     (case_id, now(), reviewer or "reviewer", action, json.dumps(detail)))
    return get_case(case_id)


# Reading the pipeline

def get_case(case_id):
    with connect() as conn:
        case = conn.execute("SELECT * FROM cases WHERE case_id = ?", (case_id,)).fetchone()
        if case is None:
            raise KeyError(f"Application {case_id} has not entered the pipeline yet")
        events = conn.execute("SELECT at, actor, action, detail FROM events WHERE case_id = ? ORDER BY id", (case_id,)).fetchall()
    details = applications.public_details(case_id) if applications.is_online(case_id) else None
    return {"case": {**dict(case), "status_label": STATUSES[case["status"]], "application": details},
            "events": [dict(e) for e in events]}


def list_cases(status=None, week=None, thin_file=None, limit=50, offset=0):
    where, args = [], []
    if status:
        where.append("status = ?")
        args.append(status)
    if week is not None:
        where.append("week = ?")
        args.append(week)
    if thin_file is not None:
        where.append("thin_file = ?")
        args.append(int(thin_file))
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    with connect() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM cases {clause}", args).fetchone()[0]
        # Borderline cases first: the smallest distance to the cut-off
        rows = conn.execute(
            f"SELECT * FROM cases {clause} ORDER BY (second_look_pd - second_look_cutoff) IS NULL, "
            f"(second_look_pd - second_look_cutoff), case_id LIMIT ? OFFSET ?", args + [limit, offset]).fetchall()
    return {"total": total, "cases": [{**dict(r), "status_label": STATUSES[r["status"]],
                                       "online": applications.is_online(r["case_id"])} for r in rows]}


def summary():
    """Counts per stage, which weeks are processed, and how each route's approvals actually turned out."""
    with connect() as conn:
        df = pd.read_sql_query("SELECT case_id, week, thin_file, status FROM cases", conn)
    weeks = sorted(int(w) for w in features.load_features("test")["WEEK_NUM"].unique())
    if df.empty:
        return {"total": 0, "counts": {}, "weeks": [{"week": w, "processed": 0} for w in weeks], "outcomes": [],
                "weekly": [], "thin_file_counts": {}, "overrides": 0,
                "settings": get_settings(), "statuses": STATUSES, "roles": storage.get_model_roles()}

    df["defaulted"] = df["case_id"].map(features.load_solution())
    processed = df.groupby("week").size()
    weekly = df.groupby(["week", "status"]).size().unstack(fill_value=0)
    with connect() as conn:
        overrides = conn.execute("SELECT COUNT(*) FROM events WHERE action = 'override approval'").fetchone()[0]
    outcomes = []
    for status in ["approved_primary", "approved_second_look", "approved_review"]:
        part = df[(df["status"] == status) & df["defaulted"].notna()]  # online applications have no answer yet
        if len(part):
            outcomes.append({"status": status, "label": STATUSES[status], "approved": len(part),
                             "repaid_share": float(1 - part["defaulted"].mean()),
                             "thin_file_share": float(part["thin_file"].mean())})
    return {
        "total": len(df),
        "counts": df["status"].value_counts().to_dict(),
        "weeks": [{"week": w, "processed": int(processed.get(w, 0))} for w in weeks],
        "weekly": [{"week": int(week), **{status: int(n) for status, n in row.items()}} for week, row in weekly.iterrows()],
        "thin_file_counts": df[df["thin_file"] == 1]["status"].value_counts().to_dict(),
        "overrides": int(overrides),
        "outcomes": outcomes,
        "settings": get_settings(),
        "statuses": STATUSES,
        "roles": storage.get_model_roles(),
        "online_week": applications.online_week(),
    }


def applicant_status(case_id):
    """The stage an applicant sees: from the pipeline if the case is in it, otherwise worked out on the fly."""
    try:
        case = get_case(case_id)["case"]
        return {"status": case["status"], "label": STATUSES[case["status"]], "in_pipeline": True,
                "approved_amount": case["approved_amount"]}
    except KeyError:
        pass
    settings = get_settings()
    primary = primary_scores()
    if case_id not in primary.index:
        return {"status": None, "label": None, "in_pipeline": False, "approved_amount": None}
    if primary.at[case_id] < settings["primary_cutoff"]:
        status = "approved_primary"
    else:
        scores = second_look_scores()
        status = second_look_status(scores.at[case_id, "pd_calibrated"], scores.at[case_id, "cutoff"], settings["review_band"])
    return {"status": status, "label": STATUSES[status], "in_pipeline": False, "approved_amount": None}


def whatif(case_id, changes):
    """Where this application would land with these changes: primary, Second Look, review or declined."""
    roles = storage.get_model_roles()
    settings = get_settings()
    primary = applicant.score(roles["primary"], case_id, changes)
    if primary["pd_raw"] < settings["primary_cutoff"]:
        return {"status": "approved_primary", "label": STATUSES["approved_primary"], "approves": True}
    second = applicant.score(roles["second_look"], case_id, changes)
    status = second_look_status(second["pd_calibrated"], second["second_look"]["threshold"], settings["review_band"])
    return {"status": status, "label": STATUSES[status], "approves": status == "approved_second_look"}
