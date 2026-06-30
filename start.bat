@echo off
pushd "%~dp0"
powershell -Command "$p = Start-Process -FilePath 'node' -ArgumentList 'server.js' -PassThru -WindowStyle Normal; [System.IO.File]::WriteAllText('server.pid', $p.Id.ToString())"
start http://localhost:3000