@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Analogos Tierra Luna Marte - NASA Space Apps 2026 (J4Ks)
echo Abriendo el visor en el navegador...
echo (No cierres esta ventana mientras lo usas.)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor.ps1" -Puerto 8123
echo.
echo El visor se cerro. Podes volver a abrirlo con doble clic en ABRIR.bat
pause
