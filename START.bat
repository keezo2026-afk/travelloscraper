@echo off
cd /d "%~dp0"
if not exist .venv (
  python -m venv .venv
)
call .venv\Scripts\activate
pip install -r backend\requirements.txt
if not exist node_modules (
  npm install
)
start "Travello API" cmd /k "call .venv\Scripts\activate && python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000"
timeout /t 2 /nobreak >nul
start "Travello UI" cmd /k "npm run dev"
start http://localhost:3000
