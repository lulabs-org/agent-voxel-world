"""Adapt the pinned Speaches API to Piper 1.8 and the official Chaowen bundle."""
from pathlib import Path

root = Path('/home/ubuntu/speaches/src/speaches')

def replace(file, old, new):
    path = root / file
    source = path.read_text()
    assert source.count(old) == 1, f'Speaches changed: review {file}: {old}'
    path.write_text(source.replace(old, new))

utils = 'executors/piper/utils.py'
replace(utils, 'import huggingface_hub', 'import huggingface_hub\nfrom speaches import piper_chaowen as chaowen')
replace(utils, '        models = huggingface_hub.list_models(', '        yield chaowen.model_info()\n        models = huggingface_hub.list_models(')
replace(utils, '        cached_model_repos_info = get_cached_model_repos_info()',
        '        if chaowen.installed():\n            yield chaowen.model_info()\n        cached_model_repos_info = get_cached_model_repos_info()')
replace(utils, '        model_files = list(list_model_files(model_id))',
        '        if model_id == chaowen.MODEL_ID:\n            model, config = chaowen.model_files()\n            return PiperModelFiles(model=model, config=config)\n        model_files = list(list_model_files(model_id))')
replace(utils, '        _model_repo_path_str = huggingface_hub.snapshot_download(',
        '        if model_id == chaowen.MODEL_ID:\n            chaowen.install()\n            return\n        _model_repo_path_str = huggingface_hub.snapshot_download(')
replace(utils, '    for audio_bytes in piper_tts.synthesize_stream_raw(text, length_scale=1.0 / speed):',
        '    from piper import SynthesisConfig\n    for chunk in piper_tts.synthesize(text, SynthesisConfig(length_scale=1.0 / speed)):\n        audio_bytes = chunk.audio_int16_bytes')
manager = 'executors/piper/model_manager.py'
replace(manager, '        return PiperVoice(session=inf_sess, config=conf)',
        '        from speaches import piper_chaowen as chaowen\n        return PiperVoice(session=inf_sess, config=conf, download_dir=chaowen.ROOT)')
models = 'routers/models.py'
replace(models, 'from speaches.api_types import (', 'from speaches import piper_chaowen as chaowen\n\nfrom speaches.api_types import (')
replace(models, '    if model_id in [model.id for model in kokoro_model_registry.list_remote_models()]:',
        '    if model_id == chaowen.MODEL_ID:\n        chaowen.install()\n        return Response(status_code=200)\n    if model_id in [model.id for model in kokoro_model_registry.list_remote_models()]:')
replace(models, '        delete_local_model_repo(model_id)',
        '        if model_id == chaowen.MODEL_ID:\n            chaowen.remove()\n        else:\n            delete_local_model_repo(model_id)')
speech = 'routers/speech.py'
replace(speech, 'from speaches.audio import convert_audio_format',
        'from speaches.audio import convert_audio_format\nfrom speaches import piper_chaowen as chaowen')
path = root / speech
source = path.read_text()
start = source.index('    model_repo_path = get_model_repo_path(body.model)')
end = source.index('\n    body.input = strip_emojis', start)
block = source[start:end]
source = source[:start] + '''    if body.model == chaowen.MODEL_ID:
        if not chaowen.installed():
            raise HTTPException(status_code=404, detail="Chaowen is not installed")
        model_card_data = chaowen.model_card()
    else:
''' + '\n'.join('    ' + line if line else '' for line in block.split('\n')) + source[end:]
path.write_text(source)
# The original Piper WAV branch accidentally defaulted to Kokoro's sample rate.
replace(speech, 'audio_data, body.sample_rate or kokoro_utils.SAMPLE_RATE, body.response_format\n                )\n                return Response(audio_data, media_type=f"audio/{body.response_format}")\n            if body.response_format != "pcm":\n                audio_generator = (\n                    convert_audio_format(\n                        audio_bytes, body.sample_rate or piper_tts.config.sample_rate',
        'audio_data, body.sample_rate or piper_tts.config.sample_rate, body.response_format\n                )\n                return Response(audio_data, media_type=f"audio/{body.response_format}")\n            if body.response_format != "pcm":\n                audio_generator = (\n                    convert_audio_format(\n                        audio_bytes, body.sample_rate or piper_tts.config.sample_rate')
print('Speaches adapted for Piper 1.8 + Chaowen')
