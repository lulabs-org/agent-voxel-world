import { expect, it } from 'vitest';
import { parseLocalVoices } from '../apps/server/src/audio/local-tts';

it('parses say voice names including spaces and ignores invalid lines', () => {
  expect(
    parseLocalVoices(`Tingting            zh_CN    # 你好！
Eddy (English (US))  en_US    # Hello!
Amélie              fr_CA    # Bonjour!
invalid line
`),
  ).toEqual([
    { name: 'Tingting', language: 'zh_CN' },
    { name: 'Eddy (English (US))', language: 'en_US' },
    { name: 'Amélie', language: 'fr_CA' },
  ]);
  expect(parseLocalVoices('')).toEqual([]);
});
