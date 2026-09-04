const express = require('express');
const { Task } = require('../models');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const tasks = await Task.findAll({
    where: { UserId: req.user.id },
    order: [['dueDate', 'ASC']],
  });
  res.json(tasks);
});

router.post('/', async (req, res) => {
  const task = await Task.create({ ...req.body, UserId: req.user.id });
  res.status(201).json(task);
});

router.put('/:id', async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  await task.update(req.body);
  res.json(task);
});

router.delete('/:id', async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  await task.destroy();
  res.status(204).end();
});

module.exports = router;
