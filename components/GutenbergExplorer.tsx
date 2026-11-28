
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Download, Loader2, X, BookOpen, RefreshCw, WifiOff } from 'lucide-react';
import starterCatalog from '../data/gutenbergCatalog.json';
import { CATEGORIES, inCategory } from '../services/categories';
import BookDetails from './BookDetails';
import { formatAuthor, cleanSynopsis, cleanSubjects } from '../services/bookMeta';
import { BookMeta } from '../types';
import { extractTextFromEpub } from '../services/epubService';
import { fetchCrossOrigin, isNative } from '../services/platform';
import { useBackHandler } from '../services/backButton';

export interface GutenbergBook {
  id: number;
  title: string;
  authors: { name: string }[];
  formats: Record<string, string>;
  download_count: number;
  summaries?: string[];
  subjects?: string[];
  bookshelves?: string[];
}

const metaFor = (book: GutenbergBook): BookMeta => ({
  author: book.authors.map(a => formatAuthor(a.name)).join(', ') || undefined,
  synopsis: cleanSynopsis(book.summaries) || undefined,
  subjects: cleanSubjects(book.subjects, book.bookshelves),
});

const CATALOG_TIMEOUT_MS = 20000;
const POPULAR_CACHE_KEY = 'gutendex_popular_v1';
const STARTER = starterCatalog as GutenbergBook[];

const loadCachedPopular = (): GutenbergBook[] => {
  try {
    const cached = JSON.parse(localStorage.getItem(POPULAR_CACHE_KEY) || 'null');
    if (Array.isArray(cached) && cached.length) return cached;
  } catch { /* fall through */ }
  return STARTER;
};

const savePopular = (books: GutenbergBook[]) => {
  try { localStorage.setItem(POPULAR_CACHE_KEY, JSON.stringify(books)); } catch { /* storage full: not critical */ }
};

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Matches every search word against title and author, across bundled and cached books. */
const searchLocal = (query: string): GutenbergBook[] => {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const pool = new Map<number, GutenbergBook>();
  [...loadCachedPopular(), ...STARTER].forEach(b => pool.set(b.id, b));
  return [...pool.values()].filter(b => {
    const hay = normalize(`${b.title} ${b.authors.map(a => a.name).join(' ')}`);
    return terms.every(t => hay.includes(t));
  });
};

interface GutenbergExplorerProps {
  onClose: () => void;
  onAddBook: (title: string, content: string, meta?: BookMeta) => void;
  theme: 'dark' | 'sepia' | 'light' | 'amoled';
}

const GutenbergExplorer: React.FC<GutenbergExplorerProps> = ({ onClose, onAddBook, theme }) => {
  const [search, setSearch] = useState('');
  // Shown instantly: the last list fetched on this device, or the catalogue bundled with the app.
  const [books, setBooks] = useState<GutenbergBook[]>(loadCachedPopular);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [activeQuery, setActiveQuery] = useState('');
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [selected, setSelected] = useState<GutenbergBook | null>(null);
  const requestId = useRef(0);
  const [category, setCategory] = useState('all');

  // With a category picked, browse everything known locally (bundled + cached + latest results), most popular first.
  const visible = useMemo(() => {
    if (category === 'all') return books;
    const pool = new Map<number, GutenbergBook>();
    const base = activeQuery ? books : [...books, ...loadCachedPopular(), ...STARTER];
    base.forEach(b => pool.set(b.id, b));
    return [...pool.values()]
      .filter(b => inCategory(b, category))
      .sort((a, b) => activeQuery ? 0 : b.download_count - a.download_count);
  }, [books, category, activeQuery]);

  const fetchBooks = async (rawQuery = '') => {
    const query = rawQuery.trim();
    const id = ++requestId.current;
    setActiveQuery(query);
    // Instant results from the books we already have, while the full search runs.
    if (query) setBooks(searchLocal(query));
    else setBooks(loadCachedPopular());
    setStatus('loading');
    try {
      const url = query
        ? `https://gutendex.com/books/?search=${encodeURIComponent(query)}`
        : `https://gutendex.com/books/`;
      const res = await fetch(url, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const results: GutenbergBook[] = (await res.json()).results || [];
      if (id !== requestId.current) return; // a newer search started
      if (query) {
        const seen = new Set(results.map(b => b.id));
        setBooks([...results, ...searchLocal(query).filter(b => !seen.has(b.id))]);
      } else {
        setBooks(results);
        savePopular(results);
      }
      setStatus('idle');
    } catch (e) {
      console.error("Gutenberg Search Error", e);
      if (id === requestId.current) setStatus('error');
    }
  };

  useEffect(() => {
    fetchBooks();
  }, []);

  useBackHandler(true, onClose);

  // Official PGLAF mirror, used when gutenberg.org is down or rate-limiting.
  const MIRROR = 'https://gutenberg.pglaf.org/cache/epub';

  const handleDownload = async (book: GutenbergBook) => {
    setDownloadingId(book.id);
    const f = book.formats;
    const textKey = Object.keys(f).find(k => k.startsWith('text/plain'));
    const candidates: { url: string; kind: 'epub' | 'text' }[] = [];
    // Text-only EPUBs: RSVP ignores images, and the image editions can be 25 MB+.
    if (f['application/epub+zip']) candidates.push({ url: `https://www.gutenberg.org/ebooks/${book.id}.epub.noimages`, kind: 'epub' });
    candidates.push({ url: `${MIRROR}/${book.id}/pg${book.id}.epub`, kind: 'epub' });
    if (textKey) candidates.push({ url: f[textKey], kind: 'text' });
    candidates.push({ url: `${MIRROR}/${book.id}/pg${book.id}.txt`, kind: 'text' });

    let lastError: unknown = null;
    try {
      for (const { url, kind } of candidates) {
        try {
          if (kind === 'epub') {
            const { title, content } = await extractTextFromEpub(await fetchCrossOrigin(url, 'blob'));
            if (!content) throw new Error('Empty EPUB');
            onAddBook(title || book.title, content, metaFor(book));
          } else {
            const content = await fetchCrossOrigin(url, 'text');
            if (!content.trim() || /^\s*<(!doctype|html)/i.test(content)) throw new Error('Not a text file');
            onAddBook(book.title, content, metaFor(book));
          }
          onClose();
          return;
        } catch (e) {
          console.warn(`Gutenberg download failed for ${url}`, e);
          lastError = e;
        }
      }
      alert(`Failed to add book: ${lastError instanceof Error ? lastError.message : 'Unknown error'}. Check your connection; Project Gutenberg and its mirror may be temporarily unavailable.`);
    } finally {
      setDownloadingId(null);
    }
  };

  const themeColors = {
    dark: 'bg-zinc-900 border-zinc-700 text-zinc-100',
    amoled: 'bg-black border-zinc-800 text-white',
    sepia: 'bg-[#f4ecd8] border-[#d3cbb3] text-[#5b4636]',
    light: 'bg-white border-zinc-200 text-zinc-900'
  }[theme];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-[200] flex items-center justify-center p-0 md:p-12">
      <div className={`w-full max-w-6xl h-full md:rounded-3xl border flex flex-col shadow-2xl overflow-hidden ${themeColors}`}>
        {/* Header */}
        <div className="p-4 md:p-8 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-cyan-600 rounded-xl flex items-center justify-center">
              <BookOpen className="text-white" size={24} />
            </div>
            <div>
              <h2 className="text-xl md:text-2xl font-bold">Discover Gutenberg</h2>
              <p className="text-zinc-500 text-sm">Access 70,000+ free public-domain ebooks</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-4 md:p-8 pb-2 md:pb-4">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-cyan-500 transition-colors" size={20} />
            <input 
              type="text" 
              placeholder="Search title or author (e.g. 'Dickens')"
              enterKeyHint="search"
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 md:py-4 pl-12 pr-4 outline-none focus:border-cyan-500 transition-all text-base md:text-lg"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchBooks(search)}
            />
          </div>
          {/* Categories */}
          <div className="flex gap-2 overflow-x-auto mt-3 -mx-4 px-4 md:mx-0 md:px-0 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Categories">
            {CATEGORIES.map(c => (
              <button
                key={c.id}
                role="tab"
                aria-selected={category === c.id}
                onClick={() => setCategory(c.id)}
                className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold border transition-all ${
                  category === c.id ? 'bg-cyan-600 border-cyan-600 text-white' : 'border-white/10 bg-white/5 opacity-80 hover:opacity-100'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 md:p-8 pt-2 md:pt-4">
          {status !== 'idle' && (
            <div className={`mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${status === 'error' ? 'text-amber-500' : 'text-zinc-500'}`}>
              {status === 'loading' ? (
                <><Loader2 className="animate-spin text-cyan-500" size={14} /> {activeQuery ? 'Searching all of Gutenberg...' : 'Refreshing popular books...'}</>
              ) : (
                <>
                  <WifiOff size={14} /> {books.length ? "Couldn't reach Gutenberg. Showing saved books." : "Couldn't reach Gutenberg."}
                  <button onClick={() => fetchBooks(activeQuery)} className="ml-1 flex items-center gap-1 text-cyan-500 normal-case tracking-normal text-sm"><RefreshCw size={14} /> Retry</button>
                </>
              )}
            </div>
          )}
          {visible.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-zinc-500 opacity-70">
              {status === 'loading' ? <Loader2 className="animate-spin text-cyan-500" size={48} /> : <BookOpen size={64} strokeWidth={1} />}
              <p>{status === 'loading' ? 'Searching...' : status === 'error' ? 'Check your connection and tap Retry.' : category !== 'all' ? 'No books in this category yet. Try another, or search.' : 'No results found. Try a different search term.'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6 pb-12">
              {visible.map((book) => (
                <div key={book.id} className="group p-4 md:p-6 rounded-2xl bg-white/5 border border-white/5 hover:border-cyan-500/50 hover:bg-white/10 transition-all flex flex-col gap-4">
                  <button onClick={() => setSelected(book)} className="flex-1 text-left" aria-label={`About ${book.title}`}>
                    <h3 className="font-bold text-lg line-clamp-2 leading-tight mb-2 group-hover:text-cyan-400 transition-colors">{book.title}</h3>
                    <p className="text-zinc-500 text-sm italic">{book.authors.length > 0 ? book.authors.map(a => formatAuthor(a.name)).join(', ') : 'Unknown Author'}</p>
                    {cleanSynopsis(book.summaries) && (
                      // Skip the opening '"Title" by Author is a novel...' sentence; the card already shows both.
                      <p className="text-sm opacity-70 line-clamp-2 mt-2">{cleanSynopsis(book.summaries).replace(/^"[^"]+" by [^.]+?\.\s+/, '')}</p>
                    )}
                    <p className="text-xs font-bold text-cyan-500 mt-2">Tap for synopsis</p>
                  </button>
                  <div className="flex items-center justify-between border-t border-white/5 pt-4">
                    <span className="text-[10px] text-zinc-600 font-mono tracking-tighter uppercase">{book.download_count.toLocaleString()} Popularity</span>
                    <button 
                      onClick={() => handleDownload(book)}
                      disabled={downloadingId !== null}
                      className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-all text-sm font-bold disabled:opacity-50 shadow-lg shadow-cyan-600/10"
                    >
                      {downloadingId === book.id ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
                      {downloadingId === book.id ? 'Loading...' : 'Import'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-black/20 border-t border-white/5 text-center text-[10px] text-zinc-600 tracking-widest uppercase">
          {isNative ? 'Via Gutendex API & Gutenberg.org' : 'Via Gutendex API & Gutenberg.org • Proxied for CORS compliance'}
        </div>
      </div>

      {selected && (
        <BookDetails
          title={selected.title}
          {...metaFor(selected)}
          theme={theme}
          onClose={() => setSelected(null)}
          action={
            <button
              onClick={() => handleDownload(selected)}
              disabled={downloadingId !== null}
              className="w-full flex items-center justify-center gap-2 py-4 bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-lg rounded-2xl disabled:opacity-50 transition-all"
            >
              {downloadingId === selected.id ? <Loader2 className="animate-spin" size={20} /> : <Download size={20} />}
              {downloadingId === selected.id ? 'Downloading...' : 'Import to Library'}
            </button>
          }
        />
      )}
    </div>
  );
};

export default GutenbergExplorer;
