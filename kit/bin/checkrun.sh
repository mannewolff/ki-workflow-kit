#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# claude-workflow-kit script
# Faehrt die Pruefungen: node .claude/kit/checks.mjs run
set -euo pipefail
cd "$(dirname "$0")"
exec node .claude/kit/checks.mjs run "$@"
