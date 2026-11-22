#!/bin/sh
# Prepara a pasta de dados (disco persistente) e inicia o painel sem privilégios de administrador do sistema.
set -e
mkdir -p "${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ] && command -v setpriv >/dev/null 2>&1; then
  chown -R node:node "${DATA_DIR:-/data}" 2>/dev/null || true
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
