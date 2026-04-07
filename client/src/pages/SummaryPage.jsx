import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { extractError } from '../utils/extractError';
import {
  Download, ArrowLeft, CheckCircle2, XCircle, Clock,
  Package, Loader2, FileSpreadsheet, BarChart3, History, Timer,
} from 'lucide-react';

function StatCard({ icon: Icon, label, value, color, bgColor }) {
  return (
    <div className={`p-5 rounded-2xl border ${bgColor} transition-all`}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl ${color} bg-opacity-10 flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        <div>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          <p className="text-xs text-gray-500">{label}</p>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return null;
  const totalSecs = Math.round(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

export default function SummaryPage({ items, session, onDownloadPPT, history = [] }) {
  const navigate = useNavigate();
  const [downloading, setDownloading] = useState(false);

  const stats = useMemo(() => {
    const all = items || [];
    const approved = all.filter(i => i.status === 'approved');
    const rejected = all.filter(i => i.status === 'rejected');
    const pending = all.filter(i => !i.status || i.status === 'pending' || i.status === 'matched');
    const avgConfidence = approved.length > 0
      ? approved.reduce((sum, i) => sum + (i.matchedProduct?.confidence || i.matchedProduct?.similarity || 0), 0) / approved.length
      : 0;

    return {
      total: all.length,
      approved: approved.length,
      rejected: rejected.length,
      pending: pending.length,
      approvedItems: approved,
      avgConfidence,
    };
  }, [items]);

  const processingTime = session?.processing_time_ms
    ? formatDuration(session.processing_time_ms)
    : null;

  const handleDownload = async () => {
    if (!session?.id) return;
    setDownloading(true);
    try {
      await onDownloadPPT(session.id);
    } catch (err) {
      toast.error(extractError(err, 'Failed to generate PPT'));
    } finally {
      setDownloading(false);
    }
  };

  if (!items || items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
          <BarChart3 className="w-8 h-8 text-gray-300" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">No Summary Available</h2>
        <p className="text-sm text-gray-500 mb-6">Process and review items first.</p>
        <button
          onClick={() => navigate('/')}
          className="px-5 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700"
        >
          Go to Upload
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <button
            onClick={() => navigate('/review')}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Review
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Session Summary</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {session?.clientName || session?.client_name || 'Web Client'} &middot; {stats.total} items processed
            {processingTime && (
              <span className="ml-2 inline-flex items-center gap-1 text-amber-600">
                <Timer className="w-3 h-3" />
                {processingTime}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Processing Time Banner */}
      {processingTime && (
        <div className="mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <Timer className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-amber-900">
              Total Processing Time: {processingTime}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {stats.total} items processed through the 4-step AI pipeline
              {stats.total > 0 && processingTime
                ? ` · ~${formatDuration(Math.round((session.processing_time_ms || 0) / stats.total))} per item`
                : ''}
            </p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={Package} label="Total Items" value={stats.total} color="text-primary-600" bgColor="bg-white border-gray-200" />
        <StatCard icon={CheckCircle2} label="Approved" value={stats.approved} color="text-emerald-600" bgColor="bg-emerald-50 border-emerald-200" />
        <StatCard icon={XCircle} label="Rejected" value={stats.rejected} color="text-red-600" bgColor="bg-red-50 border-red-200" />
        <StatCard icon={Clock} label="Pending" value={stats.pending} color="text-amber-600" bgColor="bg-amber-50 border-amber-200" />
      </div>

      {/* Confidence */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-8">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Confidence Overview</h2>
        <div className="flex items-center gap-4 mb-3">
          <span className="text-3xl font-bold text-gray-900">
            {Math.round(stats.avgConfidence * 100)}%
          </span>
          <span className="text-sm text-gray-500">Average Match Confidence</span>
        </div>
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary-500 to-emerald-500 rounded-full transition-all duration-700"
            style={{ width: `${stats.avgConfidence * 100}%` }}
          />
        </div>
      </div>

      {/* Approved Items Table */}
      {stats.approvedItems.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden mb-8">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">
              Approved Items ({stats.approvedItems.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-50">
            {stats.approvedItems.map((item, idx) => {
              const match = item.matchedProduct || {};
              const displayImage = item.isOverridden && item.overrideProductImageUrl ? item.overrideProductImageUrl : (match.imageUrl || match.image_url);
              const displayBrand = item.isOverridden ? item.overrideProductBrand : match.brand;
              const displayName = item.isOverridden ? item.overrideProductName : match.name;
              return (
                <div key={item.id || idx} className="px-6 py-3 flex items-center gap-4 hover:bg-gray-50">
                  <span className="text-xs text-gray-400 w-6 text-right">{idx + 1}</span>
                  {displayImage && (
                    <img
                      src={displayImage}
                      alt={displayName}
                      className="w-10 h-10 rounded-lg object-contain bg-gray-50 border border-gray-100 shrink-0"
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {item.rfpItem || item.description}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {displayBrand} {displayName}
                      {item.isOverridden && <span className="ml-1 text-amber-600 text-[10px]">(overridden)</span>}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-xs font-semibold ${
                      (match.confidence || match.similarity || 0) >= 0.7
                        ? 'text-emerald-600'
                        : 'text-amber-600'
                    }`}>
                      {Math.round((match.confidence || match.similarity || 0) * 100)}%
                    </span>
                    {item.quantity && (
                      <p className="text-[10px] text-gray-400">Qty: {item.quantity}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Download Section */}
      <div className="bg-gradient-to-br from-primary-600 to-primary-800 rounded-2xl p-8 text-center">
        <FileSpreadsheet className="w-10 h-10 text-white/80 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-white mb-1">Generate Proposal</h2>
        <p className="text-sm text-primary-200 mb-6">
          Export approved items as a PowerPoint presentation ready for your client.
        </p>
        <button
          onClick={handleDownload}
          disabled={downloading || stats.approved === 0}
          className={`inline-flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-semibold transition-all ${
            downloading || stats.approved === 0
              ? 'bg-white/20 text-white/50 cursor-not-allowed'
              : 'bg-white text-primary-700 hover:bg-primary-50 shadow-lg'
          }`}
        >
          {downloading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              Download PPTX ({stats.approved} items)
            </>
          )}
        </button>
        {stats.pending > 0 && (
          <p className="text-xs text-primary-300 mt-3">
            {stats.pending} items still pending review
          </p>
        )}
      </div>

      {/* Session History */}
      {history.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden mt-8">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
            <History className="w-4 h-4 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-900">
              Completed Actions ({history.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-50">
            {history.map((entry) => {
              const approved = parseInt(entry.approved_count_calc || entry.approved_count || 0);
              const rejected = parseInt(entry.rejected_count_calc || entry.rejected_count || 0);
              const total = parseInt(entry.total_items || 0);
              const avgConf = parseFloat(entry.avg_confidence || 0);
              const duration = formatDuration(entry.processing_time_ms);
              const statusLabel = entry.status === 'completed' ? 'Generated'
                : entry.status === 'reviewing' ? 'In Review'
                : entry.status === 'processing' ? 'Processing'
                : entry.status;

              return (
                <div key={entry.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <FileSpreadsheet className="w-4 h-4 text-primary-500 shrink-0" />
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {entry.client_name || 'Web Client'}
                        </p>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          entry.status === 'completed' ? 'bg-emerald-100 text-emerald-700'
                          : entry.status === 'reviewing' ? 'bg-amber-100 text-amber-700'
                          : 'bg-gray-100 text-gray-600'
                        }`}>
                          {statusLabel}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        {entry.file_name || `Session #${entry.id}`}
                        {duration && (
                          <span className="ml-2 text-amber-600 inline-flex items-center gap-0.5">
                            <Timer className="w-2.5 h-2.5" />
                            {duration}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 shrink-0 ml-4">
                      <div className="text-right">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="flex items-center gap-1 text-emerald-600">
                            <CheckCircle2 className="w-3 h-3" />
                            {approved}
                          </span>
                          <span className="flex items-center gap-1 text-red-500">
                            <XCircle className="w-3 h-3" />
                            {rejected}
                          </span>
                          <span className="text-gray-400">/ {total}</span>
                        </div>
                        {avgConf > 0 && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            {Math.round(avgConf * 100)}% avg confidence
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">
                          {formatDate(entry.updated_at || entry.created_at)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
