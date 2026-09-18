# Executor image for the `container` notebook-executor driver (S3b P4;
# src/lib/sandbox/container.ts). The container-runtime equivalent of the
# Vercel Sandbox snapshot built by scripts/build-sandbox-snapshot.ts:
# python3.13 + the pinned scientific stack + pinned jupyter/nbconvert
# prebuilt, so per-run cost is container start + exec only.
#
# Build (once, and again after any pinned-version change):
#
#   docker build -t civic-notebook-executor:0.2.0 docker/executor
#
# PINNED VERSIONS ARE SINGLE-SOURCED. The scientific `name==version` pins
# below MUST match src/lib/notebook-author/prompt.ts (PINNED_LIBRARIES), the
# notebook-tooling pins MUST match src/lib/sandbox/driver.ts
# (EXECUTOR_TOOLING_PACKAGES), and the FROM line's python version MUST match
# PYTHON_RUNTIME_VERSION. src/lib/sandbox/container.test.ts and
# src/lib/sandbox/executor-pins.test.ts assert this file against those
# tables — version equality, not names — so drift here fails `npm test`.
# @vercel/sandbox major: 1 (SANDBOX_SDK_MAJOR in src/lib/sandbox/driver.ts).
FROM python:3.13-slim-bookworm

# Same package set the sandbox snapshot installs: the pinned scientific
# stack + the pinned notebook tooling (EXECUTOR_TOOLING_PACKAGES in
# src/lib/sandbox/driver.ts). The tooling is pinned because an executed
# notebook's bytes come out of nbformat and nbconvert and go into a signed
# package (#450).
RUN pip install --no-cache-dir --no-input \
    pandas==2.2.3 \
    requests==2.32.3 \
    numpy==2.1.3 \
    matplotlib==3.9.2 \
    jupyter==1.1.1 \
    ipykernel==7.2.0 \
    nbformat==5.10.4 \
    nbconvert==7.17.1

# The executor is the one place model-written code runs, so it does not run
# it as root (#450). `notebook` owns its home; the driver stages the
# notebook under /tmp (src/lib/sandbox/execute.ts) and WORKDIR is /tmp so
# the process's working directory is writable by that user too.
RUN useradd --create-home --uid 10001 --shell /bin/bash notebook
ENV HOME=/home/notebook \
    MPLCONFIGDIR=/home/notebook/.config/matplotlib
WORKDIR /tmp
USER notebook

# Warm matplotlib's font cache at build time, AS THE USER THAT RUNS: a cache
# built under root's home is not read by `notebook`, so the first notebook
# run in a fresh container would rebuild it. Measured at the pinned
# matplotlib 3.9.2, a rebuild logs `generated new fontManager` at INFO, which
# at default log levels reaches nothing; a notebook that configures logging
# puts that line on cell stderr, and cell stderr is part of the
# executed-notebook bytes, which are signed. The warm removes the rebuild
# either way.
RUN python -c "import matplotlib.pyplot"
