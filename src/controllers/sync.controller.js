const syncService = require('../services/sync.service');

async function startSync(req, res) {
  const { brands, forceRefresh, triggeredBy } = req.body;
  const result = await syncService.startSync(brands, { forceRefresh, triggeredBy: triggeredBy || 'n8n' });
  res.json(result);
}

async function getSyncStatus(req, res) {
  const { syncId } = req.params;
  const status = syncService.getSyncStatus(syncId);

  if (!status) {
    return res.status(404).json({ error: 'Sync not found' });
  }

  res.json({ syncId, ...status });
}

module.exports = { startSync, getSyncStatus };
