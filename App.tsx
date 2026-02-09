
import React, { useState } from 'react';
import { CabinetModel, SOP, AuditEntry, SalesFeedback } from './types';
import { CABINET_CATALOG, ACTIVE_SOPS as MOCK_ACTIVE, PROPOSED_CHANGES as MOCK_DRAFTS, AUDIT_LOG as MOCK_AUDIT, CHANGE_REQUESTS } from './constants';
import Header from './components/Header';
import ChatInterface from './components/ChatInterface';
import AdminPanel from './components/AdminPanel';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import { Message, DatasheetReference } from './types';

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  datasheets: DatasheetReference[];
  timestamp: Date;
}

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

  // Multi-session state
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const defaultSession: ChatSession = {
      id: 'session-1',
      title: 'New Selection',
      messages: [{ role: 'assistant', content: "Hi, how can I help you?", timestamp: new Date() }],
      datasheets: [],
      timestamp: new Date()
    };
    return [defaultSession];
  });
  const [activeSessionId, setActiveSessionId] = useState<string>('session-1');

  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];

  const handleNewChat = () => {
    const newId = `session-${Date.now()}`;
    const newSession: ChatSession = {
      id: newId,
      title: `New Chat ${sessions.length + 1}`,
      messages: [{ role: 'assistant', content: "Hi, I'm ready to help with another cabinet selection. What are you looking for?", timestamp: new Date() }],
      datasheets: [],
      timestamp: new Date()
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newId);
  };

  const handleSelectSession = (id: string) => setActiveSessionId(id);

  const handleDeleteSession = (id: string) => {
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (filtered.length === 0) {
        return [{
          id: 'session-default',
          title: 'New Selection',
          messages: [{ role: 'assistant', content: "Hi, how can I help you?", timestamp: new Date() }],
          datasheets: [],
          timestamp: new Date()
        }];
      }
      return filtered;
    });
    if (activeSessionId === id) {
      setActiveSessionId(sessions.find(s => s.id !== id)?.id || 'session-default');
    }
  };

  const updateActiveSession = (newMessages: Message[], newDatasheets?: DatasheetReference[]) => {
    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        // Dynamic title based on first user message if title is still default
        let title = s.title;
        if ((title.startsWith('New Chat') || title === 'New Selection') && newMessages.length > 1) {
          const firstUserMsg = newMessages.find(m => m.role === 'user');
          if (firstUserMsg) {
            // Extract key product topics for a meaningful summary
            const content = firstUserMsg.content.toLowerCase();
            const topics: string[] = [];

            // Check for common product categories
            if (content.includes('life jacket') || content.includes('immersion')) topics.push('Life Jackets');
            if (content.includes('fire hose') || content.includes('hose cabinet')) topics.push('Fire Hose');
            if (content.includes('scba') || content.includes('breathing apparatus') || content.includes('ba cabinet')) topics.push('SCBA');
            if (content.includes('stretcher') || content.includes('duofold')) topics.push('Stretcher');
            if (content.includes('arctic') || content.includes('heater') || content.includes('insulation')) topics.push('Arctic');
            if (content.includes('marine') || content.includes('offshore') || content.includes('vessel')) topics.push('Marine');

            if (topics.length > 0) {
              title = topics.slice(0, 2).join(' & ') + ' Enquiry';
            } else {
              // Fallback: Use first meaningful words
              title = firstUserMsg.content.slice(0, 35) + (firstUserMsg.content.length > 35 ? '...' : '');
            }
          }
        }
        // Merge datasheets instead of replacing, deduplicating by filename
        let datasheets = s.datasheets;
        if (newDatasheets) {
          const merged = [...s.datasheets];
          newDatasheets.forEach(ds => {
            const isDuplicate = merged.find(m =>
              m.filename.toLowerCase().trim() === ds.filename.toLowerCase().trim()
            );
            if (!isDuplicate) {
              merged.push(ds);
            }
          });
          datasheets = merged;
        }

        return {
          ...s,
          messages: newMessages,
          datasheets: datasheets,
          title
        };
      }
      return s;
    }));
  };

  const handleLogin = async (password: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      if (data.valid) {
        setIsAuthenticated(true);
        localStorage.setItem('jb_authenticated', 'true');
        return true;
      }
      return false;
    } catch (error) {
      console.error('Login verification failed:', error);
      return false;
    }
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
        <main className="flex-1 flex overflow-hidden">
          <Sidebar
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectSession}
            onNewChat={handleNewChat}
            onDeleteSession={handleDeleteSession}
          />
          <div className="flex-1 p-4 lg:p-8 overflow-y-auto bg-slate-50/30">
            <div className="max-w-6xl mx-auto">
              <ChatInterface
                key={activeSessionId}
                catalog={catalog}
                activeSops={activeSops.filter(s => s.status === 'Active')}
                onSubmitFeedback={handleSubmitFeedback}
                selectedModel={selectedModel}
                onOpenAdmin={() => setCurrentView('admin')}
                initialMessages={activeSession.messages}
                initialDatasheets={activeSession.datasheets}
                onSessionUpdate={updateActiveSession}
              />
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
