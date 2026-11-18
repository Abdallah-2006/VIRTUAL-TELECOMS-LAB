import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search, Plus, GripVertical, Waves } from 'lucide-react';
import { categories, moduleDefinitions } from '../modules/registry';

interface Props { onAdd: (type: string) => void; collapsed: boolean; onToggle: () => void }

export function ModuleLibrary({ onAdd, collapsed, onToggle }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string[]>(['Signal Sources', 'Signal Processing']);
  const filtered = useMemo(() => moduleDefinitions.filter((item) => `${item.name} ${item.description} ${item.category}`.toLowerCase().includes(query.toLowerCase())), [query]);
  const toggle = (category: string) => setOpen((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category]);
  if (collapsed) return <aside className="library-rail"><button className="icon-button rail-toggle" title="Open module library" onClick={onToggle}><ChevronRight size={18} /></button><Waves size={18} className="rail-wave" /></aside>;
  return (
    <aside className="module-library">
      <div className="side-heading"><div><span className="eyebrow">FACEPLATE SECTIONS</span><h2>Function modules</h2></div><button className="icon-button" title="Collapse module library" onClick={onToggle}><ChevronRight size={18} /></button></div>
      <label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a module" aria-label="Search modules" /><kbd>/</kbd></label>
      <div className="library-scroll">
        {categories.map((category) => {
          const items = filtered.filter((item) => item.category === category);
          const isOpen = open.includes(category) || Boolean(query);
          return (
            <section className="library-category" key={category}>
              <button className="category-toggle" onClick={() => toggle(category)}>
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span>{category}</span>
                {items.length ? <span className="category-count">{items.length}</span> : <span className="planned-tag">ROADMAP</span>}
              </button>
              {isOpen && (items.length ? <div className="module-list">{items.map((item) => (
                <button className="module-library-item" key={item.type} draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-telecom-module', item.type); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => onAdd(item.type)} title={`${item.description} — click to add, or drag to place`}>
                  <GripVertical size={14} className="grip" /><span className="rack-code">{item.shortName}</span><span className="module-list-copy"><strong>{item.name}</strong><small>{item.inputs.length} IN <span>·</span> {item.outputs.length} OUT <span>·</span> ANALOG</small></span><Plus size={14} className="add-glyph" />
                </button>
              ))}</div> : <div className="planned-copy">Module definitions will be added in a later milestone.</div>)}
            </section>
          );
        })}
      </div>
      <div className="library-foot"><span className="live-dot" /> {moduleDefinitions.length} active module types <span className="foot-sep">/</span> local simulation</div>
    </aside>
  );
}
