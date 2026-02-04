
import React from 'react';
import { CabinetModel } from '../types';

interface ProductCatalogProps {
  catalog: CabinetModel[];
  onSelect: (model: CabinetModel) => void;
  activeId?: string;
}

const ProductCatalog: React.FC<ProductCatalogProps> = ({ catalog, onSelect, activeId }) => {
  // Real JoBird product line categories
  const categoryConfigs = [
    { 
      id: 'Fire Safety', 
      name: 'Fire Extinguisher & Hose Cabinets', 
      color: 'bg-jobird-red', 
      icon: 'fa-fire-extinguisher' 
    },
    { 
      id: 'Marine Safety', 
      name: 'Lifejacket & Survival Chests', 
      color: 'bg-jobird-navy', 
      icon: 'fa-life-ring' 
    },
    { 
      id: 'Medical & Emergency', 
      name: 'Stretcher & SCBA Cabinets', 
      color: 'bg-jobird-green', 
      icon: 'fa-briefcase-medical' 
    },
    { 
      id: 'Industrial', 
      name: 'Roller Shutter & Large Storage', 
      color: 'bg-slate-700', 
      icon: 'fa-warehouse' 
    },
  ];

  return (
    <div className="w-full flex flex-col shadow-lg border border-slate-200">
      {categoryConfigs.map((config) => {
        const filteredItems = catalog.filter(m => m.category === config.id);
        
        if (filteredItems.length === 0) return null;

        return (
          <div key={config.id} className="mb-px last:mb-0">
            {/* Category Header */}
            <div className={`${config.color} text-white px-5 py-4 flex items-center justify-between text-[11px] font-black uppercase tracking-widest cursor-default`}>
              <div className="flex items-center gap-3">
                <i className={`fas ${config.icon} w-4 text-center text-white/80`}></i>
                {config.name}
              </div>
            </div>
            
            {/* Product List */}
            <div className="bg-white">
              {filteredItems.map(model => (
                <button
                  key={model.id}
                  onClick={() => onSelect(model)}
                  className={`w-full text-left px-8 py-3.5 text-[12px] font-bold border-b border-slate-50 transition-all duration-200 group flex items-center justify-between ${
                    activeId === model.id 
                      ? 'text-jobird-red bg-slate-50 border-l-4 border-l-jobird-red' 
                      : 'text-slate-600 hover:text-jobird-red hover:bg-slate-50 border-l-4 border-l-transparent'
                  }`}
                >
                  <span>
                    <span className="opacity-50 mr-2">{model.id}</span>
                    {model.title}
                  </span>
                  <i className={`fas fa-chevron-right text-[8px] transition-transform ${activeId === model.id ? 'translate-x-1 opacity-100' : 'opacity-0 group-hover:opacity-40'}`}></i>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      
      {/* Fallback for miscellaneous items if any exist */}
      {catalog.some(m => !categoryConfigs.find(c => c.id === m.category)) && (
        <div className="bg-slate-100 text-slate-500 px-5 py-4 flex items-center justify-between text-[11px] font-black uppercase tracking-widest">
          <div className="flex items-center gap-3">
            <i className="fas fa-ellipsis-h w-4"></i>
            Other Systems
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductCatalog;
