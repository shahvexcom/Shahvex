#!/usr/bin/env bash
set -eu
clone_deploy_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
clone_restore_root="$(cd -- "$clone_deploy_dir/../../.." && pwd)"
clone_python="$clone_restore_root/linux-root/home/nazeer_ahmed/miniconda3/envs/cosyvoice/bin/python"
cd "$clone_deploy_dir"
exec "$clone_python" -m uvicorn clone_voice_api:app --host 127.0.0.1 --port 8780 --workers 1
