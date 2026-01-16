
import React, { useState, useEffect } from 'react';
import { Book, UserSettings } from './types';
import Library from './components/Library';
import Reader from './components/Reader';
import { BookOpen, Library as LibraryIcon, Sparkles } from 'lucide-react';

const STORAGE_KEY = 'quest_rsvp_books';
const POSITION_KEY = 'quest_rsvp_last_book';
const SETTINGS_KEY = 'quest_rsvp_settings';

const DEFAULT_SETTINGS: UserSettings = {
  wpm: 350,
  fontSize: 'medium',
  fontFamily: 'jetbrains',
  theme: 'dark'
};

const App: React.FC = () => {
  const [books, setBooks] = useState<Book[]>([]);
  const [view, setView] = useState<'library' | 'reader'>('library');
  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

  // Load data from localStorage
  useEffect(() => {
    const savedBooks = localStorage.getItem(STORAGE_KEY);
    if (savedBooks) {
      try {
        setBooks(JSON.parse(savedBooks));
      } catch (e) {
        console.error("Failed to load books", e);
      }
    }

    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    if (savedSettings) {
      try {
        setSettings(JSON.parse(savedSettings));
      } catch (e) {
        console.error("Failed to load settings", e);
      }
    }

    const lastBookId = localStorage.getItem(POSITION_KEY);
    if (lastBookId && savedBooks) {
      const parsed = JSON.parse(savedBooks) as Book[];
      const found = parsed.find(b => b.id === lastBookId);
      if (found) {
        setActiveBook(found);
      }
    }
  }, []);

  // Save books and settings to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    if (activeBook) {
      localStorage.setItem(POSITION_KEY, activeBook.id);
    }
  }, [books, activeBook, settings]);

  const handleAddBook = (title: string, content: string) => {
    const newBook: Book = {
      id: Math.random().toString(36).substr(2, 9),
      title,
      content,
      lastPosition: 0,
      addedAt: Date.now(),
    };
    setBooks(prev => [newBook, ...prev]);
  };

  const handleDeleteBook = (id: string) => {
    setBooks(prev => prev.filter(b => b.id !== id));
    if (activeBook?.id === id) setActiveBook(null);
  };

  const handleSelectBook = (book: Book) => {
    setActiveBook(book);
    setView('reader');
  };

  const updateBookPosition = (id: string, pos: number) => {
    setBooks(prev => prev.map(b => b.id === id ? { ...b, lastPosition: pos } : b));
  };

  const updateSettings = (newSettings: Partial<UserSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-300 overflow-hidden ${
      settings.theme === 'dark' ? 'bg-zinc-950 text-zinc-100' :
      settings.theme === 'amoled' ? 'bg-black text-white' :
      settings.theme === 'sepia' ? 'bg-[#f4ecd8] text-[#5b4636]' :
      'bg-white text-zinc-900'
    }`}>
      {/* VR Optimized Header */}
      <header className={`h-20 border-b flex items-center justify-between px-10 backdrop-blur-md sticky top-0 z-50 transition-colors ${
        settings.theme === 'dark' ? 'bg-zinc-900/50 border-zinc-800' :
        settings.theme === 'amoled' ? 'bg-zinc-900/20 border-zinc-900' :
        settings.theme === 'sepia' ? 'bg-[#e8dfc4]/50 border-[#d3cbb3]' :
        'bg-zinc-100/50 border-zinc-200'
      }`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-cyan-600 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(8,145,178,0.5)]">
            <BookOpen className="text-white" size={24} />
          </div>
          <h1 className={`text-2xl font-bold tracking-tight bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent`}>
            Quest RSVP
          </h1>
        </div>

        <nav className="flex gap-4">
          <button
            onClick={() => setView('library')}
            className={`flex items-center gap-2 px-6 py-2 rounded-full transition-all ${
              view === 'library' 
              ? (settings.theme === 'light' || settings.theme === 'sepia' ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-900') 
              : 'hover:bg-zinc-800/20'
            }`}
          >
            <LibraryIcon size={18} />
            Library
          </button>
          {activeBook && (
            <button
              onClick={() => setView('reader')}
              className={`flex items-center gap-2 px-6 py-2 rounded-full transition-all ${
                view === 'reader' 
                ? 'bg-cyan-600 text-white shadow-[0_0_15px_rgba(8,145,178,0.4)]' 
                : 'hover:bg-zinc-800/20'
              }`}
            >
              <Sparkles size={18} />
              Resume Reading
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

      {/* Decorative VR background glow */}
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
