
import React, { useState, useEffect } from 'react';
import { Search, Download, ExternalLink, Loader2, X, BookOpen } from 'lucide-react';
import { extractTextFromEpub } from '../services/epubService';

interface GutenbergBook {
  id: number;
  title: string;
  authors: { name: string }[];
  formats: Record<string, string>;
  download_count: number;
}

interface GutenbergExplorerProps {
  onClose: () => void;
  onAddBook: (title: string, content: string) => void;
  theme: 'dark' | 'sepia' | 'light' | 'amoled';
}

const GutenbergExplorer: React.FC<GutenbergExplorerProps> = ({ onClose, onAddBook, theme }) => {
  const [search, setSearch] = useState('');
  const [books, setBooks] = useState<GutenbergBook[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const fetchBooks = async (query = '') => {
    setLoading(true);
    try {
      const url = query 
        ? `https://gutendex.com/books/?search=${encodeURIComponent(query)}`
        : `https://gutendex.com/books/`;
      const res = await fetch(url);
      const data = await res.json();
      setBooks(data.results || []);
    } catch (e) {
      console.error("Gutenberg Search Error", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBooks();
  }, []);

  const handleDownload = async (book: GutenbergBook) => {
    setDownloadingId(book.id);
    try {
      // Gutenberg URLs often block direct browser fetch due to CORS.
      // We use a public CORS proxy to bypass this restriction.
      const getProxiedUrl = (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`;

      const epubUrl = book.formats['application/epub+zip'] || book.formats['application/x-mobipocket-ebook'];
      const textUrl = book.formats['text/plain; charset=us-ascii'] || book.formats['text/plain'];

      if (epubUrl) {
        console.log(`Attempting proxied EPUB download: ${epubUrl}`);
        const response = await fetch(getProxiedUrl(epubUrl));
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        
        const blob = await response.blob();
        const { title, content } = await extractTextFromEpub(blob);
        onAddBook(title || book.title, content);
      } else if (textUrl) {
        console.log(`Attempting proxied Text download: ${textUrl}`);
        const response = await fetch(getProxiedUrl(textUrl));
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        
        const content = await response.text();
        onAddBook(book.title, content);
      } else {
        alert("No compatible format found for this book.");
        return;
      }
      onClose();
    } catch (e) {
      console.error("Gutenberg Download/Parse Error:", e);
      alert(`Failed to add book: ${e instanceof Error ? e.message : 'Unknown error'}. Project Gutenberg server or CORS proxy may be temporarily unavailable.`);
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
    <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-[200] flex items-center justify-center p-6 md:p-12">
      <div className={`w-full max-w-6xl h-full rounded-3xl border flex flex-col shadow-2xl overflow-hidden ${themeColors}`}>
        {/* Header */}
        <div className="p-8 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-cyan-600 rounded-xl flex items-center justify-center">
              <BookOpen className="text-white" size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-bold">Discover Gutenberg</h2>
              <p className="text-zinc-500 text-sm">Access 70,000+ free ebooks (Bypassing CORS via Proxy)</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-8 pb-4">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-cyan-500 transition-colors" size={20} />
            <input 
              type="text" 
              placeholder="Search title, author, or keyword (e.g. 'Dickens')..."
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 outline-none focus:border-cyan-500 transition-all text-lg"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchBooks(search)}
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-8 pt-4">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-zinc-500">
              <Loader2 className="animate-spin text-cyan-500" size={48} />
              <p className="font-bold tracking-widest uppercase text-xs">Scanning Digital Archives...</p>
            </div>
          ) : books.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-zinc-500 opacity-50">
              <BookOpen size={64} strokeWidth={1} />
              <p>No results found. Try a different search term.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-12">
              {books.map((book) => (
                <div key={book.id} className="group p-6 rounded-2xl bg-white/5 border border-white/5 hover:border-cyan-500/50 hover:bg-white/10 transition-all flex flex-col gap-4">
                  <div className="flex-1">
                    <h3 className="font-bold text-lg line-clamp-2 leading-tight mb-2 group-hover:text-cyan-400 transition-colors">{book.title}</h3>
                    <p className="text-zinc-500 text-sm italic">{book.authors.length > 0 ? book.authors.map(a => a.name).join(', ') : 'Unknown Author'}</p>
                  </div>
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
          Digital assets served via Gutendex API & Gutenberg.org • Proxied for CORS compliance
        </div>
      </div>
    </div>
  );
};

export default GutenbergExplorer;
