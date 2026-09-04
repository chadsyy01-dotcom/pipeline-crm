const express = require('express');
const { Deal, DealStage, Contact, Company, User, Activity, Task } = require('../models');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Returns deals grouped by stage — used for the Kanban pipeline view
router.get('/board', async (req, res) => {
  const stages = await DealStage.findAll({
    order: [['order', 'ASC']],
    include: [{ model: Deal, include: [Contact, Company, { model: User, as: 'owner' }] }],
  });
  res.json(stages);
});

router.get('/', async (req, res) => {
  const deals = await Deal.findAll({
    include: [Contact, Company, DealStage, { model: User, as: 'owner' }],
    order: [['createdAt', 'DESC']],
  });
  res.json(deals);
});

router.get('/:id', async (req, res) => {
  const deal = await Deal.findByPk(req.params.id, {
    include: [Contact, Company, DealStage, { model: User, as: 'owner' }, Activity, Task],
  });
  if (!deal) return res.status(404).json({ error: 'Not found' });
  res.json(deal);
});

router.post('/', async (req, res) => {
  const deal = await Deal.create({ ...req.body, OwnerId: req.body.OwnerId || req.user.id });
  res.status(201).json(deal);
});

router.put('/:id', async (req, res) => {
  const deal = await Deal.findByPk(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Not found' });
  await deal.update(req.body);
  res.json(deal);
});

// Move a deal to a different stage (drag-and-drop on the board)
router.patch('/:id/stage', async (req, res) => {
  const deal = await Deal.findByPk(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Not found' });
  await deal.update({ DealStageId: req.body.DealStageId });
  res.json(deal);
});

router.delete('/:id', async (req, res) => {
  const deal = await Deal.findByPk(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Not found' });
  await deal.destroy();
  res.status(204).end();
});

module.exports = router;
