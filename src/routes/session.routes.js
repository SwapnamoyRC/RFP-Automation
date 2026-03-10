const express = require('express');
const sessionController = require('../controllers/session.controller');

const router = express.Router();

// Session management
router.post('/', sessionController.createSession);
router.get('/active/:chatId', sessionController.getActiveSession);
router.get('/:id', sessionController.getSessionById);
router.patch('/:id', sessionController.updateSession);

// Process RFP for a session
router.post('/:id/process', sessionController.processSession);

// Items
router.get('/:id/items', sessionController.getSessionItems);
router.get('/:id/items/pending', sessionController.getNextPendingItem);
router.post('/:id/items/:itemId/review', sessionController.reviewItem);

// Generate PPT from approved items
router.post('/:id/generate', sessionController.generateFromSession);

module.exports = router;
