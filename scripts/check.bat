@echo off
setlocal

:: Reports uncommitted changes, stashes and unpushed commits in
:: zmanager-desktop and every sibling repository. Read-only.
::   check.bat           use local remote-tracking refs (fast, offline)
::   check.bat fetch     fetch origin first so "behind" is also accurate

set "FETCH_ARG="
if /I "%~1"=="fetch" set "FETCH_ARG=-Fetch"
if not "%~1"=="" if not defined FETCH_ARG (
    echo Error: Unexpected argument "%~1".
    echo Usage: check.bat [fetch]
    exit /b 2
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-sibling-repos.ps1" %FETCH_ARG%
exit /b %ERRORLEVEL%
