"""The notebook executor's AWS Lambda handler (#530 P2; driver #3, ADR-0023 §D).

One invocation runs one notebook. The app's lambda driver
(src/lib/sandbox/lambda.ts) sends the files to stage, the nbconvert command
and the version probe exactly as `executeNotebook` builds them (ruling D1), and
this handler runs them as given and returns what they produced. It composes no
command of its own, so the argv an executed notebook comes out of is the one
the container and sandbox drivers run.

ISOLATION (ruling D3). Lambda reuses an execution environment across
invocations: /tmp and any process a run leaves behind survive into the next
one, and a reset after a crash or a timeout does not clear /tmp either (AWS,
"Lambda execution environment lifecycle"). Measured under the Runtime Interface
Emulator, a process left behind by one run could call the Runtime API's
`/next` and answer an invocation. So `sweep` kills every process this user
owns except the handler and its ancestors, then empties /tmp — before the
response is returned, so nothing is alive when the next event is handed out,
and again at the start of each run, which covers a run that timed out or
crashed before it could sweep. Residual, by the ruling: during its own run,
notebook code can reach the Runtime API and replace that run's response, which
is the power it already has over its own output bytes.

SECRETS (ruling D5). The two data-portal tokens are set on the function, never
sent in the payload: the handler adds them from its own environment. Nothing
here logs the event, the notebook, a traceback or a token; every failure is
returned as data, never raised, so the runtime client has nothing to print.

SIZE (ruling D2). The response is serialized here and returned as bytes, which
the runtime client passes through untouched, so the size checked is the size
sent. Above RESPONSE_LIMIT_BYTES the handler returns a refusal instead.

Standard library only, beside awslambdaric.
"""

import base64
import json
import os
import shutil
import signal
import subprocess
import time

#: The protocol the app's driver speaks (src/lib/sandbox/lambda.ts, LAMBDA_PROTOCOL).
PROTOCOL = 1

#: The only writable path in a Lambda image, and the only place a run may stage or read.
TMP = '/tmp'
#: HOME for the notebook's processes: IPython and Jupyter write under it.
NOTEBOOK_HOME = '/tmp/home'
#: A writable matplotlib cache, seeded from the image's warm one (IMAGE_MPLCONFIGDIR).
NOTEBOOK_MPLCONFIGDIR = '/tmp/matplotlib'
#: The cache the image warms at build time for uid 10001 (docker/executor/Dockerfile).
IMAGE_MPLCONFIGDIR = '/home/notebook/.config/matplotlib'

#: Set on the function, added to the notebook's environment here, never sent (D5).
#: Must equal FUNCTION_HELD_VARIABLES in src/lib/sandbox/lambda.ts; a test holds them equal.
FUNCTION_HELD_VARIABLES = ('SOCRATA_APP_TOKEN', 'DC_API_KEY')

#: Variables of this image's own environment the notebook keeps. Everything else
#: in the handler's environment is the Lambda runtime's, the function role's
#: credentials among it, and is not handed to the notebook's processes.
IMAGE_VARIABLES = ('PATH', 'LANG')

#: The egress proxy, set on the function, passed to the notebook in both
#: spellings as the container driver passes the app's: curl reads only the
#: lower case, Python both. A function in a VPC reaches the data portal
#: through it (docs/deploy.md, the Lambda executor).
PROXY_VARIABLES = ('HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy')

#: A synchronous invoke returns at most 6 MB (AWS, Lambda quotas). The handler
#: refuses above 6 MiB, the whole serialized response counted.
RESPONSE_LIMIT_BYTES = 6 * 1024 * 1024

#: Headroom kept below the function's own timeout so the handler can stop
#: nbconvert, sweep and answer before Lambda kills the invocation.
FUNCTION_TIMEOUT_MARGIN_S = 3.0
#: The version probe is one Python start-up; this bounds it.
PROBE_TIMEOUT_S = 30.0


def _parent(pid):
    """The parent of `pid`, from /proc, or 0 when it cannot be read."""
    try:
        with open(f'/proc/{pid}/stat', 'rb') as f:
            return int(f.read().rsplit(b')', 1)[1].split()[1])
    except (OSError, ValueError, IndexError):
        return 0


def _ancestors():
    """This process and every process above it: the runtime, the emulator, init."""
    pids, pid = set(), os.getpid()
    while pid > 0 and pid not in pids:
        pids.add(pid)
        pid = _parent(pid)
    return pids


def _live_processes(uid):
    """Every live (not zombie) process this user owns."""
    live = []
    for entry in os.listdir('/proc'):
        if not entry.isdigit():
            continue
        try:
            if os.stat(f'/proc/{entry}').st_uid != uid:
                continue
            with open(f'/proc/{entry}/stat', 'rb') as f:
                state = f.read().rsplit(b')', 1)[1].split()[0]
        except (OSError, IndexError):
            continue
        if state != b'Z':
            live.append(int(entry))
    return live


def sweep(tmp=TMP):
    """Kill every process this user owns but the handler's own line, then empty `tmp`.

    Returns the number of processes killed, for the tests. Repeats until a pass
    finds none, so a process that forks while it is being killed is caught on
    the next pass.
    """
    keep, uid, killed = _ancestors(), os.getuid(), 0
    for _ in range(20):
        victims = [pid for pid in _live_processes(uid) if pid not in keep]
        if not victims:
            break
        for pid in victims:
            try:
                os.kill(pid, signal.SIGKILL)
                killed += 1
            except OSError:
                pass
        time.sleep(0.05)
    try:
        while os.waitpid(-1, os.WNOHANG)[0] > 0:
            pass
    except ChildProcessError:
        pass
    for name in os.listdir(tmp):
        path = os.path.join(tmp, name)
        try:
            if os.path.isdir(path) and not os.path.islink(path):
                shutil.rmtree(path, ignore_errors=True)
            else:
                os.unlink(path)
        except OSError:
            pass
    return killed


def encode_response(result, limit=RESPONSE_LIMIT_BYTES):
    """The response as the bytes Lambda returns, or a refusal when they exceed `limit`."""
    body = json.dumps(result, separators=(',', ':')).encode('utf-8')
    if len(body) <= limit:
        return body
    refusal = {
        'protocol': PROTOCOL,
        'requestId': result.get('requestId'),
        'refused': 'response-too-large',
        'bytes': len(body),
        'limit': limit,
    }
    return json.dumps(refusal, separators=(',', ':')).encode('utf-8')


def _under_tmp(path):
    return isinstance(path, str) and os.path.isabs(path) and os.path.normpath(path).startswith(TMP + '/')


def _argv(command):
    cmd, args = command.get('cmd'), command.get('args')
    if not isinstance(cmd, str) or not isinstance(args, list) or not all(isinstance(a, str) for a in args):
        raise ValueError('command')
    return [cmd, *args]


def notebook_env(extra):
    """The environment the notebook's processes get: the image's own, the notebook
    paths, the function-held tokens, and the payload's variables."""
    env = {name: os.environ[name] for name in IMAGE_VARIABLES + PROXY_VARIABLES if name in os.environ}
    env['HOME'] = NOTEBOOK_HOME
    env['MPLCONFIGDIR'] = NOTEBOOK_MPLCONFIGDIR
    for name in FUNCTION_HELD_VARIABLES:
        if os.environ.get(name):
            env[name] = os.environ[name]
    for key, value in (extra or {}).items():
        if isinstance(key, str) and isinstance(value, str) and key not in FUNCTION_HELD_VARIABLES:
            env[key] = value
    return env


def _prepare_notebook_dirs():
    os.makedirs(NOTEBOOK_HOME, exist_ok=True)
    try:
        shutil.copytree(IMAGE_MPLCONFIGDIR, NOTEBOOK_MPLCONFIGDIR)
    except OSError:
        # An image with no warm cache there: the directory is still writable, so
        # matplotlib warns about nothing and builds its cache cold.
        os.makedirs(NOTEBOOK_MPLCONFIGDIR, exist_ok=True)


#: Where a command's output is captured: files, not pipes (see `_run_limited`).
CAPTURE_DIR = '/tmp/.lambda-executor'


def _run_limited(argv, env, seconds):
    """Run `argv` in its own session, killed as a group at `seconds`. (exit, stdout, stderr, timed_out).

    Output goes to files, not pipes. A process the notebook detaches inherits
    the command's stdout and stderr, and a pipe held open by it never reaches
    EOF: reading one waits for that process, so a notebook that starts anything
    in the background would hold the handler until Lambda killed it. Measured
    in this image's own tests before the change. A file needs no EOF: the
    handler waits for the command alone, and the sweep ends the rest.
    """
    os.makedirs(CAPTURE_DIR, exist_ok=True)
    out_path = os.path.join(CAPTURE_DIR, 'stdout')
    err_path = os.path.join(CAPTURE_DIR, 'stderr')
    with open(out_path, 'wb') as out_file, open(err_path, 'wb') as err_file:
        proc = subprocess.Popen(
            argv, cwd=TMP, env=env, stdin=subprocess.DEVNULL,
            stdout=out_file, stderr=err_file, start_new_session=True,
        )
    timed_out = False
    try:
        proc.wait(timeout=max(seconds, 0.001))
    except subprocess.TimeoutExpired:
        timed_out = True
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            pass
        proc.wait()
    with open(out_path, 'rb') as f:
        out = f.read()
    with open(err_path, 'rb') as f:
        err = f.read()
    return (-1 if timed_out else proc.returncode), out, err, timed_out


def run(event, request_id, remaining_s, started):
    """One notebook, as the payload describes it. Returns the response dict."""
    if not isinstance(event, dict) or event.get('protocol') != PROTOCOL:
        return {'protocol': PROTOCOL, 'requestId': request_id, 'refused': 'protocol'}
    files, command, read_back = event.get('files'), event.get('command'), event.get('readBack')
    probe, timeout_ms = event.get('versionProbe'), event.get('timeoutMs')
    if (
        not isinstance(files, list) or not isinstance(command, dict) or not isinstance(probe, dict)
        or not _under_tmp(read_back) or not isinstance(timeout_ms, int) or timeout_ms <= 0
    ):
        return {'protocol': PROTOCOL, 'requestId': request_id, 'refused': 'payload'}
    for item in files:
        if not isinstance(item, dict) or not _under_tmp(item.get('path')) or not isinstance(item.get('content'), str):
            return {'protocol': PROTOCOL, 'requestId': request_id, 'refused': 'payload'}
    try:
        argv, probe_argv = _argv(command), _argv(probe)
    except ValueError:
        return {'protocol': PROTOCOL, 'requestId': request_id, 'refused': 'payload'}

    _prepare_notebook_dirs()
    for item in files:
        with open(item['path'], 'w', encoding='utf-8') as f:
            f.write(item['content'])
    env = notebook_env(command.get('env'))

    # The session cap from the app, and the function's own timeout, whichever ends first.
    cap_s = timeout_ms / 1000.0 - (time.monotonic() - started)
    budget_s = min(cap_s, remaining_s - FUNCTION_TIMEOUT_MARGIN_S)
    exit_code, _out, err, timed_out = _run_limited(argv, env, budget_s)
    result = {'protocol': PROTOCOL, 'requestId': request_id, 'exitCode': exit_code}
    if exit_code != 0:
        stderr = err.decode('utf-8', 'replace')
        if timed_out:
            stderr += f'\n[lambda-executor] wall-clock cap ({timeout_ms}ms) exceeded — nbconvert stopped'
        result['stderr'] = stderr
        return result

    try:
        with open(read_back, 'rb') as f:
            result['executed'] = base64.b64encode(f.read()).decode('ascii')
    except OSError:
        result['executed'] = None
    probe_exit, probe_out, _err, _ = _run_limited(probe_argv, env, PROBE_TIMEOUT_S)
    result['python'] = probe_out.decode('utf-8', 'replace').strip() if probe_exit == 0 else None
    return result


def handler(event, context):
    """The entry point awslambdaric calls. Always returns bytes; never raises."""
    started = time.monotonic()
    request_id = getattr(context, 'aws_request_id', None)
    remaining_s = context.get_remaining_time_in_millis() / 1000.0
    try:
        sweep()
        result = run(event, request_id, remaining_s, started)
    except Exception as err:  # noqa: BLE001 — returned as data, by class only
        result = {'protocol': PROTOCOL, 'requestId': request_id, 'refused': 'handler', 'errorClass': type(err).__name__}
    finally:
        # Before the response goes out: nothing this run started may be alive
        # when the next event is handed over. A failure here must not become an
        # exception the runtime client would print.
        try:
            sweep()
        except Exception:  # noqa: BLE001
            pass
    return encode_response(result)
