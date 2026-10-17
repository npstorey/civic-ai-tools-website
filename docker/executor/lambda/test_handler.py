"""Unit tests for the Lambda handler (#530 P2).

Run INSIDE the lambda image only, as a user with no other processes:

    node --experimental-strip-types scripts/lambda-image-check.mjs handler-tests

`sweep` kills every process its user owns, so on a workstation it would kill
the user's session. The tests that call it refuse to run unless the check
script's marker is set, and the script runs them in a fresh container as a
user nothing else runs as.
"""

import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import handler  # noqa: E402

IN_SANDBOX = os.environ.get('LAMBDA_HANDLER_TEST_SANDBOX') == '1'


class EncodeResponseBoundary(unittest.TestCase):
    """Ruling D2: inline up to the limit, a refusal one byte past it."""

    def result_of_size(self, size):
        """A response dict whose serialized form is exactly `size` bytes."""
        base = {'protocol': 1, 'requestId': 'r', 'exitCode': 0, 'executed': ''}
        empty = len(handler.encode_response(base, limit=10**9))
        base['executed'] = 'A' * (size - empty)
        self.assertEqual(len(handler.encode_response(base, limit=10**9)), size)
        return base

    def test_one_byte_under_the_limit_is_returned_whole(self):
        limit = 4096
        body = handler.encode_response(self.result_of_size(limit - 1), limit=limit)
        self.assertEqual(len(body), limit - 1)
        self.assertNotIn('refused', json.loads(body))

    def test_exactly_the_limit_is_returned_whole(self):
        limit = 4096
        body = handler.encode_response(self.result_of_size(limit), limit=limit)
        self.assertEqual(len(body), limit)
        self.assertNotIn('refused', json.loads(body))

    def test_one_byte_over_the_limit_is_refused_with_its_size(self):
        limit = 4096
        body = json.loads(handler.encode_response(self.result_of_size(limit + 1), limit=limit))
        self.assertEqual(body['refused'], 'response-too-large')
        self.assertEqual(body['bytes'], limit + 1)
        self.assertEqual(body['limit'], limit)
        self.assertEqual(body['requestId'], 'r')

    def test_the_default_limit_is_six_mebibytes(self):
        self.assertEqual(handler.RESPONSE_LIMIT_BYTES, 6 * 1024 * 1024)


class NotebookEnvironment(unittest.TestCase):
    """Ruling D5, and the runtime's variables kept from the notebook."""

    def setUp(self):
        self.saved = dict(os.environ)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.saved)

    def test_function_held_tokens_come_from_the_function_and_cannot_be_overridden(self):
        os.environ['SOCRATA_APP_TOKEN'] = 'from-the-function'
        os.environ.pop('DC_API_KEY', None)
        env = handler.notebook_env({'SOCRATA_APP_TOKEN': 'from-the-payload', 'EXTRA': 'x'})
        self.assertEqual(env['SOCRATA_APP_TOKEN'], 'from-the-function')
        self.assertNotIn('DC_API_KEY', env)
        self.assertEqual(env['EXTRA'], 'x')

    def test_the_function_proxy_reaches_the_notebook_in_both_spellings(self):
        os.environ['HTTPS_PROXY'] = 'http://egress.example:3128'
        os.environ['https_proxy'] = 'http://egress.example:3128'
        os.environ['NO_PROXY'] = 'metadata.internal'
        env = handler.notebook_env({})
        self.assertEqual(env['HTTPS_PROXY'], 'http://egress.example:3128')
        self.assertEqual(env['https_proxy'], 'http://egress.example:3128')
        self.assertEqual(env['NO_PROXY'], 'metadata.internal')

    def test_the_function_ca_settings_reach_the_notebook(self):
        # Set on the function or baked into a derived image with ENV: either way
        # they are in the handler's environment, and a notebook behind a proxy
        # that inspects TLS fails every fetch without them. `requests`, which
        # the fetch helpers use, reads REQUESTS_CA_BUNDLE (then CURL_CA_BUNDLE),
        # not SSL_CERT_FILE; Python's `ssl` reads SSL_CERT_FILE and SSL_CERT_DIR.
        settings = {
            'SSL_CERT_FILE': '/etc/ssl/certs/ca-certificates.crt',
            'SSL_CERT_DIR': '/etc/ssl/certs',
            'REQUESTS_CA_BUNDLE': '/etc/ssl/certs/ca-certificates.crt',
            'CURL_CA_BUNDLE': '/etc/ssl/certs/ca-certificates.crt',
        }
        os.environ.update(settings)
        env = handler.notebook_env({})
        for name, value in settings.items():
            self.assertEqual(env.get(name), value, name)

    def test_an_empty_ca_setting_is_not_passed(self):
        # An empty SSL_CERT_FILE names no file, and OpenSSL then loads no roots
        # at all rather than its default: every fetch would fail.
        for name in ('SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE'):
            os.environ[name] = ''
        env = handler.notebook_env({})
        for name in ('SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE'):
            self.assertNotIn(name, env)

    def test_the_runtime_and_its_credentials_are_not_passed(self):
        for name in ('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_LAMBDA_RUNTIME_API', '_HANDLER'):
            os.environ[name] = 'runtime-value'
        env = handler.notebook_env({})
        for name in env:
            self.assertFalse(name.startswith('AWS_') or name.startswith('_'), name)
        self.assertEqual(env['HOME'], handler.NOTEBOOK_HOME)
        self.assertEqual(env['MPLCONFIGDIR'], handler.NOTEBOOK_MPLCONFIGDIR)


class Context:
    aws_request_id = 'test-request-id'

    def get_remaining_time_in_millis(self):
        return 60_000


def payload(**overrides):
    event = {
        'protocol': handler.PROTOCOL,
        'files': [{'path': '/tmp/in.txt', 'content': 'hello'}],
        'command': {
            'cmd': sys.executable,
            'args': ['-c', "open('/tmp/out.txt','w').write(open('/tmp/in.txt').read().upper())"],
            'env': {},
        },
        'readBack': '/tmp/out.txt',
        'versionProbe': {'cmd': sys.executable, 'args': ['-c', 'print("3.13.99")']},
        'timeoutMs': 30_000,
    }
    event.update(overrides)
    return event


@unittest.skipUnless(IN_SANDBOX, 'runs only in the lambda image, through scripts/lambda-image-check.mjs')
class Handler(unittest.TestCase):
    def call(self, event):
        body = handler.handler(event, Context())
        self.assertIsInstance(body, bytes)
        return json.loads(body)

    def test_a_run_returns_what_the_command_wrote_and_the_probe_printed(self):
        result = self.call(payload())
        self.assertEqual(result['exitCode'], 0)
        self.assertEqual(base64.b64decode(result['executed']), b'HELLO')
        self.assertEqual(result['python'], '3.13.99')
        self.assertEqual(result['requestId'], 'test-request-id')

    def test_a_failing_command_returns_its_exit_code_and_stderr(self):
        failing = {'cmd': sys.executable, 'args': ['-c', 'import sys; sys.stderr.write("boom"); sys.exit(3)'], 'env': {}}
        result = self.call(payload(command=failing))
        self.assertEqual(result['exitCode'], 3)
        self.assertIn('boom', result['stderr'])
        self.assertNotIn('executed', result)

    def test_the_cap_stops_the_command_and_says_so(self):
        slow = {'cmd': sys.executable, 'args': ['-c', 'import time; time.sleep(30)'], 'env': {}}
        started = time.monotonic()
        result = self.call(payload(command=slow, timeoutMs=1500))
        self.assertLess(time.monotonic() - started, 10)
        self.assertEqual(result['exitCode'], -1)
        self.assertIn('wall-clock cap (1500ms) exceeded', result['stderr'])

    def test_a_path_outside_tmp_or_another_protocol_is_refused(self):
        self.assertEqual(self.call(payload(readBack='/etc/passwd'))['refused'], 'payload')
        self.assertEqual(self.call(payload(files=[{'path': '/tmp/../etc/x', 'content': ''}]))['refused'], 'payload')
        self.assertEqual(self.call(payload(protocol=99))['refused'], 'protocol')
        self.assertEqual(self.call('not an object')['refused'], 'protocol')

    def test_nothing_a_run_leaves_is_there_when_it_returns(self):
        leaver = {
            'cmd': sys.executable,
            'args': ['-c', (
                "import subprocess,sys;"
                "open('/tmp/left-behind.txt','w').write('x');"
                "subprocess.Popen([sys.executable,'-c','import time; time.sleep(600)'],start_new_session=True);"
                "open('/tmp/out.txt','w').write('done')"
            )],
            'env': {},
        }
        # The detached process inherits the command's output; before the
        # handler captured to files, that held the handler until its timeout.
        started = time.monotonic()
        self.call(payload(command=leaver))
        self.assertLess(time.monotonic() - started, 10, 'a detached process held the handler')
        self.assertEqual(os.listdir('/tmp'), [])
        self.assertEqual(
            [p for p in handler._live_processes(os.getuid()) if p not in handler._ancestors()],
            [],
        )


#: The two function-held credentials, set on the function for these tests.
#: Inert, and not credential-shaped. The first carries a space, a slash, a plus
#: and double quotes; the second a backslash and a space: so each one's
#: URL-encoded and JSON-escaped forms differ from it.
CANARIES = {'SOCRATA_APP_TOKEN': 'fixture socrata/p9+"canary"', 'DC_API_KEY': 'fixture-dc\\p9 canary'}


def canary_forms():
    """Every form of both canaries, this file's own statement: raw, as
    JavaScript's encodeURIComponent writes it, and JSON-escaped."""
    from urllib.parse import quote
    return [
        (form, name)
        for name, value in CANARIES.items()
        for form in (value, quote(value, safe="!~*'()"), json.dumps(value)[1:-1])
    ]


def strings_in(value):
    """Every key and every string in a JSON value, at any depth."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [s for item in value for s in strings_in(item)]
    if isinstance(value, dict):
        return [s for key, item in value.items() for s in [key, *strings_in(item)]]
    return []


#: A cell that prints every form of both credentials through four kinds of
#: output: a stdout stream, an execute_result (text/plain), a display_data
#: (text/html), and an error output from an exception it catches and displays,
#: which leaves the run successful.
PRINTING_CELL = '\n'.join([
    'import json, os, urllib.parse',
    'from IPython.display import HTML, display',
    "values = [(n, os.environ[n]) for n in ('SOCRATA_APP_TOKEN', 'DC_API_KEY')]",
    "text = '\\n'.join(f'{n} {k} {f}' for n, v in values for k, f in "
    "(('raw', v), ('url', urllib.parse.quote(v, safe=\"!~*'()\")), ('json', json.dumps(v)[1:-1])))",
    'print(text)',
    'display(HTML(f"<pre>{text}</pre>"))',
    'try:',
    '    raise ValueError(text)',
    'except ValueError:',
    '    get_ipython().showtraceback()',
    'text',
])


def notebook_of(*sources):
    return json.dumps({
        'nbformat': 4,
        'nbformat_minor': 5,
        'metadata': {'kernelspec': {'name': 'python3', 'display_name': 'Python 3', 'language': 'python'}},
        'cells': [
            {'cell_type': 'code', 'id': f'cell-{i}', 'metadata': {}, 'execution_count': None, 'outputs': [], 'source': source}
            for i, source in enumerate(sources)
        ],
    })


NBCONVERT = {
    'cmd': 'jupyter',
    'args': [
        'nbconvert', '--to', 'notebook', '--execute',
        '--ExecutePreprocessor.timeout', '60', '--ExecutePreprocessor.allow_errors=False',
        '--output', '/tmp/executed.ipynb', '/tmp/notebook.ipynb',
    ],
    'env': {},
}


@unittest.skipUnless(IN_SANDBOX, 'runs only in the lambda image, through scripts/lambda-image-check.mjs')
class NotebookOutputsCarryNoCredential(unittest.TestCase):
    """A notebook output never carries the value of a notebook credential: the
    handler removes both function-held values, by value, from the executed
    notebook and from the stderr it returns."""

    def setUp(self):
        self.saved = dict(os.environ)
        os.environ.update(CANARIES)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.saved)

    def call(self, source):
        event = payload(
            files=[{'path': '/tmp/notebook.ipynb', 'content': notebook_of(source)}],
            command=NBCONVERT,
            readBack='/tmp/executed.ipynb',
            timeoutMs=120_000,
        )
        return json.loads(handler.handler(event, Context()))

    def test_the_executed_notebook_carries_neither_value_and_marks_where_each_stood(self):
        result = self.call(PRINTING_CELL)
        self.assertEqual(result['exitCode'], 0, result.get('stderr'))
        notebook = json.loads(base64.b64decode(result['executed']))
        strings = strings_in(notebook)
        for form, _name in canary_forms():
            self.assertFalse([s for s in strings if form in s], f'the executed notebook carries {form!r}')
        outputs = notebook['cells'][0]['outputs']
        kinds = {
            'stdout': [o for o in outputs if o['output_type'] == 'stream' and o['name'] == 'stdout'],
            'execute_result': [o for o in outputs if o['output_type'] == 'execute_result'],
            'display_data': [o for o in outputs if o['output_type'] == 'display_data'],
            'error': [o for o in outputs if o['output_type'] == 'error'],
        }
        # A marker stands only where a value was printed, so this is also the
        # premise: each kind of output carried both values before the removal.
        for kind, found in kinds.items():
            self.assertTrue(found, f'no {kind} output: {outputs!r}')
            text = ''.join(strings_in(found))
            for name in CANARIES:
                self.assertIn(f'[{name} removed]', text, kind)
        stdout = ''.join(strings_in(kinds['stdout']))
        self.assertEqual(stdout, ''.join(
            f'{name} {kind} [{name} removed]\n' for name in CANARIES for kind in ('raw', 'url', 'json')
        ))

    def test_a_failing_notebook_returns_stderr_carrying_neither_value(self):
        failing = '\n'.join([
            'import json, os, sys, urllib.parse',
            "for n in ('SOCRATA_APP_TOKEN', 'DC_API_KEY'):",
            '    v = os.environ[n]',
            "    print(n, v, urllib.parse.quote(v, safe=\"!~*'()\"), json.dumps(v)[1:-1], file=sys.stderr)",
            "raise KeyError(os.environ['DC_API_KEY'])",
        ])
        result = self.call(failing)
        self.assertNotEqual(result['exitCode'], 0)
        stderr = result['stderr']
        self.assertIn('KeyError', stderr, 'the failure did not reach nbconvert\'s stderr')
        for form, _name in canary_forms():
            self.assertNotIn(form, stderr, f'the returned stderr carries {form!r}')
        for name in CANARIES:
            self.assertIn(f'[{name} removed]', stderr)


@unittest.skipUnless(IN_SANDBOX, 'runs only in the lambda image, through scripts/lambda-image-check.mjs')
class Sweep(unittest.TestCase):
    def test_sweep_kills_a_detached_process_and_empties_the_directory(self):
        scratch = tempfile.mkdtemp(dir='/tmp')
        open(os.path.join(scratch, 'f'), 'w').close()
        child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(600)'], start_new_session=True)
        killed = handler.sweep()
        self.assertGreaterEqual(killed, 1)
        child.wait(timeout=5)
        self.assertEqual(os.listdir('/tmp'), [])


if __name__ == '__main__':
    unittest.main()
