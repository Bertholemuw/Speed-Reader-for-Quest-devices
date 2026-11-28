
export interface Book {
  id: string;
  title: string;
  content: string;
  lastPosition: number;
  addedAt: number;
  author?: string;
  synopsis?: string;
  subjects?: string[];
  /** Version of the word-splitting rules lastPosition was saved with. */
  tokenizer?: number;
}

export type BookMeta = Pick<Book, 'author' | 'synopsis' | 'subjects'>;

export type ThemeType = 'dark' | 'sepia' | 'light' | 'amoled';
export type FontType = 'jetbrains' | 'inter' | 'serif';
export type FontSize = 'small' | 'medium' | 'large' | 'extra-large';

export type ReadingMode = 'rsvp' | 'scroll';

export interface UserSettings {
  wpm: number;
  /** 'rsvp' flashes one word at a time; 'scroll' auto-scrolls the page */
  readingMode: ReadingMode;
  fontSize: FontSize;
  fontFamily: FontType;
  theme: ThemeType;
}

export interface ReaderState {
  currentWordIndex: number;
  isPlaying: boolean;
  wpm: number;
  isSettingsOpen: boolean;
  currentBook: Book | null;
}

export interface SpritzWord {
  prefix: string;
  orp: string;
  suffix: string;
}
