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
    columns: { type: [boardColumnSchema], default: [] }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Project', projectSchema);
