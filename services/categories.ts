// Book categories derived from Project Gutenberg subject headings and bookshelves.

export interface CategorySource {
  subjects?: string[];
  bookshelves?: string[];
}

interface Category {
  id: string;
  label: string;
  test: (tags: string) => boolean;
}

const tagsOf = (b: CategorySource) =>
  [...(b.subjects ?? []), ...(b.bookshelves ?? [])].join(' | ').toLowerCase();

const isFiction = (t: string) =>
  /fiction|novels|short stories|romance|love stories|adventure stories|fairy tales|fantasy|detective|mystery|thriller|ghost stories|horror tales|sea stories|western stories/.test(t);
const isPoetry = (t: string) => /poetry|poems|sonnets|ballads/.test(t);
const isDrama = (t: string) => /drama|plays|tragedies|comedies|plays\/films/.test(t);

export const CATEGORIES: Category[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'fiction', label: 'Fiction', test: isFiction },
  { id: 'nonfiction', label: 'Non-fiction', test: t => !isFiction(t) && !isPoetry(t) && !isDrama(t) },
  { id: 'fantasy', label: 'Fantasy & Sci-Fi', test: t => /fantasy|science fiction|science-fiction|fairy tales|imaginary|utopias|time travel|space flight|extraterrestrial/.test(t) },
  { id: 'mystery', label: 'Mystery & Crime', test: t => /detective|mystery|crime|thriller|murder|holmes, sherlock/.test(t) },
  { id: 'romance', label: 'Romance', test: t => /romance|love stories|courtship|man-woman relationships/.test(t) },
  { id: 'horror', label: 'Horror & Gothic', test: t => /horror|gothic|ghost|vampire|supernatural|monsters/.test(t) },
  { id: 'adventure', label: 'Adventure', test: t => /adventure|sea stories|pirates|voyages|western stories|survival|treasure/.test(t) },
  { id: 'children', label: "Children's", test: t => /children|juvenile|young adult|nursery/.test(t) },
  { id: 'poetry', label: 'Poetry', test: isPoetry },
  { id: 'plays', label: 'Plays', test: isDrama },
  { id: 'history', label: 'History', test: t => !isFiction(t) && /category: history|-- history/.test(t) },
  { id: 'biography', label: 'Biography', test: t => !isFiction(t) && /biograph|autobiograph|memoir|diaries/.test(t) },
  { id: 'philosophy', label: 'Philosophy', test: t => !isFiction(t) && /philosophy|ethics|stoics|political science|politics/.test(t) },
  { id: 'religion', label: 'Religion & Myth', test: t => /religion|spirituality|mythology|bible|legends|folklore|christianity|buddhism|hinduism/.test(t) },
];

export const inCategory = (book: CategorySource, categoryId: string) => {
  const cat = CATEGORIES.find(c => c.id === categoryId);
  return !cat || cat.test(tagsOf(book));
};
