const express = require('express');
const { getWeights } = require('../chain');

const router = express.Router();

// GET /api/weights - scoring weights from contract
router.get('/', async (req, res, next) => {
  try {
    const weights = await getWeights();
    res.json(weights);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
