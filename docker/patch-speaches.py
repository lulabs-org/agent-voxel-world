"""Small, checked fixes for the pinned Speaches image; remove after upstream fixes."""
from pathlib import Path

root = Path('/home/ubuntu/speaches/src/speaches')
text_utils = root / 'text_utils.py'
source = text_utils.read_text()
# This accidental Unicode range includes Chinese, Japanese and Korean text.
old = r'"\U000024c2-\U0001f251"'
new = r'"\U000024c2\U0001f250\U0001f251"'
assert source.count(old) == 1, 'Speaches emoji filter changed: review this patch'
text_utils.write_text(source.replace(old, new))

piper_utils = root / 'executors/piper/utils.py'
source = piper_utils.read_text()
old = '''            if self.hf_model_filter.passes_filter(model_card_data):
                repo_id_parts'''
new = '''            if self.hf_model_filter.passes_filter(model_card_data):
                # A README can finish downloading before the ONNX model.
                try:
                    files = self.get_model_files(cached_repo_info.repo_id)
                    if not all(path.is_file() and path.stat().st_size > 0 for path in (files.model, files.config)):
                        continue
                except (StopIteration, FileNotFoundError):
                    continue
                repo_id_parts'''
assert source.count(old) == 1, 'Speaches Piper registry changed: review this patch'
piper_utils.write_text(source.replace(old, new))

from speaches.text_utils import strip_emojis, strip_markdown_emphasis
for text in ['你好，欢迎来到共享世界。', '日本語です。', '안녕하세요.', 'Hello world.']:
    assert strip_emojis(text + '😀🚀') == text
    assert strip_markdown_emphasis('**' + text + '**') == text
from types import SimpleNamespace
from unittest.mock import patch
from speaches.executors.piper import utils
registry = utils.model_registry
with patch.object(utils, 'get_cached_model_repos_info', return_value=[SimpleNamespace(repo_id='partial-download')]), \
     patch.object(utils, 'get_model_card_data_from_cached_repo_info', return_value={}), \
     patch.object(registry, 'hf_model_filter', SimpleNamespace(passes_filter=lambda _: True)), \
     patch.object(registry, 'get_model_files', side_effect=StopIteration):
    assert list(registry.list_local_models()) == []
print('Speaches patch checks passed: CJK preserved, emoji removed, incomplete models excluded.')
