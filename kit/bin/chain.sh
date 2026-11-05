#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# claude-workflow-kit script
# Startet die Kette: node .claude/kit/night.mjs --chain
set -euo pipefail
cd "$(dirname "$0")"
exec node .claude/kit/night.mjs --chain "$@"
