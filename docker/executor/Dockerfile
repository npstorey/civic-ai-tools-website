# Executor image for the `container` notebook-executor driver (S3b P4;
# src/lib/sandbox/container.ts). The container-runtime equivalent of the
# Vercel Sandbox snapshot built by scripts/build-sandbox-snapshot.ts:
# python3.13 + the pinned scientific stack + jupyter/nbconvert prebuilt, so
# per-run cost is container start + exec only.
#
# Build (once, and again after any pinned-version change):
#
#   docker build -t civic-notebook-executor:0.1.0 docker/executor
#
# PINNED VERSIONS ARE SINGLE-SOURCED: the `name==version` pins below MUST
# match src/lib/notebook-author/prompt.ts (PINNED_LIBRARIES), and the FROM
# line's python version MUST match PYTHON_RUNTIME_VERSION.
# src/lib/sandbox/container.test.ts asserts this file against that table, so
# drift here fails `npm test`.
FROM python:3.13-slim-bookworm

# Same package set the sandbox snapshot installs: the pinned scientific
# stack + the notebook tooling (EXECUTOR_TOOLING_PACKAGES in
# src/lib/sandbox/driver.ts).
RUN pip install --no-cache-dir --no-input \
    pandas==2.2.3 \
    requests==2.32.3 \
    numpy==2.1.3 \
    matplotlib==3.9.2 \
    jupyter ipykernel nbformat nbconvert

# Warm matplotlib's font cache at build time so the first notebook run in a
# fresh container does not emit the "building the font cache" notice into
# cell stderr output (which would land in the executed-notebook bytes).
RUN python -c "import matplotlib.pyplot"
