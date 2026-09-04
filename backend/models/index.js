const { Sequelize, DataTypes } = require('sequelize');

// Supabase's Postgres requires SSL. DATABASE_URL comes from your Supabase
// project settings -> Database -> Connection string (use the "Transaction"
// pooler URI on port 6543 if you deploy somewhere serverless; the direct
// URI on port 5432 works fine for a normal long-running Express server).
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  protocol: 'postgres',
  logging: false,
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false, // Supabase uses a trusted but non-standard CA chain
    },
  },
});

const User = sequelize.define('User', {
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.ENUM('admin', 'member'), defaultValue: 'member' },
});

const Company = sequelize.define('Company', {
  name: { type: DataTypes.STRING, allowNull: false },
  website: DataTypes.STRING,
  industry: DataTypes.STRING,
  notes: DataTypes.TEXT,
});

const Contact = sequelize.define('Contact', {
  firstName: { type: DataTypes.STRING, allowNull: false },
  lastName: DataTypes.STRING,
  email: DataTypes.STRING,
  phone: DataTypes.STRING,
  title: DataTypes.STRING,
  source: DataTypes.STRING,
  status: { type: DataTypes.ENUM('lead', 'active', 'customer', 'inactive'), defaultValue: 'lead' },
});

const DealStage = sequelize.define('DealStage', {
  name: { type: DataTypes.STRING, allowNull: false },
  order: { type: DataTypes.INTEGER, defaultValue: 0 },
  isWon: { type: DataTypes.BOOLEAN, defaultValue: false },
  isLost: { type: DataTypes.BOOLEAN, defaultValue: false },
});

const Deal = sequelize.define('Deal', {
  title: { type: DataTypes.STRING, allowNull: false },
  value: { type: DataTypes.FLOAT, defaultValue: 0 },
  currency: { type: DataTypes.STRING, defaultValue: 'USD' },
  expectedCloseDate: DataTypes.DATEONLY,
  notes: DataTypes.TEXT,
});

const Activity = sequelize.define('Activity', {
  type: { type: DataTypes.ENUM('note', 'call', 'email', 'meeting'), defaultValue: 'note' },
  content: { type: DataTypes.TEXT, allowNull: false },
});

const Task = sequelize.define('Task', {
  title: { type: DataTypes.STRING, allowNull: false },
  dueDate: DataTypes.DATE,
  done: { type: DataTypes.BOOLEAN, defaultValue: false },
});

// Associations
Company.hasMany(Contact); Contact.belongsTo(Company);
Company.hasMany(Deal); Deal.belongsTo(Company);
Contact.hasMany(Deal); Deal.belongsTo(Contact);
DealStage.hasMany(Deal); Deal.belongsTo(DealStage);
User.hasMany(Deal, { as: 'ownedDeals' }); Deal.belongsTo(User, { as: 'owner' });

Contact.hasMany(Activity); Activity.belongsTo(Contact);
Deal.hasMany(Activity); Activity.belongsTo(Deal);
User.hasMany(Activity); Activity.belongsTo(User);

User.hasMany(Task); Task.belongsTo(User);
Contact.hasMany(Task); Task.belongsTo(Contact);
Deal.hasMany(Task); Task.belongsTo(Deal);

module.exports = { sequelize, User, Company, Contact, DealStage, Deal, Activity, Task };
