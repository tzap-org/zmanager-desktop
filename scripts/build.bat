@echo off
setlocal enabledelayedexpansion

:: Local builds default to staging so an ordinary build cannot accidentally
:: generate hosted-account traffic against production. Production remains an
:: explicit choice: build.bat prod.
set "BUILD_ENV=%~1"
if not defined BUILD_ENV set "BUILD_ENV=staging"
if /I not "%BUILD_ENV%"=="staging" if /I not "%BUILD_ENV%"=="prod" (
    echo Error: Unsupported build environment "%BUILD_ENV%".
    echo Usage: build.bat [staging^|prod]
    exit /b 2
)
if not "%~2"=="" (
    echo Error: Unexpected argument "%~2".
    echo Usage: build.bat [staging^|prod]
    exit /b 2
)
if not "%~3"=="" (
    echo Error: Unexpected argument "%~3".
    echo Usage: build.bat [staging^|prod]
    exit /b 2
)
echo Hosted account build environment: %BUILD_ENV%

:: Get the root directory of the repository (parent of the scripts folder)
set "REPO_ROOT=%~dp0.."
for %%I in ("%REPO_ROOT%") do set "REPO_ROOT=%%~fI"

:: Enable Windows long-path support for this process if available.
:: Build artifacts in deeply-nested Cargo dependency trees can exceed the
:: legacy 260-char MAX_PATH limit; the OS supports longer paths when the
:: registry key is set.  We attempt to enable it non-destructively for the
:: lifetime of this console session.
reg query "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled 2>nul | find "0x1" >nul
if %ERRORLEVEL% neq 0 (
    echo NOTE: Windows long-path support is not enabled system-wide.
    echo   To enable it, run the following in an elevated prompt:
    echo     reg add "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f
    echo   The build will continue, but path-length failures are possible.
)

:: Use a short target directory to avoid Windows MAX_PATH (260 chars).
:: Build artifacts under src-tauri\target\ can reach 240+ chars with the
:: default layout; a single-level directory under the user profile saves
:: ~20 chars and decouples from the clone location.
if not defined CARGO_TARGET_DIR (
    set "CARGO_TARGET_DIR=%USERPROFILE%\.zmbuild"
)
if not exist "%CARGO_TARGET_DIR%" mkdir "%CARGO_TARGET_DIR%"
echo Cargo target directory: %CARGO_TARGET_DIR%

echo [1/4] Ensuring sibling repositories (tzap, zmanager, localsend-rs)...
powershell -ExecutionPolicy Bypass -File "%REPO_ROOT%\scripts\ensure-sibling-repos.ps1"
if %ERRORLEVEL% neq 0 (
    echo Error: Failed to ensure sibling repositories.
    exit /b 1
)

echo [2/4] Installing frontend dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo Error: npm install failed.
    exit /b 1
)

echo [3/4] Generating native contracts...
call npm run generate:contracts
if %ERRORLEVEL% neq 0 (
    echo Error: Failed to generate native contracts.
    exit /b 1
)

echo [4/4] Running static Windows build and installation...
powershell -ExecutionPolicy Bypass -File "%REPO_ROOT%\scripts\build-windows-static.ps1" -Environment "%BUILD_ENV%" -InstallClang -Install
if %ERRORLEVEL% neq 0 (
    echo Error: Build or installation failed.
    exit /b 1
)

echo Build and installation completed successfully.
exit /b 0
