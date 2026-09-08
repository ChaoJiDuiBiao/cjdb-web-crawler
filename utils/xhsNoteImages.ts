/** Read only the current note's primary carousel, in its authored order. */
export function extractNoteImages(noteId: string): string[] {
  if (!noteId) return []
  const masks = Array.from(document.querySelectorAll('.note-detail-mask[note-id]'))
  const mask = masks.find((element) => element.getAttribute('note-id') === noteId)
  // Never fall through to a different note when a detail mask is present.
  const container = mask
    ? mask.querySelector('#noteContainer')
    : masks.length ? null : document.querySelector('#noteContainer.note-container')
  const wrapper = container?.querySelector(
    '.media-container [elementtiming="note-cover"] .note-slider > .swiper-wrapper'
  )
  if (!wrapper) return []
  const slides = Array.from(wrapper.children)
    .filter((slide) => slide.matches('.swiper-slide[data-index]:not(.swiper-slide-duplicate)'))
    .map((slide) => ({ slide, index: slide.getAttribute('data-index')! }))
    .filter(({ index }) => /^\d+$/.test(index))
    .sort((a, b) => Number(a.index) - Number(b.index))
  const byIndex = new Map<number, string>()
  for (const { slide, index } of slides) {
    const img = slide.querySelector<HTMLImageElement>('.img-container .note-slider-img img')
    if (!img || byIndex.has(Number(index))) continue
    const candidates = [img.getAttribute('src'), img.getAttribute('data-src')]
    for (const candidate of candidates) {
      if (!candidate || candidate.includes('placeholder')) continue
      try {
        const url = new URL(candidate, location.href)
        if (!['https:', 'http:'].includes(url.protocol)) continue
        byIndex.set(Number(index), url.href)
        break
      } catch { /* Ignore invalid image addresses. */ }
    }
  }
  return [...byIndex.values()]
}
