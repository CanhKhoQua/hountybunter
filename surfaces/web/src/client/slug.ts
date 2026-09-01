/**
 * Mirrors core/src/note/store.ts `slugifyTitle`. Duplicated deliberately: the
 * client must not import the server's SQLite-bound package, and the preview it
 * shows would be a lie if it disagreed. The shared test is the contract.
 *
 * NFD splits a marked letter into base plus combining mark, so stripping the
 * mark range keeps the base letter. `đ` carries a stroke, not a mark.
 */
export function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
}
