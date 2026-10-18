"""Pinned official Chaowen model and offline Chinese resources for Speaches."""
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import tarfile
import tempfile

from huggingface_hub import hf_hub_download, ModelCardData
from huggingface_hub.constants import HF_HUB_CACHE

MODEL_ID = 'rhasspy/piper-voices/zh_CN-chaowen-medium'
VOICE_REVISION = 'c10ece1aade47bb51c153c893d14e5bf8e5b7117'
RESOURCE_REVISION = '37d1bea250e21ca0d617818d2bef1db724edb80c'
TOKENIZER_REVISION = '8f23c25b06e129b6c986331a13d8d025a92cf0ea'
ROOT = Path(HF_HUB_CACHE) / '.voxel-piper' / 'chaowen-v1'
REQUIRED = (
    'model.onnx', 'config.json', 'MODEL_CARD',
    'g2pW/g2pw.onnx', 'g2pW/config.py', 'g2pW/POLYPHONIC_CHARS.txt',
    'g2pW/MONOPHONIC_CHARS.txt', 'g2pW/version',
    'tokenizer/vocab.txt', 'tokenizer/config.json', 'tokenizer/tokenizer_config.json',
)


def installed():
    try:
        receipt = json.loads((ROOT / 'ready.json').read_text())
        return receipt['version'] == 1 and all(
            (ROOT / name).is_file() and (ROOT / name).stat().st_size == receipt['sizes'][name] > 0
            for name in REQUIRED
        )
    except (OSError, ValueError, KeyError, TypeError):
        return False


def model_files():
    if not installed():
        raise FileNotFoundError('Chaowen and its Chinese resources must be installed first')
    return ROOT / 'model.onnx', ROOT / 'config.json'


def model_card():
    return ModelCardData(library_name='onnx', pipeline_tag='text-to-speech',
                         tags=['speaches', 'piper'], language=['zh'])


def model_info():
    from speaches.executors.piper.utils import PiperModel, PiperModelVoice
    return PiperModel(id=MODEL_ID, created=0, owned_by='rhasspy', language=['zh'],
                      task='text-to-speech', sample_rate=22050,
                      voices=[PiperModelVoice(name='chaowen', language='zh')])


def _download(repo, filename, revision, destination, sha256=None, repo_type='model'):
    path = Path(hf_hub_download(repo, filename, revision=revision, repo_type=repo_type))
    if sha256 and hashlib.sha256(path.read_bytes()).hexdigest() != sha256:
        # Interrupted downloads can leave a corrupt HF cache entry. A retry must
        # repair it rather than repeatedly accepting the same cached file.
        path = Path(hf_hub_download(repo, filename, revision=revision,
                                   repo_type=repo_type, force_download=True))
        if hashlib.sha256(path.read_bytes()).hexdigest() != sha256:
            raise ValueError(f'Model checksum mismatch: {filename}')
    shutil.copyfile(path, destination)


def install():
    """Publish only after the complete model can synthesize; safe to retry."""
    ROOT.parent.mkdir(parents=True, exist_ok=True)
    with (ROOT.parent / 'chaowen.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if installed():
            return
        with tempfile.TemporaryDirectory(prefix='chaowen-install-', dir=ROOT.parent) as temp:
            stage = Path(temp)
            prefix = 'zh/zh_CN/chaowen/medium/zh_CN-chaowen-medium'
            _download('rhasspy/piper-voices', prefix + '.onnx', VOICE_REVISION, stage / 'model.onnx',
                      '820d64ac16048fbcf38dd0823d37fab5f5e0c2bd71b01ca5a50f553fac19e746')
            _download('rhasspy/piper-voices', prefix + '.onnx.json', VOICE_REVISION, stage / 'config.json',
                      'a6bb2caafa0645642f13cbf7e2f6fbbb16fded66e51109fc26d622f6472fa16f')
            _download('rhasspy/piper-voices', 'zh/zh_CN/chaowen/medium/MODEL_CARD', VOICE_REVISION, stage / 'MODEL_CARD')
            archive = stage / 'g2pw.tar.gz'
            _download('rhasspy/piper-checkpoints', 'zh/zh_CN/_resources/g2pw.tar.gz',
                      RESOURCE_REVISION, archive,
                      '252c6f561c11014fbb243d70aec993a816d82109887b91edcda0261ab9967060',
                      repo_type='dataset')
            resources = stage / 'g2pW'
            resources.mkdir()
            with tarfile.open(archive) as tar:
                tar.extractall(resources, filter='data')
            archive.unlink()
            tokenizer = stage / 'tokenizer'
            tokenizer.mkdir()
            for name in ['vocab.txt', 'config.json', 'tokenizer_config.json']:
                _download('google-bert/bert-base-chinese', name, TOKENIZER_REVISION, tokenizer / name)
            config = resources / 'config.py'
            original = config.read_text()
            old = "model_source = 'bert-base-chinese'"
            if original.count(old) != 1:
                raise ValueError('Unexpected g2pW tokenizer config')
            config.write_text(original.replace(old, f'model_source = {str(tokenizer)!r}'))
            # Validate both the acoustic model and Chinese front end before reporting success.
            from piper import PiperVoice
            voice = PiperVoice.load(stage / 'model.onnx', config_path=stage / 'config.json', download_dir=stage)
            if sum(len(chunk.audio_int16_bytes) for chunk in voice.synthesize('你好，欢迎。')) < 3200:
                raise ValueError('Chaowen installation produced no usable audio')
            config.write_text(original.replace(old, f'model_source = {str(ROOT / "tokenizer")!r}'))
            sizes = {name: (stage / name).stat().st_size for name in REQUIRED}
            (stage / 'ready.json').write_text(json.dumps({'version': 1, 'sizes': sizes}))
            if ROOT.exists():
                shutil.rmtree(ROOT)  # Only an incomplete Chaowen install; other cached models stay intact.
            stage.rename(ROOT)


def remove():
    with (ROOT.parent / 'chaowen.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        shutil.rmtree(ROOT)
