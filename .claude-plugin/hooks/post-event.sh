#!/bin/sh
# Post one Claude Code hook event to a running hountybunter, or park it.
#
# The one rule this file exists to obey: never block or slow the session that
# invoked it. Every path exits 0, every network call is time-bounded, and the
# reply is discarded. A harness that degrades its owner's real work is worse
# than no harness at all.

store="${HOUNTYBUNTER_HOME:-$HOME/.hountybunter}"
payload=$(cat)

# Nothing to do, and nothing to complain about.
[ -n "$payload" ] || exit 0

port=$(cat "$store/port" 2>/dev/null)
# Anything that is not a plain number is treated as no port at all: a stale or
# half-written file must not become a curl argument.
case "$port" in
  '' | *[!0-9]*) port='' ;;
esac

if [ -n "$port" ]; then
  if printf '%s' "$payload" |
    curl -s -o /dev/null --max-time 1 --connect-timeout 1 \
      -X POST -H 'content-type: application/json' --data-binary @- \
      "http://127.0.0.1:$port/hook" 2>/dev/null
  then
    exit 0
  fi
fi

# Delivery failed, so park it for `hb ingest` to replay. Literal newlines are
# stripped to keep one event per line; newlines *inside* JSON strings are
# already escaped, so this only removes formatting.
mkdir -p "$store" 2>/dev/null
printf '%s\n' "$(printf '%s' "$payload" | tr -d '\n')" >>"$store/spool.jsonl" 2>/dev/null

exit 0
