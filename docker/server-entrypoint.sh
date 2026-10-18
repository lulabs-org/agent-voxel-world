#!/bin/sh
set -e

echo "[Server Entrypoint] 检查数据库连接并执行迁移..."

if [ -n "$DATABASE_URL" ]; then
  echo "[Server Entrypoint] 正在运行 Prisma 数据库迁移..."
  pnpm db:migrate || {
    echo "[Server Entrypoint] 迁移失败，正在重试一次（等待数据库完全启动）..."
    sleep 3
    pnpm db:migrate
  }
  echo "[Server Entrypoint] 数据库迁移成功完成！"
else
  echo "[Server Entrypoint] 未配置 DATABASE_URL，将以内存模式启动。"
fi

echo "[Server Entrypoint] 启动 Voxel Server..."
exec "$@"
