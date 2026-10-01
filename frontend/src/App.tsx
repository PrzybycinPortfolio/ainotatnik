import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthPage } from './pages/AuthPage';
import { ChatPage } from './pages/ChatPage';
import { FilesPage } from './pages/FilesPage';
import './App.css';

type Tab = 'chat' | 'files';

function Shell() {
  const { session, loading, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>('chat');

  if (loading) return <div className="app-loading">Ładowanie…</div>;
  if (!session) return <AuthPage />;

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>AI Notatnik</h1>
        <nav>
          <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
            Czat
          </button>
          <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>
            Pliki
          </button>
        </nav>
        <div className="app-user">
          <span>{session.user.email}</span>
          <button onClick={signOut}>Wyloguj</button>
        </div>
      </header>

      <main className="app-main">{tab === 'chat' ? <ChatPage /> : <FilesPage />}</main>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

export default App;
