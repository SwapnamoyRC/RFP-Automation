import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import UploadPage from './pages/UploadPage';
import ReviewPage from './pages/ReviewPage';
import SummaryPage from './pages/SummaryPage';
import HistoryPage from './pages/HistoryPage';
import CatalogPage from './pages/CatalogPage';
import { useSession } from './hooks/useSession';
import { useAuth } from './hooks/useAuth';

function App() {
  const auth = useAuth();
  const {
    session,
    items,
    loading,
    processing,
    progress,
    error,
    history,
    createAndProcess,
    refreshItems,
    approveItem,
    rejectItem,
    pickAlternative,
    overrideItem,
    downloadPPT,
    loadSession,
    resumePollingIfNeeded,
  } = useSession();

  if (!auth.isAuthenticated) {
    return (
      <Routes>
        <Route
          path="/login"
          element={
            <LoginPage
              onLogin={auth.login}
              onRegister={auth.register}
              loading={auth.loading}
              error={auth.error}
            />
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Layout historyCount={history.length} user={auth.user} onLogout={auth.logout}>
      <Toaster position="top-right" richColors closeButton />
      <Routes>
        <Route
          path="/"
          element={<UploadPage onProcess={createAndProcess} />}
        />
        <Route
          path="/review"
          element={
            <ReviewPage
              items={items}
              session={session}
              onApprove={approveItem}
              onReject={rejectItem}
              onSelectAlt={pickAlternative}
              onOverride={overrideItem}
              onRefresh={refreshItems}
              onResumePolling={resumePollingIfNeeded}
              processing={processing}
              progress={progress}
            />
          }
        />
        <Route
          path="/summary"
          element={
            <SummaryPage
              items={items}
              session={session}
              onDownloadPPT={downloadPPT}
              history={history}
            />
          }
        />
        <Route
          path="/history"
          element={
            <HistoryPage
              history={history}
              onLoadSession={loadSession}
            />
          }
        />
        <Route
          path="/catalog"
          element={<CatalogPage user={auth.user} />}
        />
        <Route path="/login" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default App;
