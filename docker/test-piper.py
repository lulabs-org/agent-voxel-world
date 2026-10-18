"""Regression checks for the speech image's Piper adapter (no downloads)."""
import json
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from speaches import piper_chaowen as chaowen
from speaches.executors.piper import utils
from speaches.routers import speech


class PiperAdapterTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root_patch = patch.object(chaowen, 'ROOT', Path(self.temp.name) / 'chaowen')
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def ready(self):
        for name in chaowen.REQUIRED:
            path = chaowen.ROOT / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'test-data')
        (chaowen.ROOT / 'ready.json').write_text(json.dumps({
            'version': 1, 'sizes': {name: 9 for name in chaowen.REQUIRED},
        }))

    def test_missing_chinese_resources_are_not_installed(self):
        self.ready()
        self.assertTrue(chaowen.installed())
        (chaowen.ROOT / 'tokenizer/vocab.txt').unlink()
        self.assertFalse(chaowen.installed())
        with self.assertRaises(FileNotFoundError):
            utils.model_registry.get_model_files(chaowen.MODEL_ID)
        with patch.object(utils, 'get_cached_model_repos_info', return_value=[]):
            self.assertEqual(list(utils.model_registry.list_local_models()), [])

    def test_complete_install_survives_requery_and_skips_download(self):
        self.ready()
        with patch.object(chaowen, '_download', side_effect=AssertionError('must stay offline')):
            chaowen.install()
        with patch.object(utils, 'get_cached_model_repos_info', return_value=[]):
            self.assertEqual([m.id for m in utils.model_registry.list_local_models()], [chaowen.MODEL_ID])
        self.assertTrue(utils.hf_model_filter.passes_filter(chaowen.model_card()))
        self.assertFalse(speech.kokoro_utils.hf_model_filter.passes_filter(chaowen.model_card()))

    def test_failed_install_cleans_staging_and_can_retry(self):
        with patch.object(chaowen, '_download', side_effect=OSError('network failed')) as download:
            for _ in range(2):
                with self.assertRaises(OSError):
                    chaowen.install()
                self.assertFalse(chaowen.installed())
                self.assertEqual(list(chaowen.ROOT.parent.glob('chaowen-install-*')), [])
            self.assertEqual(download.call_count, 2)

    def test_corrupt_cached_model_is_redownloaded_and_verified(self):
        bad, good = Path(self.temp.name) / 'bad', Path(self.temp.name) / 'good'
        bad.write_bytes(b'incomplete')
        good.write_bytes(b'verified-model')
        dest = Path(self.temp.name) / 'downloaded'
        digest = hashlib.sha256(good.read_bytes()).hexdigest()
        with patch.object(chaowen, 'hf_hub_download', side_effect=[str(bad), str(good)]) as download:
            chaowen._download('repo', 'model', 'revision', dest, digest)
            self.assertTrue(download.call_args.kwargs['force_download'])
        self.assertEqual(dest.read_bytes(), good.read_bytes())
        dest.unlink()
        with patch.object(chaowen, 'hf_hub_download', return_value=str(bad)):
            with self.assertRaises(ValueError):
                chaowen._download('repo', 'model', 'revision', dest, digest)
        self.assertFalse(dest.exists())

    def test_new_piper_stream_preserves_pcm_and_speed(self):
        calls = []
        def synthesize(text, config):
            calls.append((text, config.length_scale))
            yield SimpleNamespace(audio_int16_bytes=b'\x01\x00' * 22050)
        voice = SimpleNamespace(config=SimpleNamespace(sample_rate=22050), synthesize=synthesize)
        audio = b''.join(utils.generate_audio(voice, '你好', speed=0.8, sample_rate=16000))
        self.assertEqual(len(audio), 32000)
        self.assertEqual(calls, [('你好', 1.25)])


unittest.main()
