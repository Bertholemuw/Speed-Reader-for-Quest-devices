
import React, { useState, useEffect, useRef } from 'react';
import { Book, SpritzWord, UserSettings, ThemeType, FontType, FontSize } from '../types';
import { 
  Play, Pause, RotateCcw, SkipBack, SkipForward, 
  Settings2, ChevronLeft, BrainCircuit, MessageSquareText,
  Type, Palette, FastForward, X, Maximize, Minimize
} from 'lucide-react';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { summarizePassage, explainWord, aiAvailable } from '../services/geminiService';
import { useBackHandler } from '../services/backButton';
import { isNative } from '../services/platform';
import { tokenize } from '../services/tokenize';

interface ReaderProps {
  book: Book;
  onUpdatePosition: (id: string, pos: number) => void;
  onClose: () => void;
  settings: UserSettings;
  onUpdateSettings: (settings: Partial<UserSettings>) => void;
}

const Reader: React.FC<ReaderProps> = ({ book, onUpdatePosition, onClose, settings, onUpdateSettings }) => {
  const [index, setIndex] = useState(book.lastPosition || 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [summary, setSummary] = useState("");
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isZenMode, setIsZenMode] = useState(false);
  const [showControlsInZen, setShowControlsInZen] = useState(false);

  const timeoutRef = useRef<number | null>(null);
  const controlsTimeoutRef = useRef<number | null>(null);
  const words = useRef<string[]>(tokenize(book.content));

  // Spritz Logic: Optimal Recognition Point calculation
  const getSpritzWord = (word: string): SpritzWord => {
    if (!word) return { prefix: '', orp: '', suffix: '' };
    let orpIndex = 0;
    const len = word.length;
    if (len === 1) orpIndex = 0;
    else if (len >= 2 && len <= 5) orpIndex = 1;
    else if (len >= 6 && len <= 9) orpIndex = 2;
    else if (len >= 10 && len <= 13) orpIndex = 3;
    else orpIndex = 4;

    return {
      prefix: word.substring(0, orpIndex),
      orp: word.charAt(orpIndex),
      suffix: word.substring(orpIndex + 1),
    };
  };

  const handleTogglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  const handleSkip = (amount: number) => {
    const next = Math.max(0, Math.min(words.current.length - 1, index + amount));
    setIndex(next);
  };

  const handleReset = () => {
    setIndex(0);
    setIsPlaying(false);
  };

  const toggleZenMode = () => {
    setIsZenMode(!isZenMode);
    setShowControlsInZen(false);
  };

  const showZenUI = () => {
    if (!isZenMode) return;
    setShowControlsInZen(true);
    if (controlsTimeoutRef.current) window.clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = window.setTimeout(() => {
      setShowControlsInZen(false);
    }, 4000); // Hide controls after 4 seconds of inactivity in Zen mode
  };

  // Listen for interaction in Zen mode
  useEffect(() => {
    const handleActivity = () => showZenUI();
    window.addEventListener('click', handleActivity);
    window.addEventListener('keydown', handleActivity);
    return () => {
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('keydown', handleActivity);
    };
  }, [isZenMode]);

  const handleSummarize = async () => {
    if (isSummarizing) return;
    setIsSummarizing(true);
    setShowSummary(true);
    const start = Math.max(0, index - 50);
    const end = Math.min(words.current.length, index + 300);
    const context = words.current.slice(start, end).join(" ");
    const result = await summarizePassage(context);
    setSummary(result || "No summary available.");
    setIsSummarizing(false);
  };

  const handleExplain = async () => {
    const word = words.current[index];
    const context = words.current.slice(Math.max(0, index - 10), Math.min(words.current.length, index + 10)).join(" ");
    setExplanation("Thinking...");
    const result = await explainWord(word, context);
    setExplanation(result || "Could not define word.");
  };

  // Playback Loop: Simple interval based on WPM
  useEffect(() => {
    if (isPlaying) {
      const scheduleNext = () => {
        const delay = 60000 / settings.wpm;

        timeoutRef.current = window.setTimeout(() => {
          setIndex(prev => {
            if (prev >= words.current.length - 1) {
              setIsPlaying(false);
              return prev;
            }
            return prev + 1;
          });
          scheduleNext();
        }, delay);
      };

      scheduleNext();
    } else {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isPlaying, settings.wpm]);

  useEffect(() => {
    onUpdatePosition(book.id, index);
  }, [index, book.id, onUpdatePosition]);

  // Keep the screen on while words are flashing
  useEffect(() => {
    if (!isNative) return;
    (isPlaying ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(() => {});
  }, [isPlaying]);
  useEffect(() => () => { if (isNative) KeepAwake.allowSleep().catch(() => {}); }, []);

  // Android back button closes the top-most layer first
  const closeAi = () => { setShowSummary(false); setExplanation(null); };
  useBackHandler(isZenMode, () => setIsZenMode(false));
  useBackHandler(isSettingsOpen, () => setIsSettingsOpen(false));
  useBackHandler(showSummary || explanation !== null, closeAi);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setIndex(Math.round(ratio * (words.current.length - 1)));
  };

  const currentSpritz = getSpritzWord(words.current[index]);

  // CSS Mapping
  const fontClassMap: Record<FontType, string> = {
    jetbrains: 'jetbrains-mono',
    inter: 'font-sans',
    serif: 'font-serif'
  };

  const sizeClassMap: Record<FontSize, string> = {
    small: 'text-3xl md:text-5xl',
    medium: 'text-4xl md:text-7xl',
    large: 'text-5xl md:text-8xl',
    'extra-large': 'text-6xl md:text-9xl'
  };

  const themeColors = {
    dark: { bg: 'bg-zinc-950', card: 'bg-zinc-900', border: 'border-zinc-800', text: 'text-zinc-100', muted: 'text-zinc-500', accent: 'text-cyan-500' },
    amoled: { bg: 'bg-black', card: 'bg-zinc-950', border: 'border-zinc-900', text: 'text-white', muted: 'text-zinc-600', accent: 'text-cyan-600' },
    sepia: { bg: 'bg-[#f4ecd8]', card: 'bg-[#e8dfc4]', border: 'border-[#d3cbb3]', text: 'text-[#5b4636]', muted: 'text-[#a6927d]', accent: 'text-orange-800' },
    light: { bg: 'bg-zinc-50', card: 'bg-white', border: 'border-zinc-200', text: 'text-zinc-900', muted: 'text-zinc-400', accent: 'text-cyan-600' }
  }[settings.theme];

  const uiVisible = !isZenMode || showControlsInZen;

  return (
    <div className={`min-h-full flex flex-col items-center justify-center p-4 md:p-6 relative transition-all duration-300 ${themeColors.bg} ${isZenMode ? 'cursor-none' : ''}`}>
      
      {/* Stable Reader Unit */}
      <div className="w-full max-w-5xl flex flex-col items-center">
        
        {/* Return Navigation */}
        <div className={`transition-opacity duration-500 ${uiVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <button 
            onClick={onClose}
            className={`mb-4 md:mb-10 flex items-center gap-2 hover:opacity-80 px-5 md:px-8 py-2 md:py-3 rounded-full border transition-all ${themeColors.text} ${themeColors.border} ${themeColors.card} shadow-lg`}
          >
            <ChevronLeft size={20} />
            Library
          </button>
        </div>

        {/* The Main Reading HUD */}
        <div className={`w-full rounded-3xl md:rounded-[2rem] border p-5 md:p-16 relative overflow-hidden transition-all duration-500 ${isZenMode ? 'border-transparent bg-transparent shadow-none p-0' : `${themeColors.card} ${themeColors.border} shadow-2xl`}`}>
          
          {/* Word Display Engine */}
          <div
            onClick={handleTogglePlay}
            className={`h-40 md:h-64 flex items-center justify-center relative overflow-hidden select-none cursor-pointer transition-transform duration-500 ${isZenMode ? 'scale-110 translate-y-8' : ''}`}
          >
            <div className={`${fontClassMap[settings.fontFamily]} ${sizeClassMap[settings.fontSize]} flex items-center justify-start w-full relative pl-[35%] font-black tracking-tight`}>
              <span className={`${themeColors.muted} absolute right-[65%] text-right whitespace-nowrap`}>
                {currentSpritz.prefix}
              </span>
              <span className={themeColors.accent}>
                {currentSpritz.orp}
              </span>
              <span className={themeColors.text}>
                {currentSpritz.suffix}
              </span>
            </div>
          </div>

          {/* Progress Indicator */}
          <div className={`mt-6 md:mt-12 space-y-3 md:space-y-4 md:px-6 transition-opacity duration-500 ${uiVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <div onClick={handleSeek} className="w-full py-2 -my-2 cursor-pointer" title="Tap to jump">
            <div className="w-full bg-zinc-500/10 h-2 rounded-full overflow-hidden border border-zinc-500/5">
              <div 
                className="bg-cyan-600 h-full transition-all duration-300" 
                style={{ width: `${(index / Math.max(1, words.current.length - 1)) * 100}%` }}
              />
            </div>
            </div>
            <div className={`flex justify-between gap-2 text-[10px] md:text-[11px] uppercase tracking-wider md:tracking-[0.2em] jetbrains-mono font-bold ${themeColors.muted}`}>
              <span>WORD {index + 1} / {words.current.length}</span>
              <span>{Math.round((index / words.current.length) * 100)}%</span>
            </div>
          </div>
        </div>

        {/* Control Panel */}
        <div className={`mt-4 md:mt-10 flex flex-col items-center gap-5 md:gap-8 w-full max-w-3xl p-5 md:p-10 rounded-3xl md:rounded-[2rem] border transition-all duration-500 ${uiVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'} ${themeColors.card} ${themeColors.border} shadow-xl`}>
          <div className="flex items-center gap-8 md:gap-16">
            <button onClick={() => handleSkip(-10)} aria-label="Back 10 words" className={`${themeColors.muted} hover:text-cyan-500 transition-all hover:scale-110 active:scale-95`}><SkipBack className="w-7 h-7 md:w-8 md:h-8" /></button>
            <button 
              onClick={handleTogglePlay}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="w-16 h-16 md:w-24 md:h-24 shrink-0 rounded-full bg-cyan-600 flex items-center justify-center text-white hover:bg-cyan-500 hover:scale-105 active:scale-90 transition-all shadow-lg"
            >
              {isPlaying ? <Pause className="w-8 h-8 md:w-10 md:h-10" fill="currentColor" /> : <Play className="w-8 h-8 md:w-10 md:h-10 ml-1 md:ml-2" fill="currentColor" />}
            </button>
            <button onClick={() => handleSkip(10)} aria-label="Forward 10 words" className={`${themeColors.muted} hover:text-cyan-500 transition-all hover:scale-110 active:scale-95`}><SkipForward className="w-7 h-7 md:w-8 md:h-8" /></button>
            <button onClick={handleReset} aria-label="Restart" className={`${themeColors.muted} hover:text-red-500 transition-all hover:scale-110 active:scale-95`}><RotateCcw className="w-7 h-7 md:w-8 md:h-8" /></button>
          </div>

          <div className={`flex flex-wrap items-center gap-3 md:gap-6 w-full md:px-8 border-t ${themeColors.border} pt-5 md:pt-8 justify-center md:justify-between`}>
            {aiAvailable && <div className="flex gap-3 md:gap-4">
              <button onClick={handleSummarize} className={`flex items-center gap-2 px-4 md:px-5 py-2.5 rounded-xl border ${themeColors.border} hover:bg-zinc-500/5 transition-all text-sm font-bold uppercase tracking-wider ${themeColors.text}`}>
                <BrainCircuit size={18} /> Summarize
              </button>
              <button onClick={handleExplain} className={`flex items-center gap-2 px-4 md:px-5 py-2.5 rounded-xl border ${themeColors.border} hover:bg-zinc-500/5 transition-all text-sm font-bold uppercase tracking-wider ${themeColors.text}`}>
                <MessageSquareText size={18} /> Explain
              </button>
            </div>}
            
            <div className="flex gap-3">
              <button 
                onClick={toggleZenMode}
                className={`flex items-center gap-2 px-4 md:px-6 py-2.5 rounded-xl border ${themeColors.border} hover:bg-zinc-500/5 transition-all text-sm font-bold uppercase tracking-wider ${themeColors.text}`}
                title={isZenMode ? "Exit Zen Mode" : "Enter Zen Mode"}
                aria-label={isZenMode ? "Exit Zen Mode" : "Enter Zen Mode"}
              >
                {isZenMode ? <Minimize size={18} /> : <Maximize size={18} />}
                <span className="hidden sm:inline">{isZenMode ? "Windowed" : "Zen Mode"}</span>
              </button>

              <button 
                onClick={() => setIsSettingsOpen(true)}
                aria-label="Settings"
                className="flex items-center gap-2 px-4 md:px-6 py-2.5 rounded-xl bg-cyan-600 text-white hover:bg-cyan-500 transition-all text-sm font-bold uppercase tracking-wider shadow-md"
              >
                <Settings2 size={18} /> <span className="hidden sm:inline">Settings</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-end sm:items-center justify-center p-3 sm:p-6" onClick={() => setIsSettingsOpen(false)}>
          <div className={`w-full max-w-xl max-h-[90vh] overflow-auto rounded-3xl md:rounded-[2rem] border p-6 md:p-10 space-y-6 md:space-y-8 shadow-2xl relative transition-all duration-300 ${themeColors.card} ${themeColors.border}`} onClick={e => e.stopPropagation()}>
            <div className={`flex items-center justify-between border-b ${themeColors.border} pb-6`}>
              <h3 className={`text-xl md:text-2xl font-bold flex items-center gap-3 ${themeColors.text}`}><Settings2 /> Reading Settings</h3>
              <button onClick={() => setIsSettingsOpen(false)} className={`${themeColors.muted} hover:text-white`}><X size={32} /></button>
            </div>

            <div className="space-y-8">
              {/* WPM */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className={`flex items-center gap-2 font-bold text-sm ${themeColors.muted}`}><FastForward size={14} /> WPM SPEED</span>
                  <span className="text-2xl font-black text-cyan-500 jetbrains-mono">{settings.wpm}</span>
                </div>
                <input 
                  type="range" min="100" max="1500" step="50" 
                  value={settings.wpm} 
                  onChange={(e) => onUpdateSettings({ wpm: parseInt(e.target.value) })}
                  className="w-full accent-cyan-600 h-2 bg-zinc-500/20 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              {/* Font Family */}
              <div className="space-y-4">
                <span className={`font-bold text-sm ${themeColors.muted}`}>TYPEFACE</span>
                <div className="grid grid-cols-3 gap-3">
                  {(['jetbrains', 'inter', 'serif'] as FontType[]).map(f => (
                    <button 
                      key={f}
                      onClick={() => onUpdateSettings({ fontFamily: f })}
                      className={`py-3 rounded-xl border-2 transition-all text-xs font-bold uppercase ${
                        settings.fontFamily === f ? 'border-cyan-500 bg-cyan-500/10 text-cyan-500' : `${themeColors.border} ${themeColors.text} hover:bg-zinc-500/5`
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Font Size */}
              <div className="space-y-4">
                <span className={`flex items-center gap-2 font-bold text-sm ${themeColors.muted}`}><Type size={14} /> SIZE</span>
                <div className="grid grid-cols-4 gap-3">
                  {(['small', 'medium', 'large', 'extra-large'] as FontSize[]).map(sz => (
                    <button
                      key={sz}
                      onClick={() => onUpdateSettings({ fontSize: sz })}
                      className={`py-3 rounded-xl border-2 transition-all text-xs font-bold uppercase ${
                        settings.fontSize === sz ? 'border-cyan-500 bg-cyan-500/10 text-cyan-500' : `${themeColors.border} ${themeColors.text} hover:bg-zinc-500/5`
                      }`}
                    >
                      {sz === 'extra-large' ? 'XL' : sz === 'medium' ? 'MED' : sz}
                    </button>
                  ))}
                </div>
              </div>

              {/* Themes */}
              <div className="space-y-4">
                <span className={`font-bold text-sm ${themeColors.muted}`}>THEME</span>
                <div className="grid grid-cols-4 gap-3">
                  {(['dark', 'amoled', 'sepia', 'light'] as ThemeType[]).map(t => (
                    <button 
                      key={t}
                      onClick={() => onUpdateSettings({ theme: t })}
                      className={`py-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${
                        settings.theme === t ? 'border-cyan-500' : themeColors.border
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full border ${t === 'light' ? 'bg-white' : t === 'dark' ? 'bg-zinc-900' : t === 'sepia' ? 'bg-[#e8dfc4]' : 'bg-black'}`} />
                      <span className="text-[10px] uppercase font-bold text-zinc-500">{t}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Modals */}
      {(showSummary || explanation) && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[150] flex items-center justify-center p-4 md:p-12" onClick={() => { setShowSummary(false); setExplanation(null); }}>
          <div className={`${themeColors.card} border ${themeColors.border} p-6 md:p-10 rounded-3xl md:rounded-[2.5rem] max-w-3xl w-full shadow-2xl space-y-6`} onClick={e => e.stopPropagation()}>
            <div className={`flex items-center gap-3 font-bold text-xl border-b ${themeColors.border} pb-6 text-cyan-500 uppercase`}>
              {explanation ? <MessageSquareText /> : <BrainCircuit />}
              {explanation ? "Definition" : "Summary"}
            </div>
            <div className={`${themeColors.text} leading-relaxed text-base md:text-xl max-h-[50vh] overflow-auto pr-2 md:pr-6 scrollbar-thin`}>
              {explanation || (isSummarizing ? "Processing..." : summary)}
            </div>
            <button 
              onClick={() => { setShowSummary(false); setExplanation(null); }}
              className="w-full py-4 bg-cyan-600 text-white font-bold rounded-2xl hover:bg-cyan-500 transition-all shadow-lg active:scale-95"
            >
              Back to Reader
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Reader;
