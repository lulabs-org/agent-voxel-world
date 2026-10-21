/** Keep each page short enough for three lines even on a narrow viewport. */
export function speechPages(text: string): string[] {
  const characters = Array.from(text.replace(/\s+/gu, ' ').trim());
  const pages: string[] = [];
  while (characters.length) {
    let end = Math.min(42, characters.length);
    if (characters.length > end) {
      for (let i = end - 1; i >= 20; i--) {
        if (/[。！？；，、.!?;,\s]/u.test(characters[i])) {
          end = i + 1;
          break;
        }
      }
    }
    const page = characters.splice(0, end).join('').trim();
    if (page) pages.push(page);
  }
  return pages.length ? pages : [''];
}
