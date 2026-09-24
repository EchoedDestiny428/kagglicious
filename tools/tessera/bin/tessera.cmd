@echo off
rem Runs the tessera CLI with the runtime of the Tessera window that started this shell.
setlocal
set ELECTRON_RUN_AS_NODE=1
"%TESSERA_NODE%" "%TESSERA_CLI%" %*
