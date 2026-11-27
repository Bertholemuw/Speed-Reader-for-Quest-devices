
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Book, UserSettings } from './types';
import Library from './components/Library';
import Reader from './components/Reader';
import { BookOpen, Library as LibraryIcon, Sparkles } from 'lucide-react';
import { loadBooks, saveBook, deleteBook } from './services/storage';
import { installBackButton, useBackHandler, exitApp } from './services/backButton';
import { isNative } from './services/platform';

const POSITION_KEY = 'quest_rsvp_last_book';
const SETTINGS_KEY = 'quest_rsvp_settings';

const DEFAULT_SETTINGS: UserSettings = {
  wpm: 350,
  fontSize: 'medium',
  fontFamily: 'jetbrains',
  theme: 'dark'
};

const STATUS_BAR_COLORS: Record<UserSettings['theme'], string> = {
  dark: '#18181b',
  amoled: '#000000',
  sepia: '#e8dfc4',
  light: '#f4f4f5',
};

const loadSettings = (): UserSettings => {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
};

const App: React.FC = () => {
  const [books, setBooks] = useState<Book[]>([]);
  const [view, setView] = useState<'library' | 'reader'>('library');
  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [settings, setSettings] = useState<UserSettings>(loadSettings);
  const pendingSaves = useRef<Map<string, number>>(new Map());

  // Load books from IndexedDB
  useEffect(() => {
    loadBooks()
      .then(loaded => {
        setBooks(loaded);
        const lastBookId = localStorage.getItem(POSITION_KEY);
        const found = loaded.find(b => b.id === lastBookId);
        if (found) setActiveBook(found);
      })
      .catch(e => console.error("Failed to load books", e));
  }, []);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (activeBook) localStorage.setItem(POSITION_KEY, activeBook.id);
  }, [activeBook]);

  // Match the Android status bar to the theme
  useEffect(() => {
    if (!isNative) return;
    const lightBg = settings.theme === 'light' || settings.theme === 'sepia';
    StatusBar.setStyle({ style: lightBg ? Style.Light : Style.Dark }).catch(() => {});
    StatusBar.setBackgroundColor({ color: STATUS_BAR_COLORS[settings.theme] }).catch(() => {});
  }, [settings.theme]);

  // Android back: reader -> library -> exit
  useEffect(() => installBackButton(exitApp), []);
  useBackHandler(view === 'reader', () => setView('library'));

  const handleAddBook = (title: string, content: string) => {
    const newBook: Book = {
      id: Math.random().toString(36).substr(2, 9),
      title,
      content,
      lastPosition: 0,
      addedAt: Date.now(),
    };
    setBooks(prev => [newBook, ...prev]);
    saveBook(newBook).catch(e => {
      console.error("Failed to save book", e);
      alert("Could not save this book to storage.");
    });
  };

  const handleDeleteBook = (id: string) => {
    setBooks(prev => prev.filter(b => b.id !== id));
    deleteBook(id).catch(e => console.error("Failed to delete book", e));
    if (activeBook?.id === id) setActiveBook(null);
  };

  const handleSelectBook = (book: Book) => {
    setActiveBook(book);
    setView('reader');
  };

  // Position changes on every word, so persist at most once a second per book.
  const booksRef = useRef(books);
  booksRef.current = books;
  const updateBookPosition = useCallback((id: string, pos: number) => {
    setBooks(prev => prev.map(b => b.id === id ? { ...b, lastPosition: pos } : b));
    const timers = pendingSaves.current;
    if (timers.has(id)) return;
    timers.set(id, window.setTimeout(() => {
      timers.delete(id);
      const book = booksRef.current.find(b => b.id === id);
      if (book) saveBook(book).catch(e => console.error("Failed to save position", e));
    }, 1000));
  }, []);

  // Flush pending position saves when the app is backgrounded or closed
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState !== 'hidden') return;
      pendingSaves.current.forEach((timer, id) => {
        window.clearTimeout(timer);
        const book = booksRef.current.find(b => b.id === id);
        if (book) saveBook(book).catch(() => {});
      });
      pendingSaves.current.clear();
    };
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, []);

  const updateSettings = (newSettings: Partial<UserSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  return (
    <div className={`h-full flex flex-col transition-colors duration-300 overflow-hidden ${
      settings.theme === 'dark' ? 'bg-zinc-950 text-zinc-100' :
      settings.theme === 'amoled' ? 'bg-black text-white' :
      settings.theme === 'sepia' ? 'bg-[#f4ecd8] text-[#5b4636]' :
      'bg-white text-zinc-900'
    }`}>
      <header className={`h-14 md:h-20 shrink-0 border-b flex items-center justify-between px-4 md:px-10 backdrop-blur-md sticky top-0 z-50 transition-colors ${
        settings.theme === 'dark' ? 'bg-zinc-900/50 border-zinc-800' :
        settings.theme === 'amoled' ? 'bg-zinc-900/20 border-zinc-900' :
        settings.theme === 'sepia' ? 'bg-[#e8dfc4]/50 border-[#d3cbb3]' :
        'bg-zinc-100/50 border-zinc-200'
      }`}>
        <div className="flex items-center gap-2 md:gap-3">
          <div className="w-8 h-8 md:w-10 md:h-10 bg-cyan-600 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(8,145,178,0.5)]">
            <BookOpen className="text-white w-5 h-5 md:w-6 md:h-6" />
          </div>
          <h1 className="text-lg md:text-2xl font-bold tracking-tight bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            RSVP Reader
          </h1>
        </div>

        <nav className="flex gap-2 md:gap-4">
          <button
            onClick={() => setView('library')}
            aria-label="Library"
            className={`flex items-center gap-2 px-3 md:px-6 py-2 rounded-full transition-all ${
              view === 'library' 
              ? (settings.theme === 'light' || settings.theme === 'sepia' ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-900') 
              : 'hover:bg-zinc-800/20'
            }`}
          >
            <LibraryIcon size={18} />
            <span className="hidden sm:inline">Library</span>
          </button>
          {activeBook && (
            <button
              onClick={() => setView('reader')}
              aria-label="Resume reading"
              className={`flex items-center gap-2 px-3 md:px-6 py-2 rounded-full transition-all ${
                view === 'reader' 
                ? 'bg-cyan-600 text-white shadow-[0_0_15px_rgba(8,145,178,0.4)]' 
                : 'hover:bg-zinc-800/20'
              }`}
            >
              <Sparkles size={18} />
              <span className="hidden sm:inline">Resume Reading</span>
              <span className="sm:hidden text-sm font-semibold">Resume</span>
            </button>
          )}
        </nav>
      </header>

      <main className="flex-1 overflow-auto relative">
        {view === 'library' ? (
          <Library 
            books={books} 
            onSelect={handleSelectBook} 
            onDelete={handleDeleteBook}
            onAdd={handleAddBook}
            theme={settings.theme}
          />
        ) : (
          activeBook && (
            <Reader 
              book={activeBook} 
              onUpdatePosition={updateBookPosition} 
              onClose={() => setView('library')}
              settings={settings}
              onUpdateSettings={updateSettings}
            />
          )
        )}
      </main>

      {settings.theme !== 'light' && (
        <>
          <div className="fixed bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-cyan-900/10 blur-[120px] pointer-events-none rounded-full" />
          <div className="fixed top-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-900/10 blur-[120px] pointer-events-none rounded-full" />
        </>
      )}
    </div>
  );
};

export default App;
