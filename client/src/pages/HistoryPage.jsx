import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  History, FileSpreadsheet, CheckCircle2, XCircle, Clock,
  ArrowRight, Package, Timer
} from 'lucide-react';

function formatDuration(ms) {
  if (!ms || ms <= 0) return null;
  const totalSecs = Math.round(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function StatusBadge({ status }) {
  const config = {
    completed: { label: 'Generated', bg: 'bg-emerald-100', text: 'text-emerald-700' },
    reviewing: { label: 'In Review', bg: 'bg-amber-100', text: 'text-amber-700' },
    processing: { label: 'Processing', bg: 'bg-blue-100', text: 'text-blue-700' },
    cancelled: { label: 'Cancelled', bg: 'bg-gray-100', text: 'text-gray-500' },
    awaiting_file: { label: 'Awaiting File', bg: 'bg-gray-100', text: 'text-gray-500' },
  };
  const c = config[status] || { label: status, bg: 'bg-gray-100', text: 'text-gray-600' };

  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

export default function HistoryPage({ history = [], onLoadSession }) {
  const navigate = useNavigate();

  const handleResume = async (sessionId) => {
    if (!onLoadSession) return;
    try {
      await onLoadSession(sessionId);
      navigate('/review');
    } catch (err) {
      console.error('Failed to load session:', err);
    }
  };

  const stats = useMemo(() => {
    const completed = history.filter(s => s.status === 'completed').length;
    const totalItems = history.reduce((sum, s) => sum + (parseInt(s.total_items) || 0), 0);
    const totalApproved = history.reduce((sum, s) => sum + (parseInt(s.approved_count_calc || s.approved_count) || 0), 0);
    return { completed, totalItems, totalApproved };
  }, [history]);

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
          <History className="w-8 h-8 text-gray-300" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">No History Yet</h2>
        <p className="text-sm text-gray-500 mb-6">Process your first RFP to see it here.</p>
        <button
          onClick={() => navigate('/')}
          className="px-5 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700"
        >
          Upload RFP
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Session History</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          All processed RFP sessions and their outcomes
        </p>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="p-5 rounded-2xl border bg-white border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{history.length}</p>
              <p className="text-xs text-gray-500">Total Sessions</p>
            </div>
          </div>
        </div>
        <div className="p-5 rounded-2xl border bg-emerald-50 border-emerald-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.completed}</p>
              <p className="text-xs text-gray-500">Completed</p>
            </div>
          </div>
        </div>
        <div className="p-5 rounded-2xl border bg-white border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center">
              <Package className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.totalApproved}</p>
              <p className="text-xs text-gray-500">Items Approved</p>
            </div>
          </div>
        </div>
      </div>

      {/* Session List */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-900">All Sessions</h2>
          </div>
        </div>

        <div className="divide-y divide-gray-50">
          {history.map((entry) => {
            const approved = parseInt(entry.approved_count_calc || entry.approved_count || 0);
            const rejected = parseInt(entry.rejected_count_calc || entry.rejected_count || 0);
            const total = parseInt(entry.total_items || 0);
            const pending = total - approved - rejected;
            const avgConf = parseFloat(entry.avg_confidence || 0);
            const canResume = entry.status === 'reviewing' && total > 0;

            return (
              <div
                key={entry.id}
                className={`px-6 py-5 hover:bg-gray-50 transition-colors ${canResume ? 'cursor-pointer' : ''}`}
                onClick={canResume ? () => handleResume(entry.id) : undefined}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: Session info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <FileSpreadsheet className="w-4 h-4 text-primary-500 shrink-0" />
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {entry.client_name || 'Web Client'}
                      </p>
                      <StatusBadge status={entry.status} />
                    </div>
                    <p className="text-xs text-gray-500 truncate mb-2 flex items-center gap-1.5">
                      {entry.file_name || `Session #${entry.id}`}
                      {entry.processing_time_ms > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-amber-500 text-[10px]">
                          <Timer className="w-2.5 h-2.5" />
                          {formatDuration(entry.processing_time_ms)}
                        </span>
                      )}
                    </p>

                    {/* Item breakdown bar */}
                    {total > 0 && (
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden flex">
                          {approved > 0 && (
                            <div
                              className="h-full bg-emerald-500 transition-all"
                              style={{ width: `${(approved / total) * 100}%` }}
                            />
                          )}
                          {rejected > 0 && (
                            <div
                              className="h-full bg-red-400 transition-all"
                              style={{ width: `${(rejected / total) * 100}%` }}
                            />
                          )}
                          {pending > 0 && (
                            <div
                              className="h-full bg-amber-300 transition-all"
                              style={{ width: `${(pending / total) * 100}%` }}
                            />
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] shrink-0">
                          <span className="flex items-center gap-1 text-emerald-600">
                            <CheckCircle2 className="w-3 h-3" />
                            {approved}
                          </span>
                          <span className="flex items-center gap-1 text-red-500">
                            <XCircle className="w-3 h-3" />
                            {rejected}
                          </span>
                          {pending > 0 && (
                            <span className="flex items-center gap-1 text-amber-600">
                              <Clock className="w-3 h-3" />
                              {pending}
                            </span>
                          )}
                          <span className="text-gray-400">/ {total}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right: Confidence + Date */}
                  <div className="text-right shrink-0">
                    {avgConf > 0 && (
                      <p className={`text-sm font-semibold mb-0.5 ${
                        avgConf >= 0.7 ? 'text-emerald-600' : 'text-amber-600'
                      }`}>
                        {Math.round(avgConf * 100)}%
                      </p>
                    )}
                    <p className="text-[11px] text-gray-400">
                      {formatDate(entry.updated_at || entry.created_at)}
                    </p>
                    {canResume && (
                      <div className="flex items-center gap-1 text-primary-600 text-[11px] font-medium mt-1 justify-end">
                        Resume <ArrowRight className="w-3 h-3" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
