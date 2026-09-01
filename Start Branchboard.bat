@echo off
title Branchboard
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

node "server.js"
echo.
echo Branchboard has stopped.
pause
exit /b 0

:nonode
echo.
echo   Node.js was not found on this PC, so boards cannot be saved
echo   as files in the boards folder.
echo.
echo   You can still use Branchboard right now: close this window and
echo   double-click Branchboard.html instead. It works exactly the same,
echo   except boards are kept inside your browser rather than as files.
echo.
echo   To get file saving, install Node.js from https://nodejs.org
echo   and then run this starter again.
echo.
pause
exit /b 1
