#!/bin/bash
# Runs the installed deployment script on the server through AWS Systems Manager, waits for it, and
# exits nonzero unless it succeeded. Used by .github/workflows/deploy.yml. Requires AWS credentials,
# a region, COMMIT_SHA and INSTANCE_ID in the environment.
#
# It polls itself because the AWS CLI's "wait command-executed" gives up after about 100 seconds.
set -euo pipefail

readonly REMOTE_SCRIPT=/usr/local/sbin/hopplink-deploy-web
readonly DELIVERY_TIMEOUT_SECONDS=120
readonly EXECUTION_TIMEOUT_SECONDS=900
readonly MAX_WAIT_SECONDS=${MAX_WAIT_SECONDS:-1080}
readonly POLL_INTERVAL_SECONDS=${POLL_INTERVAL_SECONDS:-5}

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ ${COMMIT_SHA:-} =~ ^[0-9a-f]{40}$ ]] || fail 'COMMIT_SHA must be a complete 40-character lowercase Git SHA'
[[ -n ${INSTANCE_ID:-} ]] || fail 'INSTANCE_ID is required'

command_id=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "Deploy HoppLink Web ${COMMIT_SHA:0:12}" \
  --timeout-seconds "$DELIVERY_TIMEOUT_SECONDS" \
  --parameters "{\"commands\":[\"$REMOTE_SCRIPT $COMMIT_SHA\"],\"executionTimeout\":[\"$EXECUTION_TIMEOUT_SECONDS\"]}" \
  --query Command.CommandId \
  --output text) || fail 'could not send the SSM deployment command'
[[ -n $command_id ]] || fail 'SSM did not return a command ID'
echo "SSM command $command_id is deploying $COMMIT_SHA"

invocation() {
  aws ssm get-command-invocation --command-id "$command_id" --instance-id "$INSTANCE_ID" --query "$1" --output text
}

print_remote_output() {
  echo '--- remote output ---'
  invocation StandardOutputContent || echo '(not available)'
  echo '--- remote errors ---'
  invocation StandardErrorContent || echo '(not available)'
  echo '---------------------'
}

errors=$(mktemp)
trap 'rm -f "$errors"' EXIT

SECONDS=0
while ((SECONDS < MAX_WAIT_SECONDS)); do
  # Right after sending, the invocation may not exist yet, so a failed lookup is retried until the limit.
  if status=$(invocation Status 2>"$errors"); then
    case $status in
      Success)
        print_remote_output
        echo 'Remote deployment succeeded.'
        exit 0
        ;;
      Pending | InProgress | Delayed | Cancelling) ;;
      *)
        print_remote_output
        fail "remote deployment ended with status: ${status:-unknown}"
        ;;
    esac
  fi
  sleep "$POLL_INTERVAL_SECONDS"
done

cat "$errors" >&2
fail "gave up waiting for SSM command $command_id; it may still be running on the server"
