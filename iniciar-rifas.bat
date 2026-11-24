@echo off
title Sistema de Rifas Online
color 0A
cd /d "%~dp0"
echo ========================================================
echo         SISTEMA DE RIFAS ONLINE - INICIANDO...
echo ========================================================
echo.
echo Verificando dependencias...
if not exist node_modules (
  echo Instalando dependencias do sistema...
  call npm.cmd install
)
echo.
echo Iniciando servidor em http://localhost:3030 ...
echo.
echo Pressione Ctrl+C para encerrar.
echo ========================================================
node server.js
pause
