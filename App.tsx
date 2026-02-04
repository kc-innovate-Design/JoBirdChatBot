
import React, { useState } from 'react';
import { CabinetModel, SOP, AuditEntry, SalesFeedback } from './types';
import { CABINET_CATALOG, ACTIVE_SOPS as MOCK_ACTIVE, PROPOSED_CHANGES as MOCK_DRAFTS, AUDIT_LOG as MOCK_AUDIT, CHANGE_REQUESTS } from './constants';
import Header from './components/Header';
import ProductCatalog from './components/ProductCatalog';
import ChatInterface from './components/ChatInterface';
import AdminPanel from './components/AdminPanel';

type View = 'assistant' | 'admin';

const App: React.FC = () => {
  const [catalog] = useState<CabinetModel[]>(CABINET_CATALOG);
  const [activeSops, setActiveSops] = useState<SOP[]>(MOCK_ACTIVE);
  const [draftSops, setDraftSops] = useState<SOP[]>(MOCK_DRAFTS);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>(MOCK_AUDIT);
  const [salesFeedback, setSalesFeedback] = useState<SalesFeedback[]>([]);
  
  const [selectedModel, setSelectedModel] = useState<CabinetModel | null>(null);
  const [currentView, setCurrentView] = useState<View>('assistant');

  const addAuditEntry = (action: string, detail: string) => {
    const newEntry: AuditEntry = {
      id: `LOG-${Math.floor(Math.random() * 9000) + 1000}`,
      user: 'admin_current',
      action,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
      changeDetail: detail
    };
    setAuditLog(prev => [newEntry, ...prev]);
  };

  const handleProposeSop = (newSop: SOP) => {
    setDraftSops(prev => [...prev, newSop]);
    addAuditEntry('Propose SOP', `New draft created: ${newSop.id}`);
  };

  const handleApproveSop = (draftId: string) => {
    const draft = draftSops.find(d => d.id === draftId);
    if (!draft) return;
    const newActive: SOP = { 
      ...draft, 
      status: 'Active', 
      version: draft.version.replace('-draft', ''),
      lastUpdated: new Date().toISOString().split('T')[0]
    };
    if (draft.replacesId) {
      setActiveSops(prev => prev.map(s => s.id === draft.replacesId ? { ...s, status: 'Deprecated' } : s));
    }
    setActiveSops(prev => [...prev.filter(s => s.id !== draft.id), newActive]);
    setDraftSops(prev => prev.filter(d => d.id !== draftId));
    addAuditEntry('Approve SOP', `SOP ${draft.id} published to Active`);
  };

  const handleDeprecateSop = (id: string, reason: string) => {
    setActiveSops(prev => prev.map(s => s.id === id ? { ...s, status: 'Deprecated', changeReason: reason } : s));
    addAuditEntry('Deprecate SOP', `SOP ${id} marked as Deprecated`);
  };

  const handleSubmitFeedback = (feedback: SalesFeedback) => {
    setSalesFeedback(prev => [feedback, ...prev]);
    addAuditEntry('Submit Feedback', `Feedback received from ${feedback.userId}`);
  };

  return (
    <div className="min-h-screen flex flex-col font-sans bg-white">
      <Header />

      {currentView === 'assistant' ? (
        <main className="flex-1 w-full p-4 lg:p-8">
          <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
            
            {/* Sidebar Menu Style Catalog */}
            <div className="lg:col-span-3">
              <div className="sticky top-20">
                <ProductCatalog 
                  catalog={catalog} 
                  onSelect={setSelectedModel} 
                  activeId={selectedModel?.id} 
                />
              </div>
            </div>

            {/* Central Content (Selection Assistant) */}
            <div className="lg:col-span-6">
              <ChatInterface 
                catalog={catalog} 
                activeSops={activeSops.filter(s => s.status === 'Active')} 
                onSubmitFeedback={handleSubmitFeedback}
                selectedModel={selectedModel}
                onOpenAdmin={() => setCurrentView('admin')}
              />
            </div>

            {/* Right: Technical Details Panel (Unit Preview) */}
            <div className="lg:col-span-3">
              <div className="sticky top-20">
                {selectedModel ? (
                  <div className="bg-white border border-slate-200 shadow-xl p-5 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div className="flex flex-col items-center text-center mb-6">
                      <div className="w-32 h-32 bg-slate-50 rounded flex items-center justify-center mb-4 border border-slate-100 group">
                         <i className="fas fa-cube text-4xl text-slate-200 group-hover:text-jobird-red transition-colors"></i>
                      </div>
                      <span className="text-[9px] font-black text-jobird-red uppercase tracking-[0.3em] mb-1">Technical Specification</span>
                      <h3 className="text-xl font-black text-slate-900 tracking-tighter leading-none mb-1">{selectedModel.id}</h3>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{selectedModel.title}</p>
                    </div>

                    <div className="space-y-5">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-jobird-lightGrey p-3 text-center">
                          <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Ext. Height</p>
                          <p className="text-md font-black text-slate-900">{selectedModel.externalDims.h}mm</p>
                        </div>
                        <div className="bg-jobird-lightGrey p-3 text-center">
                          <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Ext. Width</p>
                          <p className="text-md font-black text-slate-900">{selectedModel.externalDims.w}mm</p>
                        </div>
                      </div>

                      <div className="border-y border-slate-100 py-3">
                         <h4 className="text-[9px] font-black text-slate-400 uppercase mb-2 tracking-widest">Internal Base Clearance</h4>
                         <div className="flex justify-between items-center text-[11px] font-bold text-slate-700">
                           <span>{selectedModel.internalDimsBase.h}H</span>
                           <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                           <span>{selectedModel.internalDimsBase.w}W</span>
                           <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                           <span>{selectedModel.internalDimsBase.d}D</span>
                         </div>
                      </div>

                      <div className="text-[11px] text-slate-500 leading-relaxed font-medium italic">
                        "{selectedModel.description}"
                      </div>

                      <button className="w-full bg-jobird-red text-white py-3 font-black uppercase text-[10px] tracking-widest hover:bg-red-700 transition-colors flex items-center justify-center gap-2">
                        <i className="fas fa-file-pdf"></i>
                        Datasheet
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-slate-100 p-8 text-center rounded-sm">
                    <i className="fas fa-hand-pointer text-slate-200 text-3xl mb-3"></i>
                    <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">
                      Select a model to view specs
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      ) : (
        <AdminPanel 
          onBack={() => setCurrentView('assistant')}
          activeSops={activeSops}
          draftSops={draftSops}
          auditLog={auditLog}
          salesFeedback={salesFeedback}
          changeRequests={CHANGE_REQUESTS}
          onPropose={handleProposeSop}
          onApprove={handleApproveSop}
          onDeprecate={handleDeprecateSop}
        />
      )}
    </div>
  );
};

export default App;
