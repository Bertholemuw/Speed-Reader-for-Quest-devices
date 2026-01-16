
import React, { useState } from 'react';
import { Book, ThemeType } from '../types';
import { Plus, Trash2, FileText, Upload, BookOpen, Clock, X, Globe, Loader2 } from 'lucide-react';
import GutenbergExplorer from './GutenbergExplorer';
import { extractTextFromEpub } from '../services/epubService';

interface LibraryProps {
  books: Book[];
  onSelect: (book: Book) => void;
  onDelete: (id: string) => void;
  onAdd: (title: string, content: string) => void;
  theme: ThemeType;
}

const Library: React.FC<LibraryProps> = ({ books, onSelect, onDelete, onAdd, theme }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [isExploring, setIsExploring] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      if (file.name.toLowerCase().endsWith('.epub')) {
        const { title, content } = await extractTextFromEpub(file);
        onAdd(title, content);
      } else {
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target?.result as string;
          onAdd(file.name.replace(/\.[^/.]+$/, ""), content);
        };
        reader.readAsText(file);
      }
      setIsAdding(false);
    } catch (err) {
      console.error("File processing error", err);
      alert("Error processing file. Ensure it's a valid .txt or .epub file.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleManualAdd = () => {
    if (newTitle && newContent) {
      onAdd(newTitle, newContent);
      setNewTitle('');
      setNewContent('');
      setIsAdding(false);
    }
  };

  const themeColors = {
    dark: { card: 'bg-zinc-900/40', border: 'border-zinc-800', text: 'text-zinc-100', muted: 'text-zinc-400' },
    amoled: { card: 'bg-zinc-900/10', border: 'border-zinc-900', text: 'text-white', muted: 'text-zinc-600' },
    sepia: { card: 'bg-[#e8dfc4]/40', border: 'border-[#d3cbb3]', text: 'text-[#5b4636]', muted: 'text-[#a6927d]' },
    light: { card: 'bg-zinc-100/50', border: 'border-zinc-200', text: 'text-zinc-900', muted: 'text-zinc-400' }
  }[theme];

  return (
    <div className="p-10 max-w-7xl mx-auto space-y-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <section className="space-y-4">
          <h2 className={`text-5xl font-bold tracking-tight ${themeColors.text}`}>Your Knowledge Base</h2>
          <p className={`${themeColors.muted} text-lg max-w-2xl`}>Speed read your local EPUB/TXT files or discover classics directly from Project Gutenberg.</p>
        </section>
        
        <button 
          onClick={() => setIsExploring(true)}
          className="flex items-center gap-3 px-8 py-4 bg-cyan-600 text-white font-bold rounded-2xl hover:bg-cyan-500 transition-all shadow-xl shadow-cyan-600/20 active:scale-95"
        >
          <Globe size={24} />
          Discover Gutenberg
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        <div 
          onClick={() => setIsAdding(true)}
          className={`h-72 rounded-[2rem] border-2 border-dashed flex flex-col items-center justify-center gap-4 hover:border-cyan-500/50 hover:bg-cyan-500/5 group transition-all cursor-pointer ${themeColors.border}`}
        >
          <div className="w-20 h-20 rounded-2xl bg-zinc-900/10 flex items-center justify-center group-hover:scale-110 group-hover:bg-cyan-600 transition-all">
            <Plus className={`${themeColors.muted} group-hover:text-white`} size={40} />
          </div>
          <span className={`${themeColors.muted} font-bold text-lg group-hover:text-cyan-400`}>Import Book</span>
        </div>

        {books.map((book) => (
          <div 
            key={book.id}
            className={`group relative h-72 border rounded-[2rem] p-10 hover:border-cyan-500/50 hover:shadow-2xl transition-all cursor-pointer flex flex-col ${themeColors.card} ${themeColors.border}`}
            onClick={() => onSelect(book)}
          >
            <div className="flex-1 space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-cyan-600/10 flex items-center justify-center text-cyan-500 group-hover:bg-cyan-600 group-hover:text-white transition-colors">
                <FileText size={28} />
              </div>
              <h3 className={`text-2xl font-bold line-clamp-2 leading-tight ${themeColors.text}`}>{book.title}</h3>
              <div className={`flex items-center gap-4 text-sm font-medium ${themeColors.muted}`}>
                <span className="flex items-center gap-1.5"><BookOpen size={16} /> {book.content.split(/\s+/).length.toLocaleString()} words</span>
                <span className="flex items-center gap-1.5"><Clock size={16} /> {new Date(book.addedAt).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="flex items-center justify-between mt-6">
               <div className="text-xs font-bold px-4 py-2 bg-cyan-600/10 rounded-full text-cyan-500 tracking-wider">
                {Math.round((book.lastPosition / (book.content.split(/\s+/).length || 1)) * 100)}% COMPLETE
               </div>
               <button 
                onClick={(e) => { e.stopPropagation(); onDelete(book.id); }}
                className={`${themeColors.muted} hover:text-red-500 transition-colors p-2`}
               >
                <Trash2 size={24} />
               </button>
            </div>
          </div>
        ))}
      </div>

      {isAdding && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xl z-[120] flex items-center justify-center p-6" onClick={() => setIsAdding(false)}>
          <div className={`border rounded-[2.5rem] w-full max-w-2xl overflow-hidden shadow-2xl ${theme === 'light' ? 'bg-white border-zinc-200' : theme === 'sepia' ? 'bg-[#f4ecd8] border-[#d3cbb3]' : 'bg-zinc-900 border-zinc-700'}`} onClick={e => e.stopPropagation()}>
            <div className="p-10 space-y-8">
              <div className="flex items-center justify-between">
                <h3 className={`text-3xl font-bold ${themeColors.text}`}>Import Knowledge</h3>
                <button onClick={() => setIsAdding(false)} className={themeColors.muted}><X size={32} /></button>
              </div>

              <div className={`relative p-12 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center gap-4 ${themeColors.border} bg-black/5 hover:bg-black/10 transition-colors`}>
                {isProcessing ? (
                   <div className="flex flex-col items-center gap-4">
                     <Loader2 className="animate-spin text-cyan-500" size={48} />
                     <p className="text-zinc-500 font-bold">Unpacking Ebook...</p>
                   </div>
                ) : (
                  <>
                    <Upload className="text-cyan-500" size={48} />
                    <div className="text-center">
                      <p className={`${themeColors.text} font-bold text-lg`}>Drop .epub or .txt file</p>
                      <p className={`${themeColors.muted} text-sm`}>Or click to select from your device</p>
                    </div>
                    <input type="file" accept=".txt,.epub" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                  </>
                )}
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10"></div></div>
                <div className="relative flex justify-center text-xs uppercase font-bold tracking-widest"><span className="bg-zinc-900 px-4 text-zinc-500">Or paste text manually</span></div>
              </div>

              <div className="space-y-4">
                <input 
                  type="text" placeholder="Title" value={newTitle} onChange={e => setNewTitle(e.target.value)}
                  className={`w-full bg-black/10 border rounded-2xl px-6 py-4 outline-none focus:border-cyan-500 transition-colors ${themeColors.text} ${themeColors.border}`}
                />
                <textarea 
                  placeholder="Paste text content..." value={newContent} onChange={e => setNewContent(e.target.value)} rows={4}
                  className={`w-full bg-black/10 border rounded-2xl px-6 py-4 outline-none focus:border-cyan-500 transition-colors resize-none ${themeColors.text} ${themeColors.border}`}
                />
              </div>
              <button 
                onClick={handleManualAdd} disabled={!newTitle || !newContent || isProcessing}
                className="w-full py-5 bg-cyan-600 text-white font-bold text-xl rounded-2xl hover:bg-cyan-500 disabled:opacity-50 transition-all shadow-lg active:scale-95"
              >
                Add to Library
              </button>
            </div>
          </div>
        </div>
      )}

      {isExploring && (
        <GutenbergExplorer 
          onClose={() => setIsExploring(false)} 
          onAddBook={onAdd}
          theme={theme}
        />
      )}
    </div>
  );
};

export default Library;
