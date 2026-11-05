#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# claude-workflow-kit script
# Bringt alle Projekte der Projektliste dieses Rechners auf die veroeffentlichte Fassung: node .claude/kit/board.mjs update all
set -euo pipefail
cd "$(dirname "$0")"
exec node .claude/kit/board.mjs update all "$@"
