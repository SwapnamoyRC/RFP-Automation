import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import * as api from '../api/sessions';
import { extractError } from '../utils/extractError';

// Normalize DB row (snake_case flat) into frontend-friendly shape
function normalizeItem(row) {
  return {
    ...row,
    status: row.review_status || row.status || 'pending',
    rfpItem: row.query || row.description || '',
    dimensions: row.dimensions || '',
    quantity: row.quantity,
    rfpImage: row.rfp_image_base64,
    matchSource: row.match_source || 'hybrid_pipeline',
    matchedProduct: {
      name: row.product_name,
      brand: row.product_brand,
      imageUrl: row.product_image_url,
      description: row.product_specs,
      confidence: row.confidence,
      similarity: row.confidence,
      explanation: row.match_explanation || null,
      matchedPoints: Array.isArray(row.matched_points)
        ? row.matched_points
        : (typeof row.matched_points === 'string' ? JSON.parse(row.matched_points || '[]') : []),
      mismatchedPoints: Array.isArray(row.mismatched_points)
        ? row.mismatched_points
        : (typeof row.mismatched_points === 'string' ? JSON.parse(row.mismatched_points || '[]') : []),
    },
    isOverridden: row.is_overridden || false,
    overrideProductUrl: row.override_product_url || null,
    overrideProductName: row.override_product_name || null,
    overrideProductBrand: row.override_product_brand || null,
    overrideProductImageUrl: row.override_product_image_url || null,
    selectedImageUrl: row.override_product_image_url || null,
    alternatives: (row.alternatives || []).map(alt => ({
      name: alt.name || alt.product_name,
      brand: alt.brand || alt.product_brand,
      imageUrl: alt.imageUrl || alt.product_image_url || alt.image_url,
      selectedImageUrl: alt.selected_image_url || null,
      description: alt.description || alt.product_specs,
      similarity: alt.similarity || alt.confidence,
      explanation: alt.explanation || null,
    })),
    approvedAlternativeIndices: row.approved_alternative_indices ?
      (typeof row.approved_alternative_indices === 'string'
        ? JSON.parse(row.approved_alternative_indices)
        : row.approved_alternative_indices)
      : [],
  };
}

export function useSession() {
  const [session, setSession] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(null); // { status, total_items, processed_items }
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const pollRef = useRef(null);

  const fetchHistory = useCallback(async () => {
    if (!localStorage.getItem('token')) return; // skip if not logged in
    try {
      const sessions = await api.listSessions({ limit: 100 });
      setHistory(Array.isArray(sessions) ? sessions : []);
    } catch (err) {
      console.error('[fetchHistory] Failed to load session history:', err);
    }
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const startPolling = useCallback((sessionId) => {
    if (pollRef.current) clearInterval(pollRef.current);

    setProcessing(true);

    pollRef.current = setInterval(async () => {
      try {
        const prog = await api.getProgress(sessionId);
        setProgress(prog);

        // Also fetch items so review page shows partial results
        const rawItems = await api.getSessionItems(sessionId);
        const arr = Array.isArray(rawItems) ? rawItems : rawItems.items || [];
        if (arr.length > 0) {
          setItems(arr.map(normalizeItem));
        }

        // Done processing
        if (prog.status === 'reviewing' || prog.status === 'completed' || prog.status === 'error') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setProcessing(false);
          setProgress(null);
          // Final fetch: items + refreshed session (to get processing_time_ms)
          const [finalItems, refreshedSession] = await Promise.all([
            api.getSessionItems(sessionId),
            api.getSession(sessionId),
          ]);
          const finalArr = Array.isArray(finalItems) ? finalItems : finalItems.items || [];
          setItems(finalArr.map(normalizeItem));
          setSession(refreshedSession);
        }
      } catch (err) {
        console.error('[polling] Error:', err);
      }
    }, 5000); // poll every 5 seconds
  }, []);

  // Resume polling if user navigates back to review page while processing
  const resumePollingIfNeeded = useCallback(async (sessionId) => {
    if (pollRef.current) return; // Already polling

    try {
      const sess = await api.getSession(sessionId);
      if (sess.status === 'processing') {
        // Session is still processing, resume polling
        startPolling(sessionId);
      } else {
        // Session done, just refresh items once
        const rawItems = await api.getSessionItems(sessionId);
        const arr = Array.isArray(rawItems) ? rawItems : rawItems.items || [];
        setItems(arr.map(normalizeItem));
        setSession(sess);
      }
    } catch (err) {
      console.error('[resumePollingIfNeeded] Error:', err);
    }
  }, [startPolling]);

  const createAndProcess = useCallback(async (clientName, file, options = {}) => {
    setLoading(true);
    setProcessing(true);
    setError(null);
    try {
      const sess = await api.createSession(clientName);
      setSession(sess);

      // This now returns immediately (processing happens in background)
      const result = await api.processSession(sess.id, file, options);
      setProgress({ status: 'processing', total_items: result.total_items, processed_items: 0 });

      // Start polling for progress
      startPolling(sess.id);

      return result; // Return result with warnings for UI display
    } catch (err) {
      const msg = extractError(err);
      setError(msg);
      setProcessing(false);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [startPolling]);

  const refreshItems = useCallback(async (sessionId) => {
    try {
      const rawItems = await api.getSessionItems(sessionId);
      const arr = Array.isArray(rawItems) ? rawItems : rawItems.items || [];
      setItems(arr.map(normalizeItem));
    } catch (err) {
      const msg = extractError(err);
      setError(msg);
      toast.error(msg);
    }
  }, []);

  const approveItem = useCallback(async (sessionId, itemId) => {
    await api.reviewItem(sessionId, itemId, 'approve');
    setItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, status: 'approved' } : item
    ));
  }, []);

  const rejectItem = useCallback(async (sessionId, itemId) => {
    await api.reviewItem(sessionId, itemId, 'reject');
    setItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, status: 'rejected' } : item
    ));
  }, []);

  const pickAlternative = useCallback(async (sessionId, itemId, altIndex) => {
    await api.selectAlternative(sessionId, itemId, altIndex);
    await refreshItems(sessionId);
  }, [refreshItems]);

  const overrideItem = useCallback(async (sessionId, itemId, overrideData) => {
    await api.overrideItem(sessionId, itemId, overrideData);
    await refreshItems(sessionId);
  }, [refreshItems]);

  const downloadPPT = useCallback(async (sessionId) => {
    const blob = await api.generatePPT(sessionId);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `RFP-Proposal-${String(sessionId).slice(0, 8)}.pptx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    await fetchHistory();
  }, [fetchHistory]);

  const stopProcessing = useCallback(async (sessionId) => {
    try {
      // Immediately stop polling on frontend
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }

      // Call backend to stop processing
      await api.stopSession(sessionId);

      // Wait a moment for backend to update, then refresh both session data and items
      await new Promise(r => setTimeout(r, 1000));
      const [refreshedSession, refreshedItems] = await Promise.all([
        api.getSession(sessionId),
        api.getSessionItems(sessionId),
      ]);
      setSession(refreshedSession);
      const arr = Array.isArray(refreshedItems) ? refreshedItems : refreshedItems.items || [];
      setItems(arr.map(normalizeItem));

      // Set processing to false AFTER all data is updated (prevents "0" flash)
      setProcessing(false);

      toast.success('Processing stopped');
    } catch (err) {
      const msg = extractError(err);
      toast.error(msg || 'Failed to stop processing');
      setProcessing(false);
    }
  }, []);

  const resumeProcessing = useCallback(async (sessionId) => {
    try {
      setProcessing(true);
      const result = await api.resumeSession(sessionId);

      // Wait 2 seconds for backend to update session status to 'processing'
      // before starting polling
      await new Promise(r => setTimeout(r, 2000));

      // Start polling for the resumed items
      startPolling(sessionId);

      toast.success(`Resuming processing for ${result.unprocessedCount} items`);
    } catch (err) {
      const msg = extractError(err);
      toast.error(msg || 'Failed to resume processing');
      setProcessing(false);
    }
  }, [startPolling]);

  const retryFailedItem = useCallback(async (sessionId, itemId) => {
    try {
      const result = await api.retryItem(sessionId, itemId);
      // Refresh items to show updated status
      await refreshItems(sessionId);

      if (result.processed) {
        toast.success('Item retry successful');
      } else {
        toast.success('Item retry started');
      }
    } catch (err) {
      const msg = extractError(err);
      toast.error(msg || 'Failed to retry item');
    }
  }, [refreshItems]);

  const selectImage = useCallback(async (sessionId, itemId, imageUrl) => {
    await api.selectProductImage(sessionId, itemId, imageUrl);
    setItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, selectedImageUrl: imageUrl, overrideProductImageUrl: imageUrl } : item
    ));
  }, []);

  const selectAltImage = useCallback(async (sessionId, itemId, altIndex, imageUrl) => {
    // Optimistically update state immediately for instant UI feedback
    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const newAlts = (item.alternatives || []).map((alt, i) =>
        i === altIndex - 1 ? { ...alt, selectedImageUrl: imageUrl } : alt
      );
      return { ...item, alternatives: newAlts };
    }));
    try {
      await api.selectAlternativeImage(sessionId, itemId, altIndex, imageUrl);
    } catch (err) {
      console.error('[selectAltImage] Failed to save:', err);
    }
  }, []);

  const approveMultipleAlternatives = useCallback(async (sessionId, itemId, alternativeIndices) => {
    try {
      await api.approveMultipleAlternatives(sessionId, itemId, alternativeIndices);
      // Refresh items to show updated approved alternatives
      await refreshItems(sessionId);
      toast.success(`${alternativeIndices.length} option(s) approved`);
    } catch (err) {
      const msg = extractError(err);
      toast.error(msg || 'Failed to approve alternatives');
    }
  }, [refreshItems]);

  const loadSession = useCallback(async (sessionId) => {
    setLoading(true);
    try {
      const sess = await api.getSession(sessionId);
      setSession(sess);

      // If session is still processing, start polling
      if (sess.status === 'processing') {
        setProcessing(true);
        startPolling(sessionId);
      }

      const rawItems = await api.getSessionItems(sessionId);
      const arr = Array.isArray(rawItems) ? rawItems : rawItems.items || [];
      setItems(arr.map(normalizeItem));
      return sess;
    } catch (err) {
      const msg = extractError(err);
      setError(msg);
      toast.error(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [startPolling]);

  return {
    session, setSession,
    items, setItems,
    loading, processing, progress, error,
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
    fetchHistory,
    stopProcessing,
    resumeProcessing,
    retryFailedItem,
    approveMultipleAlternatives,
    selectImage,
    selectAltImage,
  };
}
