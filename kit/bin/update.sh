#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# claude-workflow-kit script
# Bringt das Projekt auf die veroeffentlichte Fassung: node .claude/kit/board.mjs update run
set -euo pipefail
cd "$(dirname "$0")"
exec node .claude/kit/board.mjs update run "$@"
