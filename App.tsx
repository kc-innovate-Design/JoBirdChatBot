
import React, { useState } from 'react';
import { CabinetModel, SOP, AuditEntry, SalesFeedback } from './types';
import { CABINET_CATALOG, ACTIVE_SOPS as MOCK_ACTIVE, PROPOSED_CHANGES as MOCK_DRAFTS, AUDIT_LOG as MOCK_AUDIT, CHANGE_REQUESTS } from './constants';
import Header from './components/Header';
import ChatInterface from './components/ChatInterface';
import AdminPanel from './components/AdminPanel';
import Login from './components/Login';
import { getConfig } from './lib/config';

type View = 'assistant' | 'admin';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return localStorage.getItem('jb_authenticated') === 'true';
  });
  const [catalog] = useState<CabinetModel[]>(CABINET_CATALOG);
  const [activeSops, setActiveSops] = useState<SOP[]>(MOCK_ACTIVE);
  const [draftSops, setDraftSops] = useState<SOP[]>(MOCK_DRAFTS);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>(MOCK_AUDIT);
  const [salesFeedback, setSalesFeedback] = useState<SalesFeedback[]>([]);

  const [selectedModel, setSelectedModel] = useState<CabinetModel | null>(null);
  const [currentView, setCurrentView] = useState<View>('assistant');

  const handleLogin = (password: string) => {
    const config = getConfig();
    if (password === config.VITE_APP_PASSWORD) {
      setIsAuthenticated(true);
      localStorage.setItem('jb_authenticated', 'true');
      return true;
    }
    return false;
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem('jb_authenticated');
  };

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

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen flex flex-col font-sans bg-white">
      <Header />
      <div className="absolute top-4 right-4 z-50">
        <button
          onClick={handleLogout}
          className="text-jobird-navy/60 hover:text-jobird-red font-black uppercase text-[9px] tracking-widest transition-colors"
        >
          Logout
        </button>
      </div>

      {currentView === 'assistant' ? (
        <main className="flex-1 w-full p-4 lg:p-8">
          <div className="max-w-6xl mx-auto">
            <ChatInterface
              catalog={catalog}
              activeSops={activeSops.filter(s => s.status === 'Active')}
              onSubmitFeedback={handleSubmitFeedback}
              selectedModel={selectedModel}
              onOpenAdmin={() => setCurrentView('admin')}
            />
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
