const { Sequelize, DataTypes } = require('sequelize');

// UPDATED 2026-09-19: migrated OFF Supabase entirely onto Railway Postgres
// (Postgres-ve5z), same Railway project as this backend — connected over
// Railway's INTERNAL network (postgres-ve5z.railway.internal), not a public
// pooler. The small pool below was a workaround for Supabase's Supavisor
// session-mode pooler (~15 client limit on free tier) and its enforced
// statement_timeout, which caused repeated ECHECKOUTTIMEOUT /
// ConnectionAcquireTimeoutError crashes (Sep 17-19). Neither constraint
// applies here: internal networking has no pooler in the middle and no
// artificial per-statement timeout, so the pool is opened back up.
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  protocol: 'postgres',
  logging: false,
  pool: {
    max: 20,       // internal networking, no pooler ceiling to respect
    min: 2,        // keep a couple warm — avoids a cold-connect on every burst
    acquire: 30000,
    idle: 10000,
    evict: 10000,
  },
  dialectOptions: {
    // Railway's internal Postgres does not require SSL (traffic never
    // leaves Railway's private network). Left permissive rather than
    // required, in case DATABASE_URL is ever pointed at a public/external
    // Postgres again — an unwanted "SSL required" failure is worse than an
    // unused ssl block.
    ssl: process.env.DATABASE_URL?.includes('railway.internal') ? false : { require: true, rejectUnauthorized: false },
    keepAlive: true,
  },
  retry: { max: 2 },
});

const User = sequelize.define('User', {
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.ENUM('admin', 'member'), defaultValue: 'member' },
  // Profile picture (added 2026-09-18). Stored as a data: URL (base64 JPEG),
  // NOT a file path — there's no object storage in this deployment. The
  // browser center-crops and resizes to 256x256 at quality 0.8 before
  // uploading, so a picture lands at roughly 30-40 kB; PATCH /api/auth/me
  // rejects anything over 300 kB of base64. Every user may change their OWN
  // picture (name/password are admin-only — see routes/auth.js). NULL = fall
  // back to the initials circle the UI already draws.
  avatar: { type: DataTypes.TEXT, allowNull: true },
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

// Logs every Chatwoot webhook delivery (message_created, conversation_status_changed,
// etc). `payload` always keeps the full raw JSON regardless of what we managed to
// extract into the columns below — Chatwoot has changed webhook payload shapes
// before without notice, so this is the safety net against losing data when that
// happens again.
const ChatwootEvent = sequelize.define('ChatwootEvent', {
  brand: { type: DataTypes.STRING, allowNull: false },
  event: { type: DataTypes.STRING, allowNull: false },
  conversationId: DataTypes.INTEGER,
  messageId: DataTypes.INTEGER,
  status: DataTypes.STRING,
  inboxId: DataTypes.INTEGER,
  inboxName: DataTypes.STRING,
  contactName: DataTypes.STRING,
  contactEmail: DataTypes.STRING,
  content: DataTypes.TEXT,
  senderName: DataTypes.STRING,
  senderType: DataTypes.STRING,
  // Customer IP (added 2026-09-18). Kept in its own column because
  // slimPayload() strips conversation.additional_attributes and
  // prunePayloads() blanks payload entirely after 3 days — an IP left in the
  // raw payload would be gone by the time anyone looked for it. Only fills in
  // from this deploy onward; older rows stay NULL and can't be recovered.
  customerIp: DataTypes.STRING,
  isPrivate: { type: DataTypes.BOOLEAN, defaultValue: false },
  labels: DataTypes.ARRAY(DataTypes.STRING),
  handoffStage: DataTypes.STRING,
  csatRating: DataTypes.INTEGER,
  csatFeedback: DataTypes.TEXT,
  payload: { type: DataTypes.JSONB, allowNull: false },
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

module.exports = { sequelize, User, Company, Contact, DealStage, Deal, Activity, Task, ChatwootEvent };
