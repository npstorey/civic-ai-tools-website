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
