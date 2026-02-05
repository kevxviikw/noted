# main.py
import os
import sqlite3
from datetime import date, datetime
from typing import Optional, List, Dict

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

DB_PATH = os.environ.get("NOTED_DB", "NOTED.db")
API_TOKEN = os.environ.get("NOTED_TOKEN", "").strip()  # optional (set to require a bearer token)
STATIC_DIR = os.environ.get("NOTED_STATIC", "static")

# ----------------- DB Utilities -----------------
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS goals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL
        );
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS checks (
            goal_id INTEGER NOT NULL,
            day TEXT NOT NULL,          -- YYYY-MM-DD
            done INTEGER NOT NULL CHECK (done IN (0,1)),
            PRIMARY KEY (goal_id, day),
            FOREIGN KEY(goal_id) REFERENCES goals(id) ON DELETE CASCADE
        );
    """)
    conn.commit()
    return conn

# ----------------- Auth (optional) -----------------
def require_token(authorization: Optional[str] = Header(default=None)):
    if not API_TOKEN:
        return True
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.split(" ", 1)[1].strip()
    if token != API_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid token")
    return True

# ----------------- Schemas -----------------
class GoalCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)

class GoalOut(BaseModel):
    id: int
    name: str
    created_at: str

class GoalRename(BaseModel):
    name: str = Field(min_length=1, max_length=120)

class CheckSet(BaseModel):
    done: bool

class ChecksOut(BaseModel):
    checks: Dict[str, bool]

class StatsOut(BaseModel):
    current_streak: int
    longest_streak: int
    completion_rate: float

# ----------------- App -----------------
app = FastAPI(title="Noted API", version="1.0")

@app.get("/api/health")
def health():
    return {"ok": True, "time": datetime.utcnow().isoformat()}

# ----- Goals -----
@app.get("/api/goals", response_model=List[GoalOut], dependencies=[Depends(require_token)])
def list_goals():
    conn = get_conn()
    rows = conn.execute("SELECT id, name, created_at FROM goals ORDER BY created_at ASC").fetchall()
    return [GoalOut(**dict(r)) for r in rows]

@app.post("/api/goals", response_model=GoalOut, dependencies=[Depends(require_token)])
def create_goal(g: GoalCreate):
    conn = get_conn()
    ts = datetime.utcnow().isoformat()
    try:
        cur = conn.execute("INSERT INTO goals (name, created_at) VALUES (?, ?)", (g.name.strip(), ts))
        conn.commit()
        gid = cur.lastrowid
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Goal name already exists")
    row = conn.execute("SELECT id, name, created_at FROM goals WHERE id = ?", (gid,)).fetchone()
    return GoalOut(**dict(row))

@app.patch("/api/goals/{goal_id}", response_model=GoalOut, dependencies=[Depends(require_token)])
def rename_goal(goal_id: int, body: GoalRename):
    conn = get_conn()
    try:
        conn.execute("UPDATE goals SET name = ? WHERE id = ?", (body.name.strip(), goal_id))
        conn.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Goal name already exists")
    row = conn.execute("SELECT id, name, created_at FROM goals WHERE id = ?", (goal_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Goal not found")
    return GoalOut(**dict(row))

@app.delete("/api/goals/{goal_id}", dependencies=[Depends(require_token)])
def delete_goal(goal_id: int):
    conn = get_conn()
    cur = conn.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
    conn.commit()
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Goal not found")
    return {"ok": True}

# ----- Checks -----
@app.get("/api/goals/{goal_id}/checks", response_model=ChecksOut, dependencies=[Depends(require_token)])
def get_checks(goal_id: int, start: Optional[str] = None, end: Optional[str] = None):
    conn = get_conn()
    if not conn.execute("SELECT 1 FROM goals WHERE id = ?", (goal_id,)).fetchone():
        raise HTTPException(status_code=404, detail="Goal not found")

    q = "SELECT day, done FROM checks WHERE goal_id = ?"
    params: List = [goal_id]
    if start and end:
        q += " AND day BETWEEN ? AND ?"
        params.extend([start, end])
    rows = conn.execute(q, params).fetchall()
    out = {r["day"]: bool(r["done"]) for r in rows}
    return ChecksOut(checks=out)

@app.put("/api/goals/{goal_id}/checks/{day}", dependencies=[Depends(require_token)])
def set_check(goal_id: int, day: str, body: CheckSet):
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid day format, expected YYYY-MM-DD")
    conn = get_conn()
    if not conn.execute("SELECT 1 FROM goals WHERE id = ?", (goal_id,)).fetchone():
        raise HTTPException(status_code=404, detail="Goal not found")
    conn.execute("""
        INSERT INTO checks (goal_id, day, done) VALUES (?, ?, ?)
        ON CONFLICT(goal_id, day) DO UPDATE SET done=excluded.done
    """, (goal_id, day, 1 if body.done else 0))
    conn.commit()
    return {"ok": True, "day": day, "done": body.done}

# ----- Stats -----
@app.get("/api/goals/{goal_id}/stats", response_model=StatsOut, dependencies=[Depends(require_token)])
def stats(goal_id: int, year: Optional[int] = None, month: Optional[int] = None):
    conn = get_conn()
    if not conn.execute("SELECT 1 FROM goals WHERE id = ?", (goal_id,)).fetchone():
        raise HTTPException(status_code=404, detail="Goal not found")

    rows = conn.execute("SELECT day, done FROM checks WHERE goal_id = ?", (goal_id,)).fetchall()
    marks = {r["day"]: bool(r["done"]) for r in rows}

    # longest streak
    days_sorted = sorted(k for k,v in marks.items() if v)
    longest, run, prev = 0, 0, None
    for iso in days_sorted:
        d = datetime.strptime(iso, "%Y-%m-%d").date()
        if prev and d.toordinal() - prev.toordinal() == 1:
            run += 1
        else:
            run = 1
        longest = max(longest, run)
        prev = d

    # current streak
    cs = 0
    t = date.today()
    while marks.get(t.isoformat(), False):
        cs += 1
        t = date.fromordinal(t.toordinal() - 1)

    # month completion rate
    rate = 0.0
    if year and month:
        from calendar import monthrange
        _, last = monthrange(year, month)
        done_count = sum(1 for d in range(1, last+1)
                         if marks.get(f"{year:04d}-{month:02d}-{d:02d}", False))
        rate = (done_count / last * 100.0) if last else 0.0

    return StatsOut(current_streak=cs, longest_streak=longest, completion_rate=rate)

# ----- Static (after API so it won't swallow /api/*) -----
os.makedirs(STATIC_DIR, exist_ok=True)

@app.get("/", include_in_schema=False)
def index():
    idx = os.path.join(STATIC_DIR, "index.html")
    if not os.path.exists(idx):
        return PlainTextResponse("Place index.html in ./static", status_code=404)
    return FileResponse(idx)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")