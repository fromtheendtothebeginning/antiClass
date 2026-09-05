@echo off
chcp 65001 >nul
cd /d %~dp0
if not exist backend\.venv\Scripts\pythonw.exe (
    echo [ERROR] 虚拟环境不存在，请先运行 setup.bat
    pause
    exit /b 1
)
start "" backend\.venv\Scripts\pythonw.exe backend\main.py
echo 后端已启动： http://127.0.0.1:8000
echo 管理员账号 admin / 密码 admin123
echo 停止：关闭进程或运行 stop.bat
pause