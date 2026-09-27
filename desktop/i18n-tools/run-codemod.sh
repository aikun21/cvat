#!/usr/bin/env bash
# Runs the i18n codemod over the parts of cvat-ui used by the desktop (video annotation) build.
# Idempotent: already wrapped strings are skipped.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export NODE_PATH="$ROOT/node_modules"
cd "$ROOT/cvat-ui/src"
C=components
node "$ROOT/desktop/i18n-tools/codemod.js" \
  $C/annotation-page $C/create-task-page $C/header $C/labels-editor $C/tasks-page $C/task-page $C/jobs-page $C/job-item \
  $C/projects-page $C/project-page $C/create-project-page $C/create-job-page $C/import-dataset $C/export-dataset \
  $C/import-backup $C/export-backup $C/file-manager $C/common $C/login-page $C/register-page $C/signing-common \
  $C/requests-page $C/shortcuts-dialog $C/global-error-boundary $C/resource-sorting-filtering $C/label-selector \
  $C/selectors $C/bulk-wrapper.tsx $C/bulk-progress.tsx $C/dropdown-menu.tsx $C/md-guide $C/move-task-modal \
  $C/server-unavailable $C/cvat-app.tsx $C/storage $C/profile-page $C/logout-component.tsx $C/layout-grid \
  $C/export-csv-button-hoc.tsx containers reducers actions utils "$@"
