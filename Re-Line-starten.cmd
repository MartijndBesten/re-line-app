@echo off
rem Dubbelklik om Re-Line te starten. Vereist Node.js 24 LTS (https://nodejs.org).
rem De database staat in de map data naast dit bestand en blijft op deze computer.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is niet gevonden. Installeer Node.js 24 LTS via https://nodejs.org en start daarna opnieuw.
  pause
  exit /b 1
)
node scripts\start.mjs
if errorlevel 1 pause
