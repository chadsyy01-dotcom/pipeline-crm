const express = require('express');
const { Contact, Company, Activity, Task, Deal, User } = require('../models');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { status, q } = req.query;
  const where = {};
  if (status) where.status = status;
  const { Op } = require('sequelize');
  if (q) {
    where[Op.or] = [
      { firstName: { [Op.like]: `%${q}%` } },
      { lastName: { [Op.like]: `%${q}%` } },
      { email: { [Op.like]: `%${q}%` } },
    ];
  }
  const contacts = await Contact.findAll({
    where,
    include: [Company],
    order: [['createdAt', 'DESC']],
  });
  res.json(contacts);
});

router.get('/:id', async (req, res) => {
  const contact = await Contact.findByPk(req.params.id, {
    include: [
      Company,
      Deal,
      { model: Task },
      { model: Activity, include: [User] },
    ],
  });
  if (!contact) return res.status(404).json({ error: 'Not found' });
  res.json(contact);
});

router.post('/', async (req, res) => {
  const contact = await Contact.create(req.body);
  res.status(201).json(contact);
});

router.put('/:id', async (req, res) => {
  const contact = await Contact.findByPk(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Not found' });
  await contact.update(req.body);
  res.json(contact);
});

router.delete('/:id', async (req, res) => {
  const contact = await Contact.findByPk(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Not found' });
  await contact.destroy();
  res.status(204).end();
});

// Log an activity against a contact
router.post('/:id/activities', async (req, res) => {
  const contact = await Contact.findByPk(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Not found' });
  const activity = await Activity.create({
    ...req.body,
    ContactId: contact.id,
    UserId: req.user.id,
  });
  res.status(201).json(activity);
});

module.exports = router;
