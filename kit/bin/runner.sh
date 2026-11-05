#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# claude-workflow-kit script
# Startet den Runner: node .claude/kit/night.mjs
set -euo pipefail
cd "$(dirname "$0")"
exec node .claude/kit/night.mjs "$@"
