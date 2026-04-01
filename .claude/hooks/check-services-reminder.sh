#!/bin/bash
# Reminder hook: nudges user if /check-services hasn't run in 24h
TIMESTAMP_FILE="d:/newprojects/oneshoppos/.claude/.last-service-check"

if [ ! -f "$TIMESTAMP_FILE" ]; then
  echo "You've never run /check-services. Consider running it to check production health."
  exit 0
fi

LAST_CHECK=$(cat "$TIMESTAMP_FILE" 2>/dev/null || echo 0)
NOW=$(date +%s)
DIFF=$(( NOW - LAST_CHECK ))
HOURS=$(( DIFF / 3600 ))

if [ "$HOURS" -ge 24 ]; then
  echo "Last /check-services was ${HOURS}h ago. Run /check-services to check production health."
fi
