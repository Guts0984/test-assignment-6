#!/bin/sh
# Starts the web server and watches it. Docker only RESTARTS a container whose main process has exited;
# a server that is hung (alive but answering nothing) would stay "up" forever. So the entrypoint asks the
# server for the login page every 15 s and, after three misses in a row, kills it: the container then
# exits and the restart policy brings it back.
node dist/bootstrap.mjs || exit 1

node server.js &
server=$!
trap 'kill "$server" 2>/dev/null' TERM INT

probe() {
  node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/login', { signal: AbortSignal.timeout(5000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
}

misses=0
sleep 30 # startup
while kill -0 "$server" 2>/dev/null; do
  if probe; then misses=0; else misses=$((misses + 1)); fi
  if [ "$misses" -ge 3 ]; then
    echo "[watchdog] the server does not answer; restarting the container"
    kill -9 "$server" 2>/dev/null
    break
  fi
  sleep 15
done
wait "$server"
exit $?
