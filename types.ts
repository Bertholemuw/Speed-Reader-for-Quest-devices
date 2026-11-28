
export interface Book {
  id: string;
  title: string;
  content: string;
  lastPosition: number;
  addedAt: number;
  author?: string;
  synopsis?: string;
  subjects?: string[];
}

export type BookMeta = Pick<Book, 'author' | 'synopsis' | 'subjects'>;

export type ThemeType = 'dark' | 'sepia' | 'light' | 'amoled';
export type FontType = 'jetbrains' | 'inter' | 'serif';
export type FontSize = 'small' | 'medium' | 'large' | 'extra-large';

export interface UserSettings {
  wpm: number;
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
