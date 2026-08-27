#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -r backend/requirements.txt
if [ ! -d frontend/node_modules ]; then
  (cd frontend && npm install)
fi
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 &
API_PID=$!
(cd frontend && npm run dev) &
UI_PID=$!
trap "kill $API_PID $UI_PID 2>/dev/null" EXIT
wait
