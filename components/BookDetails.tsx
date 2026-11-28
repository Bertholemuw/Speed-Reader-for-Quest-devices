import React from 'react';
import { X, BookOpen } from 'lucide-react';
import { ThemeType } from '../types';
import { useBackHandler } from '../services/backButton';

interface BookDetailsProps {
  title: string;
  author?: string;
  synopsis?: string;
  subjects?: string[];
  theme: ThemeType;
  onClose: () => void;
  /** Primary action, e.g. Import or Read */
  action?: React.ReactNode;
}

const sheetColors: Record<ThemeType, string> = {
  dark: 'bg-zinc-900 border-zinc-700 text-zinc-100',
  amoled: 'bg-zinc-950 border-zinc-800 text-white',
  sepia: 'bg-[#f4ecd8] border-[#d3cbb3] text-[#5b4636]',
  light: 'bg-white border-zinc-200 text-zinc-900',
};

const BookDetails: React.FC<BookDetailsProps> = ({ title, author, synopsis, subjects, theme, onClose, action }) => {
  useBackHandler(true, onClose);
  const muted = theme === 'sepia' ? 'text-[#8a7560]' : 'text-zinc-500';

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[250] flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={onClose}>
      <div
        className={`w-full max-w-2xl max-h-[85vh] flex flex-col border rounded-t-3xl sm:rounded-3xl shadow-2xl ${sheetColors[theme]}`}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label={`About ${title}`}
      >
        <div className="p-5 md:p-8 pb-4 flex items-start gap-4">
          <div className="w-12 h-12 shrink-0 bg-cyan-600 rounded-xl flex items-center justify-center">
            <BookOpen className="text-white" size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl md:text-2xl font-bold leading-tight">{title}</h2>
            {author && <p className={`${muted} italic mt-1`}>{author}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="p-2 -m-2 hover:opacity-70"><X size={24} /></button>
        </div>

        <div className="px-5 md:px-8 overflow-auto flex-1 space-y-4">
          <p className={`text-xs font-bold uppercase tracking-widest ${muted}`}>Synopsis · spoiler-free</p>
          <p className="leading-relaxed text-base md:text-lg">
            {synopsis || <span className={muted}>No synopsis available for this book.</span>}
          </p>
          {subjects && subjects.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-2">
              {subjects.map(s => (
                <span key={s} className="text-xs px-3 py-1 rounded-full bg-cyan-600/10 text-cyan-500">{s}</span>
              ))}
            </div>
          )}
        </div>

        {action && <div className="p-5 md:p-8 pt-4">{action}</div>}
      </div>
    </div>
  );
};

export default BookDetails;
