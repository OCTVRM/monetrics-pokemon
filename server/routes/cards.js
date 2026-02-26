const express = require('express');
const router = express.Router();
const cardsController = require('../controllers/cardsController');

// GET /api/cards/search?q=Charizard
router.get('/search', cardsController.searchCards);

module.exports = router;
