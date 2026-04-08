const { Router } = require('express');
const { testConnection } = require('../config/database');

const router = Router();

router.get('/', async (req, res) => {
  let dbStatus = 'disconnected';
  try {
    await testConnection();
    dbStatus = 'connected';
  } catch {
    dbStatus = 'error';
  }

  res.json({
    status: 'ok2',
    database: dbStatus,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
