# Where drive.sh runs its Linux cases (#514): the runner's image, so GNU tar
# 1.35, GNU grep and bash 5, plus jq for the migrate guard hook.
FROM ubuntu:24.04
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends jq >/dev/null \
 && rm -rf /var/lib/apt/lists/*
