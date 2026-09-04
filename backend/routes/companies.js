const express = require('express');
const { Company, Contact, Deal } = require('../models');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const companies = await Company.findAll({ order: [['name', 'ASC']] });
  res.json(companies);
});

router.get('/:id', async (req, res) => {
  const company = await Company.findByPk(req.params.id, {
    include: [Contact, Deal],
  });
  if (!company) return res.status(404).json({ error: 'Not found' });
  res.json(company);
});

router.post('/', async (req, res) => {
  const company = await Company.create(req.body);
  res.status(201).json(company);
});

router.put('/:id', async (req, res) => {
  const company = await Company.findByPk(req.params.id);
  if (!company) return res.status(404).json({ error: 'Not found' });
  await company.update(req.body);
  res.json(company);
});

router.delete('/:id', async (req, res) => {
  const company = await Company.findByPk(req.params.id);
  if (!company) return res.status(404).json({ error: 'Not found' });
  await company.destroy();
  res.status(204).end();
});

module.exports = router;
