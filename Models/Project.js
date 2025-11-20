const mongoose = require('mongoose');

const boardCardSchema = new mongoose.Schema(
  {
    title: { type: String, default: 'Scrum 1' },
    description: { type: String, default: '' },
    status: { type: String, required: true },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    dueDate: { type: Date, default: Date.now }
  },
  { _id: false }
);

const boardColumnSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    order: { type: Number, default: 0 },
    cards: { type: [boardCardSchema], default: [] }
  },
  { _id: false }
);

const memberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'collaborator'], default: 'collaborator' },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    joinedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const inviteSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'cancelled'],
    default: 'pending'
  },
  invitedAt: { type: Date, default: Date.now },
  acceptedAt: { type: Date },
  cancelledAt: { type: Date }
});

const projectSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    status: {
      type: String,
      enum: ['created', 'in-progress', 'completed'],
      default: 'created'
    },
    boardType: {
      type: String,
      enum: ['scrum', 'kanban'],
      default: 'scrum'
    },
    currentSprint: { type: String, default: 'Scrum 1' },
    columns: { type: [boardColumnSchema], default: [] },
    members: { type: [memberSchema], default: [] },
    invites: { type: [inviteSchema], default: [] }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Project', projectSchema);
