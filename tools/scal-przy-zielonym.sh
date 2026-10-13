#!/usr/bin/env bash
# Scala pull request wyłącznie wtedy, gdy WSZYSTKIE zadania CI są zielone.
# Powstał po tym, jak scaliłem PR z czerwonym gitleaks — sprawdzanie wzrokiem
# zawodzi, a parsowanie kolumn psuje się na nazwach zadań ze spacjami.
set -euo pipefail
PR="${1:?podaj numer pull requesta}"

echo "Czekam, aż wszystkie zadania CI się skończą…"
for _ in $(seq 1 120); do
  WYNIKI=$(gh pr checks "$PR" --json name,state --jq '.[] | "\(.state)\t\(.name)"' || true)
  if [ -n "$WYNIKI" ] && ! echo "$WYNIKI" | grep -qE '^(IN_PROGRESS|QUEUED|PENDING)\b'; then
    break
  fi
  sleep 5
done

echo "$WYNIKI" | sed 's/^/  /'
if echo "$WYNIKI" | grep -qvE '^(SUCCESS|SKIPPED)\b'; then
  echo "CZERWONE — nie scalam. Napraw i spróbuj ponownie."
  exit 1
fi

gh pr merge "$PR" --squash --delete-branch
git checkout -q main && git fetch -q --prune origin && git reset -q --hard origin/main
echo "Scalone. main: $(git log --oneline -1)"
