#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# claude-workflow-kit script
# Startet den Pruefauftrag am Tag: node .claude/kit/night.mjs --check
set -euo pipefail
cd "$(dirname "$0")"
exec node .claude/kit/night.mjs --check "$@"
