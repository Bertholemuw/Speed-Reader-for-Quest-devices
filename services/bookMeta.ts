// Helpers for presenting Project Gutenberg metadata.

/** "Austen, Jane" -> "Jane Austen" */
export const formatAuthor = (name: string) => {
  const [last, first] = name.split(', ');
  return first ? `${first.replace(/\s*\(.*\)$/, '')} ${last}` : name;
};

/**
 * Gutenberg's summaries are written from each book's opening, so they set up
 * the premise without revealing how the story ends. Strip the boilerplate note.
 */
export const cleanSynopsis = (summaries: string[] | undefined) =>
  (summaries?.[0] ?? '')
    .replace(/\s*\(This is an automatically generated summary\.?\)\s*$/i, '')
    .trim();

/** "England -- Social life and customs -- 19th century -- Fiction" -> "England" */
export const cleanSubjects = (subjects: string[] | undefined, bookshelves: string[] | undefined = []) => {
  const tags = [
    ...(subjects ?? []).map(s => s.split(' -- ')[0]),
    ...bookshelves.map(s => s.replace(/^Category:\s*/, '')),
  ];
  return [...new Set(tags.map(t => t.trim()).filter(Boolean))].slice(0, 6);
};
