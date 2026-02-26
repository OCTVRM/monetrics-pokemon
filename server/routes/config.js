const express = require('express');
const router = express.Router();

// GET /api/config/rate
router.get('/rate', (req, res) => {
    const rate = parseFloat(process.env.USD_TO_CLP_RATE) || 900;
    res.json({ usdToClp: rate });
});

module.exports = router;
