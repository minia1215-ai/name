import React, { useState, useMemo, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { format } from 'date-fns';
import { GoogleGenAI } from "@google/genai";

// --- Types ---
type StorageType = '냉장고' | '냉동실' | '실온' | '조미료';
type TabType = 'fridge' | 'recipes' | 'shopping';
type RecipeStatus = 'always' | 'want' | 'none';
type RecipeFilter = 'ready' | 'almost' | 'always' | 'want' | 'all' | 'ai_find' | null;

interface Ingredient {
  id: string; name: string; emoji: string; quantity: string;
  category: StorageType; purchaseDate: string; expiryDate?: string; label?: string;
}
interface Recipe { 
  id: string; title: string; ingredients: string[]; 
  url?: string; status: RecipeStatus; emoji: string;
}
interface ShoppingItem { 
  id: string; name: string; store: string; price: number; completed: boolean; 
}

// --- Constants & Utils ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const EMOJI_MAP: Record<string, string> = {
  '계란': '🥚', '우유': '🥛', '고기': '🥩', '무': '🥙', '당근': '🥕', '양파': '🧅', 
  '버섯': '🍄', '파': '🌿', '마늘': '🧄', '두부': '⬜', '숙주': '🌱', '김치': '🌶️', '물': '💧', '사과': '🍎', '빵': '🍞', '치즈': '🧀', '햄': '🥓', '생선': '🐟'
};
const FOOD_EMOJIS = ['🥘', '🍛', '🥗', '🍝', '🍜', '🍲', '🍱', '🍖', '🍗', '🥪', '🍕', '🍔'];
const getAutoEmoji = (n: string) => EMOJI_MAP[Object.keys(EMOJI_MAP).find(k => n.includes(k)) || ''] || '📦';
const getRandomRecipeEmoji = (ings: string[]) => {
  const found = ings.map(i => EMOJI_MAP[Object.keys(EMOJI_MAP).find(k => i.includes(k)) || '']).filter(Boolean);
  if (found.length > 0) return found[Math.floor(Math.random() * found.length)]!;
  return FOOD_EMOJIS[Math.floor(Math.random() * FOOD_EMOJIS.length)]!;
};
const parsePrice = (val: string) => parseInt(String(val).replace(/[^0-9]/g, '')) || 0;

const App = () => {
  // Persistence
  const [ingredients, setIngredients] = useState<Ingredient[]>(() => JSON.parse(localStorage.getItem('fb_v6_ing') || '[]'));
  const [recipes, setRecipes] = useState<Recipe[]>(() => JSON.parse(localStorage.getItem('fb_v6_rec') || '[]'));
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>(() => JSON.parse(localStorage.getItem('fb_v6_shop') || '[]'));
  const [marts, setMarts] = useState<string[]>(() => JSON.parse(localStorage.getItem('fb_v6_marts') || '[]'));

  // UI State
  const [tab, setTab] = useState<TabType>('fridge');
  const [recFilter, setRecFilter] = useState<RecipeFilter>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiDiscoveredRecipe, setAiDiscoveredRecipe] = useState<Recipe | null>(null);
  const [prefillShopName, setPrefillShopName] = useState('');
  const [highlightedIngId, setHighlightedIngId] = useState<string | null>(null);
  
  // AI Search UI State
  const [aiIngFilterCat, setAiIngFilterCat] = useState<StorageType | null>(null);
  const [selectedIngsForAi, setSelectedIngsForAi] = useState<string[]>([]);
  
  // Accordion State
  const [expandedCats, setExpandedCats] = useState<string[]>([]);
  const toggleCat = (cat: string) => setExpandedCats(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);

  useEffect(() => {
    localStorage.setItem('fb_v6_ing', JSON.stringify(ingredients));
    localStorage.setItem('fb_v6_rec', JSON.stringify(recipes));
    localStorage.setItem('fb_v6_shop', JSON.stringify(shoppingItems));
    localStorage.setItem('fb_v6_marts', JSON.stringify(marts));
  }, [ingredients, recipes, shoppingItems, marts]);

  // --- Helpers ---
  const handleOwnedIngClick = (ingName: string) => {
    const ing = ingredients.find(i => i.name.includes(ingName));
    if (ing) {
      setTab('fridge');
      if (!expandedCats.includes(ing.category)) setExpandedCats(prev => [...prev, ing.category]);
      setHighlightedIngId(ing.id);
      setTimeout(() => setHighlightedIngId(null), 3000);
    }
  };

  const handleMissingIngClick = (ingName: string) => {
    setTab('shopping');
    setPrefillShopName(ingName);
    setIsAdding(true);
    setEditingId(null);
  };

  // --- AI Logic ---
  const handleAiExpiry = async (form: HTMLFormElement) => {
    const fd = new FormData(form);
    const n = fd.get('n') as string;
    const c = fd.get('c') as string;
    const p = fd.get('p') as string; 
    if (!n || !p) return alert('재료명과 구매일을 먼저 입력해주세요!');
    setLoading(true);
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `식품명: ${n}, 보관방법: ${c}, 구매일: ${p}. 예상 유통기한 종료일을 YYYY-MM-DD 형식으로 하나만 답하세요. 만약 식품명이 무의미한 문자열이거나 알 수 없는 단어라면 반드시 'INVALID'라고만 답변하세요.`
      });
      const text = res.text?.trim() || '';
      if (text.includes('INVALID')) {
        alert('정확하지 않은 식품명입니다. 다시 입력해 주세요.');
      } else {
        const date = text.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
        const input = form.querySelector('input[name="e"]') as HTMLInputElement;
        if (input) input.value = date;
      }
    } catch { alert('AI 추천 실패'); }
    setLoading(false);
  };

  const discoverRecipeWithSelection = async () => {
    if (selectedIngsForAi.length === 0) return alert('재료를 최소 하나 이상 선택해주세요!');
    setLoading(true);
    try {
      const ingNames = selectedIngsForAi.join(', ');
      const res = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `${ingNames}을 주재료로 초간단 요리 하나를 추천하세요. 재료명에 수량(2알, 50ml 등)을 절대 포함하지 말고 순수 재료 이름만 적으세요. 형식은 JSON: {"title": "요리명", "ingredients": ["계란", "양파", "간장"]}`
      });
      const data = JSON.parse((res.text || '').replace(/```json|```/g, '').trim());
      const newRecipe: Recipe = { 
        ...data, 
        id: 'temp-' + Date.now(), 
        status: 'none', 
        emoji: getRandomRecipeEmoji(data.ingredients) 
      };
      setAiDiscoveredRecipe(newRecipe);
    } catch { alert('레시피 추천 실패'); }
    setLoading(false);
  };

  // --- Core Logic ---
  const filteredRecipes = useMemo(() => {
    const myIngs = ingredients.map(i => i.name);
    return recipes.map(r => {
      const missing = r.ingredients.filter(ri => !myIngs.some(mn => mn.includes(ri)));
      return { ...r, missing };
    }).filter(r => {
      if (!recFilter) return false;
      if (recFilter === 'ready') return r.missing.length === 0 && r.status === 'none';
      if (recFilter === 'almost') return r.missing.length > 0 && r.missing.length <= 2 && r.status === 'none';
      if (recFilter === 'all') return true;
      if (recFilter === 'always') return r.status === 'always';
      if (recFilter === 'want') return r.status === 'want';
      return true;
    }).sort((a, b) => a.missing.length - b.missing.length);
  }, [recipes, ingredients, recFilter]);

  const groupedShopping = useMemo(() => {
    return shoppingItems.reduce((acc, item) => {
      const s = item.store || '미지정';
      if (!acc[s]) acc[s] = { items: [], total: 0 };
      acc[s].items.push(item);
      acc[s].total += item.price;
      return acc;
    }, {} as Record<string, { items: ShoppingItem[], total: number }>);
  }, [shoppingItems]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (tab === 'fridge') {
      const newItem: Ingredient = { 
        id: editingId || Date.now().toString(), name: fd.get('n') as string, emoji: fd.get('emoji') as string, quantity: fd.get('q') as string, 
        category: fd.get('c') as StorageType, purchaseDate: fd.get('p') as string, 
        expiryDate: fd.get('e') as string || undefined, label: fd.get('l') as string 
      };
      setIngredients(prev => editingId ? prev.map(i => i.id === editingId ? newItem : i) : [newItem, ...prev]);
    } else if (tab === 'recipes') {
      const title = (fd.get('t') as string).trim();
      const rawIngs = (fd.get('i') as string).split(',').map(s => s.trim()).filter(s => s !== "");
      const ings = Array.from(new Set(rawIngs));
      
      const isDuplicate = recipes.some(r => {
        if (editingId && r.id === editingId) return false;
        const sameTitle = r.title.trim() === title;
        const sameIngs = r.ingredients.length === ings.length && 
                         [...r.ingredients].sort().join(',') === [...ings].sort().join(',');
        return sameTitle && sameIngs;
      });

      if (isDuplicate) {
        alert('이미 동일한 이름과 재료 구성을 가진 레시피가 존재합니다!');
        return;
      }

      const inputEmoji = fd.get('re') as string;
      const finalEmoji = (inputEmoji === '🥘' || !inputEmoji || inputEmoji.trim() === '') ? getRandomRecipeEmoji(ings) : inputEmoji;

      const newItem: Recipe = { 
        id: editingId || Date.now().toString(), 
        title, 
        ingredients: ings, 
        url: fd.get('u') as string, 
        status: fd.get('status') as RecipeStatus,
        emoji: finalEmoji
      };
      setRecipes(prev => editingId ? prev.map(r => r.id === editingId ? newItem : r) : [newItem, ...prev]);
    } else {
      const store = (fd.get('s') as string) || '미지정';
      if (store !== '미지정' && !marts.includes(store)) setMarts([...marts, store]);
      const newItem: ShoppingItem = { 
        id: editingId || Date.now().toString(), name: fd.get('n') as string, store, 
        price: parsePrice(fd.get('pr') as string), completed: false 
      };
      setShoppingItems(prev => editingId ? prev.map(i => i.id === editingId ? newItem : i) : [newItem, ...prev]);
    }
    setIsAdding(false);
    setEditingId(null);
    setPrefillShopName('');
  };

  const editingItem = useMemo(() => {
    if (!editingId) return null;
    if (tab === 'fridge') return ingredients.find(i => i.id === editingId);
    if (tab === 'recipes') return recipes.find(r => r.id === editingId);
    if (tab === 'shopping') return shoppingItems.find(i => i.id === editingId);
    return null;
  }, [editingId, tab, ingredients, recipes, shoppingItems]);

  const filterDescFormat = {
    'ready': { e: '📥', t: 'READY' },
    'almost': { e: '📦', t: 'ALMOST' },
    'always': { e: '🌟', t: 'ALWAYS' },
    'want': { e: '💡', t: 'WANT' },
    'all': { e: '🗂️', t: 'ALL' },
    'ai_find': { e: '🔍', t: 'AI SEARCH' }
  };

  const EmptyState = ({ emoji, text, compact = false }: { emoji: string; text: string; compact?: boolean }) => (
    <div className={`${compact ? 'py-4' : 'py-20'} text-center space-y-2 animate-fade-up`}>
      <p className="text-2xl grayscale-0 italic-none select-none">{emoji}</p>
      <p className="text-[11px] text-[#A9AF8E] text-center uppercase tracking-widest font-normal italic">
        {text}
      </p>
    </div>
  );

  return (
    <div className="max-w-md mx-auto min-h-screen bg-[#FEFAE0] flex flex-col shadow-2xl select-none overflow-hidden text-[#606C38]">
      {/* HEADER */}
      <header className="p-8 pb-4 bg-[#FAEDCE] sticky top-0 z-40 border-b border-[#E0E5B6]">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl italic tracking-tighter uppercase font-bold">냉장고파먹기</h1>
          <button onClick={() => { setIsAdding(true); setEditingId(null); setPrefillShopName(''); }} className="w-12 h-12 bg-[#CCD5AE] text-white rounded-[22px] text-2xl shadow-xl active:scale-90 flex items-center justify-center">＋</button>
        </div>
        <div className="flex bg-[#E0E5B6] p-1 rounded-[24px]">
          {(['fridge', 'recipes', 'shopping'] as TabType[]).map(t => (
            <button key={t} onClick={() => { setTab(t); if(t!=='recipes') setRecFilter(null); setEditingId(null); }} className={`flex-1 py-3 text-[11px] rounded-[20px] transition-all ${tab === t ? 'bg-[#FAEDCE] shadow-sm text-[#606C38] font-bold' : 'text-[#A9AF8E]'}`}>
              {t === 'fridge' ? '나의 냉장고' : t === 'recipes' ? '요리 리서치' : '장보기 목록'}
            </button>
          ))}
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 p-6 pt-4 overflow-y-auto pb-32 no-scrollbar">
        
        {/* FRIDGE TAB */}
        {tab === 'fridge' && (['냉장고', '냉동실', '실온', '조미료'] as StorageType[]).map(cat => {
          const isExpanded = expandedCats.includes(cat);
          const catIngs = ingredients.filter(i => i.category === cat);
          return (
            <section key={cat} className="mb-1">
              <button 
                onClick={() => toggleCat(cat)} 
                className={`w-full flex justify-between items-center py-2 px-4 rounded-xl transition-all group hover:bg-[#FAEDCE]/50 ${isExpanded ? 'mb-1' : ''}`}
              >
                <h3 className={`text-[11px] uppercase tracking-tight transition-colors ${isExpanded ? 'text-[#606C38] font-bold' : 'text-[#A9AF8E] group-hover:text-[#606C38]'}`}>
                  {cat} ({catIngs.length})
                </h3>
                <span className={`text-[10px] transition-transform duration-300 ${isExpanded ? 'rotate-180 text-[#606C38]' : 'text-[#A9AF8E]'}`}>▼</span>
              </button>
              {isExpanded && (
                <div className="space-y-1 mt-0.5 animate-fade-up">
                  {catIngs.length === 0 ? (
                    <EmptyState emoji="🗑️" text="해당하는 재료가 없습니다." compact />
                  ) : (
                    catIngs.map(ing => {
                      const todayStr = format(new Date(), 'yyyy-MM-dd');
                      const isExp = ing.expiryDate && ing.expiryDate < todayStr;
                      const isHighlighted = highlightedIngId === ing.id;
                      return (
                        <div key={ing.id} onClick={() => { setEditingId(ing.id); setIsAdding(true); }} className={`flex items-center gap-3 px-5 py-1 rounded-[16px] border border-[#E0E5B6] shadow-sm active:scale-[0.98] transition-all group h-[58px] ${isHighlighted ? 'bg-[#FAEDCE] border-[#CCD5AE]' : 'bg-white/80'}`}>
                          <span className="text-lg flex-shrink-0 italic-none">{ing.emoji}</span>
                          <h4 className="text-[14px] truncate flex-shrink-0 font-medium">{ing.name}</h4>
                          {ing.label && <span className="text-[11px] bg-[#CCD5AE]/20 text-[#606C38] px-1.5 py-0.5 rounded whitespace-nowrap leading-none">{ing.label}</span>}
                          <div className="flex-1"></div>
                          <div className="text-right flex flex-col justify-center space-y-[5px] h-full min-w-[70px]">
                            <p className={`text-[11px] leading-none ${isExp ? 'text-red-600 font-bold' : 'text-[#A9AF8E]'}`}>
                              {ing.expiryDate ? `${isExp ? '🚨' : '⌛'} ${ing.expiryDate}` : <span className="invisible">p</span>}
                            </p>
                            <p className="text-[11px] leading-none text-[#606C38] tracking-tight">
                              {ing.quantity || <span className="invisible">p</span>}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </section>
          );
        })}

        {/* RECIPES TAB */}
        {tab === 'recipes' && (
          <div className="space-y-6 animate-fade-up">
            <div className="space-y-3">
              <div className="flex justify-between items-center bg-[#FAEDCE] p-2 rounded-[28px] border border-[#E0E5B6] shadow-sm overflow-x-auto no-scrollbar gap-1">
                {[
                  {id:'ready', e:'📥'}, {id:'almost', e:'📦'}, {id:'always', e:'🌟'}, 
                  {id:'want', e:'💡'}, {id:'all', e:'🗂️'}, {id:'ai_find', e:'🔍'}
                ].map(f => (
                  <button key={f.id} onClick={() => setRecFilter(f.id as any)} className={`flex-1 min-w-[44px] h-[44px] flex items-center justify-center rounded-[20px] text-lg transition-all ${recFilter === f.id ? 'bg-[#CCD5AE] shadow-lg scale-105' : 'bg-transparent grayscale opacity-40'}`}>
                    {f.e}
                  </button>
                ))}
              </div>
              {recFilter && (
                <div className="px-4 py-3 bg-[#FAEDCE]/50 rounded-2xl flex items-center justify-center border border-[#E0E5B6] shadow-sm">
                   <div className="flex items-center gap-3">
                     <span className="text-base italic-none">{(filterDescFormat as any)[recFilter].e}</span>
                     <span className="text-[8px] text-[#A9AF8E]">/</span>
                     <span className="text-[11px] text-[#606C38] uppercase tracking-widest font-bold">{(filterDescFormat as any)[recFilter].t}</span>
                   </div>
                </div>
              )}
            </div>
            
            {!recFilter && (
              <EmptyState emoji="🍽️" text="상단의 아이콘을 눌러 레시피를 확인하세요." />
            )}

            {recFilter === 'ai_find' ? (
              <div className="space-y-6 animate-fade-up">
                <div className="bg-[#FAEDCE]/40 p-6 rounded-[32px] space-y-4 border border-[#E0E5B6]">
                  <p className="text-[11px] text-[#606C38] px-1 uppercase tracking-widest font-bold">장소별 재료 선택</p>
                  <div className="flex gap-2">
                    {(['냉장고', '냉동실', '실온', '조미료'] as StorageType[]).map(c => (
                      <button key={c} onClick={() => setAiIngFilterCat(c)} className={`flex-1 py-3 rounded-2xl text-[11px] transition-all font-medium ${aiIngFilterCat === c ? 'bg-[#CCD5AE] text-white' : 'bg-white text-[#A9AF8E] border border-[#E0E5B6]'}`}>{c}</button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2 min-h-[100px] items-start p-1">
                    {!aiIngFilterCat ? (
                      <p className="text-[11px] text-[#A9AF8E] w-full text-center py-12 font-normal italic">장소를 선택하여 재료를 골라보세요.</p>
                    ) : (
                      ingredients.filter(i => i.category === aiIngFilterCat).map(ing => {
                        const isSel = selectedIngsForAi.includes(ing.name);
                        return (
                          <button key={ing.id} onClick={() => setSelectedIngsForAi(prev => isSel ? prev.filter(x => x !== ing.name) : [...prev, ing.name])} className={`px-4 py-3 rounded-[20px] flex items-center gap-2 border transition-all active:scale-95 ${isSel ? 'bg-[#CCD5AE] border-[#CCD5AE] text-white shadow-md' : 'bg-white border-[#E0E5B6] text-[#606C38] shadow-sm'}`}>
                            <span className="italic-none">{ing.emoji}</span> <span className="text-[14px] font-medium">{ing.name}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="px-2">
                   <button onClick={discoverRecipeWithSelection} disabled={loading || selectedIngsForAi.length === 0} className={`w-full py-5 rounded-[28px] text-[14px] font-bold shadow-xl transition-all active:scale-95 ${selectedIngsForAi.length > 0 ? 'bg-[#CCD5AE] text-white' : 'bg-[#E0E5B6] text-[#A9AF8E]'}`}>
                    {loading ? 'AI가 고민 중입니다...' : `선택한 ${selectedIngsForAi.length}개의 재료로 레시피 찾기`}
                   </button>
                </div>

                {aiDiscoveredRecipe && (
                  <div className="bg-[#FAEDCE] p-6 rounded-[32px] border border-[#CCD5AE] shadow-sm relative animate-fade-up">
                    <div className="flex justify-between items-center mb-4">
                      <div className="flex items-center gap-2 h-[40px]">
                        <span className="text-xl flex-shrink-0 italic-none">{aiDiscoveredRecipe.emoji}</span>
                        <h4 className="text-[14px] tracking-tight truncate leading-none font-bold text-[#606C38]">{aiDiscoveredRecipe.title}</h4>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-6">
                      {aiDiscoveredRecipe.ingredients.map(ri => { 
                        const has = ingredients.some(i => i.name.includes(ri)); 
                        return <span key={ri} className={`text-[11px] px-3 py-1.5 rounded-full font-medium ${has ? 'bg-[#CCD5AE]/30 text-[#606C38]' : 'bg-red-100 text-red-500'}`}>{has ? '✅' : '🛒'} {ri}</span>;
                      })}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <button onClick={() => {setRecipes([{...aiDiscoveredRecipe, id: Date.now().toString(), status: 'always'}, ...recipes]); setAiDiscoveredRecipe(null);}} className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white text-yellow-600 border border-[#FAEDCE] active:scale-95 transition-all shadow-sm">
                          <span className="text-lg italic-none">🌟</span>
                        </button>
                        <button onClick={() => {setRecipes([{...aiDiscoveredRecipe, id: Date.now().toString(), status: 'want'}, ...recipes]); setAiDiscoveredRecipe(null);}} className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white text-blue-500 border border-[#FAEDCE] active:scale-95 transition-all shadow-sm">
                          <span className="text-lg italic-none">💡</span>
                        </button>
                        <button onClick={() => {setRecipes([{...aiDiscoveredRecipe, id: Date.now().toString(), status: 'none'}, ...recipes]); setAiDiscoveredRecipe(null);}} className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white text-[#A9AF8E] border border-[#FAEDCE] active:scale-95 transition-all shadow-sm">
                          <span className="text-lg italic-none">🗂️</span>
                        </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              recFilter && (
                filteredRecipes.length === 0 ? (
                  <EmptyState emoji="🍽️" text="해당하는 레시피가 없습니다." />
                ) : (
                  filteredRecipes.map(r => (
                    <div key={r.id} onClick={() => {setEditingId(r.id); setIsAdding(true);}} className="bg-[#FAEDCE]/30 p-6 rounded-[32px] border border-[#E0E5B6] shadow-sm group relative animate-fade-up">
                      <div className="flex justify-between items-center mb-4 gap-3">
                        <button onClick={(e) => { e.stopPropagation(); if(r.url) window.open(r.url); else window.open(`https://www.google.com/search?q=${encodeURIComponent(r.title + ' 레시피')}`); }} className="flex-1 flex items-center gap-2 group/title overflow-hidden h-[40px]">
                          <span className="text-xl flex-shrink-0 italic-none">{r.emoji}</span>
                          <h4 className="text-[14px] tracking-tight group-hover/title:text-[#CCD5AE] transition-colors underline decoration-[#E0E5B6] truncate leading-none font-bold text-[#606C38]">{r.title}</h4>
                        </button>
                        <div className="flex gap-1 h-[40px] items-center flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => setRecipes(recipes.map(rc => rc.id === r.id ? {...rc, status: rc.status === 'always' ? 'none' : 'always'} : rc))} className={`w-9 h-9 flex items-center justify-center rounded-full transition-all border ${r.status === 'always' ? 'bg-white text-yellow-600 border-[#CCD5AE] shadow-sm' : 'bg-white/50 border-[#E0E5B6] text-[#A9AF8E]'}`}>🌟</button>
                          <button onClick={() => setRecipes(recipes.map(rc => rc.id === r.id ? {...rc, status: rc.status === 'want' ? 'none' : 'want'} : rc))} className={`w-9 h-9 flex items-center justify-center rounded-full transition-all border ${r.status === 'want' ? 'bg-white text-blue-500 border-[#CCD5AE] shadow-sm' : 'bg-white/50 border-[#E0E5B6] text-[#A9AF8E]'}`}>💡</button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {r.ingredients.map(ri => { 
                          const has = ingredients.some(i => i.name.includes(ri)); 
                          return (
                            <button key={ri} onClick={(e) => { e.stopPropagation(); has ? handleOwnedIngClick(ri) : handleMissingIngClick(ri); }} className={`text-[11px] px-3 py-1.5 rounded-full transition-transform active:scale-90 font-medium ${has ? 'bg-[#CCD5AE]/40 text-[#606C38]' : 'bg-red-50 text-red-500 border border-red-100'}`}>
                              {has ? '✅' : '🛒'} {ri}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )
              )
            )}
          </div>
        )}

        {/* SHOPPING TAB */}
        {tab === 'shopping' && (
          <div className="space-y-4 animate-fade-up">
            {Object.keys(groupedShopping).length === 0 && (
              <EmptyState emoji="🛒" text="장보기 목록이 없습니다." />
            )}
            {(Object.entries(groupedShopping) as any).map(([store, data]: any) => {
              const isExpanded = expandedCats.includes(store);
              return (
                <section key={store} className="mb-2">
                  <button 
                    onClick={() => toggleCat(store)} 
                    className={`w-full flex justify-between items-center py-4 px-4 rounded-xl transition-all group hover:bg-[#FAEDCE]/50 ${isExpanded ? 'mb-1' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      <h3 className={`text-[11px] uppercase tracking-tight transition-colors font-bold ${isExpanded ? 'text-[#606C38]' : 'text-[#A9AF8E] group-hover:text-[#606C38]'}`}>
                        {store} ({data.items.length})
                      </h3>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full transition-colors font-bold ${isExpanded ? 'bg-[#CCD5AE] text-white' : 'bg-[#E0E5B6] text-[#606C38]'}`}>
                        {data.total.toLocaleString()}원
                      </span>
                    </div>
                    <span className={`text-[10px] transition-transform duration-300 ${isExpanded ? 'rotate-180 text-[#606C38]' : 'text-[#A9AF8E]'}`}>▼</span>
                  </button>
                  {isExpanded && (
                    <div className="space-y-1 mt-1">
                      {data.items.map((item: any) => (
                        <div key={item.id} onClick={() => {setEditingId(item.id); setIsAdding(true);}} className="flex items-center gap-4 bg-white/80 px-5 py-3 rounded-[20px] border border-[#E0E5B6] shadow-sm active:scale-[0.98] transition-all group h-[58px]">
                          <button onClick={(e) => { e.stopPropagation(); setShoppingItems(shoppingItems.map(si => si.id === item.id ? {...si, completed: !si.completed} : si)); }} className={`w-5 h-5 rounded-full border-2 transition-all flex items-center justify-center flex-shrink-0 ${item.completed ? 'bg-[#CCD5AE] border-[#CCD5AE] text-white text-[11px]' : 'border-[#E0E5B6]'}`}>
                            {item.completed && '✓'}
                          </button>
                          <div className="flex-1 flex justify-between items-center overflow-hidden">
                            <span className={`text-[14px] truncate font-medium ${item.completed ? 'line-through text-[#A9AF8E]' : 'text-[#606C38]'}`}>{item.name}</span>
                            <span className="text-[11px] text-[#A9AF8E] flex-shrink-0 ml-2 font-bold">{item.price > 0 ? `${item.price.toLocaleString()}원` : ''}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </main>

      {/* MODAL (ADD & EDIT) */}
      {isAdding && (
        <div className="fixed inset-0 bg-[#606C38]/40 backdrop-blur-md z-50 flex items-end">
          <form onSubmit={handleSubmit} className="bg-[#FEFAE0] w-full rounded-t-[32px] p-6 pb-12 shadow-2xl animate-in slide-in-from-bottom duration-500 max-h-[95vh] overflow-y-auto no-scrollbar border-t border-[#CCD5AE]">
            <div className="flex justify-between items-center mb-6 px-2">
              <h2 className="text-[16px] tracking-tight font-bold text-[#606C38]">{editingId ? '수정하기' : '새 정보 입력'}</h2>
              <button type="button" onClick={() => { setIsAdding(false); setEditingId(null); setPrefillShopName(''); }} className="text-[#A9AF8E] text-3xl font-light">✕</button>
            </div>
            
            <div className="space-y-3">
              {tab === 'fridge' ? (
                <>
                  <div className="flex gap-2">
                    <input name="emoji" maxLength={2} defaultValue={(editingItem as Ingredient)?.emoji || '📦'} className="w-12 h-[48px] bg-[#FAEDCE] p-3 rounded-[18px] text-center text-lg border-none outline-none focus:ring-2 focus:ring-[#CCD5AE] flex-shrink-0 italic-none" />
                    <input name="n" required defaultValue={(editingItem as Ingredient)?.name} placeholder="재료명" onChange={(ev) => { if(!editingId) (ev.target.form!.querySelector('input[name="emoji"]') as HTMLInputElement).value = getAutoEmoji(ev.target.value); }} className="flex-1 h-[48px] bg-[#FAEDCE] p-3 rounded-[18px] text-[13px] border-none outline-none focus:ring-2 focus:ring-[#CCD5AE] text-[#606C38] font-medium" />
                    <input name="l" placeholder="라벨" defaultValue={(editingItem as Ingredient)?.label} className="w-20 h-[48px] bg-[#E0E5B6] p-3 rounded-[18px] text-[11px] font-bold text-[#606C38] border-none outline-none italic-none" />
                  </div>
                  <div className="flex gap-2">
                    <input name="q" defaultValue={(editingItem as Ingredient)?.quantity} placeholder="수량" className="flex-1 h-[48px] bg-[#FAEDCE] p-3 rounded-[18px] text-[13px] font-medium border-none outline-none focus:ring-2 focus:ring-[#CCD5AE] text-[#606C38]" />
                    <select name="c" defaultValue={(editingItem as Ingredient)?.category || '냉장고'} className="flex-1 h-[48px] bg-[#FAEDCE] p-3 rounded-[18px] text-[13px] font-medium border-none outline-none focus:ring-2 focus:ring-[#CCD5AE] text-[#606C38]">
                      <option>냉장고</option><option>냉동실</option><option>실온</option><option>조미료</option>
                    </select>
                  </div>
                  <div className="bg-[#E0E5B6]/30 p-4 rounded-[24px] flex gap-4 border border-[#E0E5B6]">
                    <div className="flex-1">
                      <label className="text-[10px] font-bold text-[#A9AF8E] mb-2 block uppercase tracking-wider">구매일</label>
                      <input name="p" type="date" defaultValue={(editingItem as Ingredient)?.purchaseDate || format(new Date(), 'yyyy-MM-dd')} className="w-full bg-[#FAEDCE] p-3 rounded-[14px] text-[13px] border-none shadow-sm outline-none text-[#606C38] font-medium" />
                    </div>
                    <div className="flex-1 relative">
                      <div className="flex justify-between items-center mb-2">
                        <label className="text-[10px] font-bold text-[#A9AF8E] uppercase tracking-wider">유통기한</label>
                        <button type="button" onClick={(e) => handleAiExpiry(e.currentTarget.form!)} disabled={loading} className="text-[10px] font-bold text-[#CCD5AE] active:scale-95 transition-all">✨ AI SEARCH</button>
                      </div>
                      <input name="e" type="date" defaultValue={(editingItem as Ingredient)?.expiryDate} className="w-full bg-[#FAEDCE] p-3 rounded-[14px] text-[13px] border-none shadow-sm outline-none text-[#606C38] font-medium" />
                    </div>
                  </div>
                </>
              ) : tab === 'recipes' ? (
                <>
                  <div className="flex gap-2">
                    <input name="re" maxLength={2} defaultValue={(editingItem as Recipe)?.emoji || '🥘'} className="w-12 h-[48px] bg-[#FAEDCE] p-3 rounded-[18px] text-center text-lg border-none outline-none focus:ring-2 focus:ring-[#CCD5AE] flex-shrink-0 italic-none" />
                    <input name="t" required defaultValue={(editingItem as Recipe)?.title} placeholder="요리 이름" className="flex-1 h-[48px] bg-[#FAEDCE] p-3 rounded-[18px] text-[13px] border-none outline-none focus:ring-2 focus:ring-[#CCD5AE] text-[#606C38] font-bold" />
                  </div>
                  <textarea name="i" required defaultValue={(editingItem as Recipe)?.ingredients.join(', ')} placeholder="필요 재료 (쉼표로 구분)" className="w-full bg-[#FAEDCE] p-3 rounded-[18px] text-[13px] min-h-[100px] border-none outline-none focus:ring-2 focus:ring-[#CCD5AE] text-[#606C38] font-medium" />
                  <input name="u" defaultValue={(editingItem as Recipe)?.url} placeholder="레시피 URL" className="w-full bg-[#FAEDCE] p-3 rounded-[18px] text-[13px] border-none outline-none focus:ring-2 focus:ring-[#CCD5AE] font-medium text-[#606C38]" />
                  <div className="flex gap-2">
                    {[{v:'always',e:'🌟'},{v:'want',e:'💡'},{v:'none',e:'🗂️'}].map(st => (
                      <label key={st.v} className="flex-1 cursor-pointer">
                        <input type="radio" name="status" value={st.v} defaultChecked={(editingItem as Recipe)?.status === st.v || (!editingId && st.v==='none')} className="hidden peer" />
                        <div className="p-3 rounded-[14px] bg-[#FAEDCE] text-xl flex items-center justify-center transition-all shadow-sm border border-[#E0E5B6] peer-checked:bg-[#CCD5AE] peer-checked:border-[#CCD5AE] peer-checked:scale-105 italic-none">{st.e}</div>
                      </label>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <input name="n" required defaultValue={prefillShopName || (editingItem as ShoppingItem)?.name} placeholder="무엇을 살까요?" className="w-full bg-[#FAEDCE] p-3 rounded-[18px] text-[13px] border-none outline-none focus:ring-2 focus:ring-[#CCD5AE] font-bold text-[#606C38]" />
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <input name="s" defaultValue={(editingItem as ShoppingItem)?.store} placeholder="마트" list="marts-list" className="w-full bg-[#FAEDCE] p-3 rounded-[18px] text-[13px] border-none font-medium outline-none focus:ring-2 focus:ring-[#CCD5AE] text-[#606C38]" />
                      <datalist id="marts-list">{marts.map(m => <option key={m} value={m} />)}</datalist>
                    </div>
                    <input name="pr" defaultValue={(editingItem as ShoppingItem)?.price || ''} placeholder="가격(원)" className="w-32 bg-[#FAEDCE] p-3 rounded-[18px] text-[13px] border-none font-bold text-right outline-none focus:ring-2 focus:ring-[#CCD5AE] text-[#606C38]" />
                  </div>
                </>
              )}
              
              <div className="flex gap-3 pt-4">
                {editingId && <button type="button" onClick={() => { if(tab==='fridge') setIngredients(prev => prev.filter(i=>i.id!==editingId)); else if(tab==='recipes') setRecipes(prev => prev.filter(r=>r.id!==editingId)); else setShoppingItems(prev => prev.filter(i=>i.id!==editingId)); setIsAdding(false); setEditingId(null); }} className="flex-1 bg-red-100 text-red-600 py-4 rounded-[20px] text-[13px] font-bold active:scale-95 transition-all border border-red-200 shadow-sm">삭제</button>}
                <button disabled={loading} className="flex-[2] bg-[#CCD5AE] text-white py-4 rounded-[20px] text-[13px] font-bold shadow-2xl active:scale-95 transition-all disabled:bg-[#E0E5B6]">{editingId ? '수정 완료' : '저장하기'}</button>
              </div>
            </div>
          </form>
        </div>
      )}

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        @keyframes fade-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-up { animation: fade-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .italic-none { font-style: normal !important; }
      `}</style>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);