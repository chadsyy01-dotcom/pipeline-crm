const express = require('express');
const { DealStage } = require('../models');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const stages = await DealStage.findAll({ order: [['order', 'ASC']] });
  res.json(stages);
});

router.post('/', async (req, res) => {
  const stage = await DealStage.create(req.body);
  res.status(201).json(stage);
});

router.put('/:id', async (req, res) => {
  const stage = await DealStage.findByPk(req.params.id);
  if (!stage) return res.status(404).json({ error: 'Not found' });
  await stage.update(req.body);
  res.json(stage);
});

router.delete('/:id', async (req, res) => {
  const stage = await DealStage.findByPk(req.params.id);
  if (!stage) return res.status(404).json({ error: 'Not found' });
  await stage.destroy();
  res.status(204).end();
});

module.exports = router;
