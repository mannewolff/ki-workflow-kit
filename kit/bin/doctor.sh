#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# claude-workflow-kit script
# Prueft die Einrichtung: node .claude/kit/board.mjs doctor
set -euo pipefail
cd "$(dirname "$0")"
exec node .claude/kit/board.mjs doctor "$@"
