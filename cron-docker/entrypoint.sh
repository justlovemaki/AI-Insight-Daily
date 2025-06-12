#!/bin/sh

# 退出脚本，如果任何命令失败
set -e

echo "--- 容器启动，执行初始化任务 ---"

# 检查构建脚本是否存在
if [ ! -f "/app/scripts/build.sh" ]; then
    echo "错误: 构建脚本 /app/scripts/build.sh 未找到!"
    exit 1
fi

# 1. 在容器启动时立即执行一次构建
echo "执行首次构建..."
/app/scripts/build.sh /app/scripts/work

mdbook serve --open -p 4399 -n 0.0.0.0 /app/scripts/work &

echo "--- 初始化完成，启动 cron 服务 ---"

# 2. 执行 Dockerfile CMD 中定义的命令 (即 "crond -f -l 8")
# exec 会用 CMD 的命令替换当前的 shell 进程，
# 使得 crond 成为容器的主进程 (PID 1)，能够正确接收和处理信号。
# 这是保持容器运行的关键。
exec "$@"