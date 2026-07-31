@echo off
REM One-command start (Windows): database + uitp-server.
REM Prerequisites: Docker Desktop, JDK 21+, Node ^>= 22 (for the uitp runner).
cd /d "%~dp0"

echo [uitp-server] starting postgres (+ pgadmin) ...
docker compose up -d
if errorlevel 1 exit /b 1

if not exist ..\dist (
  echo [uitp-server] building the uitp runner ...
  pushd ..
  call npm install && call npx playwright install chromium && call npm run build
  popd
)

echo [uitp-server] starting Quarkus ...
call mvnw.cmd quarkus:dev
