@echo off
chcp 65001 >nul
cd /d %~dp0
if not exist backend\.venv\Scripts\python.exe (
    echo [INFO] 创建虚拟环境...
    python -m venv backend\.venv
)
echo [INFO] 安装后端依赖...
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt -i https://mirrors.aliyun.com/pypi/simple/ --no-cache-dir
if not exist frontend\node_modules (
    echo [INFO] 安装前端依赖...
    cd frontend
    call npm.cmd install
    cd ..
)
echo [INFO] 构建前端...
cd frontend
call npm.cmd run build
cd ..
echo 安装完成。运行 run.bat 启动服务。
pause