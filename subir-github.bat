@echo off
title Enviar Sistema de Rifas para o GitHub
color 0B
cd /d "%~dp0"
echo ========================================================
echo        ENVIANDO CODIGO PARA O REPOSITORIO GITHUB...
echo ========================================================
echo.
echo Repositorio: https://github.com/brenan-araujo/sistema-rifas.git
echo.
git push -u origin main
echo.
if %errorlevel% equ 0 (
  echo ========================================================
  echo  [SUCESSO] O PROJETO FOI PUBLICADO NO SEU GITHUB!
  echo ========================================================
) else (
  echo ========================================================
  echo  Houve uma falha ao enviar. Verifique o login no GitHub.
  echo ========================================================
)
echo.
pause
